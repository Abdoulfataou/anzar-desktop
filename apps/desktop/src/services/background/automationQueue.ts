/**
 * Exécuteur des automatisations, sans React. Vérifie toutes les 30 s et lance une
 * exécution à la fois dans une nouvelle tâche du projet, sans changer la tâche affichée.
 */
import toast from 'react-hot-toast';
import { useAutomationStore, type Automation } from '@/stores/automationStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { AgentRunner, type AgentChatResult } from '@/services/agent/runtime/agentRunner';

const CHECK_EVERY_MS = 30_000;

let current: AgentRunner | null = null;
let busy = false;

export async function runAutomation(automation: Automation): Promise<void> {
  const store = useAutomationStore.getState();
  const project = useProjectStore.getState().projects.find((p) => p.id === automation.projectId);
  const workspacePath = (project?.metadata?.localPath as string | undefined) || null;
  if (!project || !workspacePath) {
    store.markFinished(automation.id, { ok: false, error: 'Le projet ou son dossier est introuvable.' });
    toast.error(`Automatisation « ${automation.name} » : projet introuvable`);
    return;
  }
  const conv = useChatStore.getState().createConversation(`⏱ ${automation.name}`, automation.model, {
    activate: false,
    projectId: project.id,
  });
  store.markStarted(automation.id, conv.id);
  const runner = new AgentRunner({
    workspacePath,
    workspaceName: project.name,
    model: automation.model,
    permissionMode: automation.mode,
    background: true,
  });
  current = runner;
  let ok = false;
  let error: string | undefined;
  try {
    const result: AgentChatResult | null = await runner.sendMessage(automation.prompt, [], undefined, { conversationId: conv.id });
    if (result) {
      ok = !result.isError
        && result.stopReason !== 'max_steps'
        && result.stopReason !== 'aborted'
        && result.content.trim().length > 0;
    } else {
      const msgs = useChatStore.getState().conversations.find((c) => c.id === conv.id)?.messages || [];
      const last = msgs[msgs.length - 1];
      ok = !!last && last.role === 'assistant' && !last.isError;
    }
    if (!ok) error = "La réponse a échoué ou n'a pas abouti. Ouvre la tâche pour reprendre.";
  } catch (e: any) {
    error = e?.message || 'erreur inconnue';
  } finally {
    current = null;
  }
  useAutomationStore.getState().markFinished(automation.id, { ok, error, conversationId: conv.id });
  if (ok) toast.success(`Automatisation « ${automation.name} » terminée`);
  else toast.error(`Automatisation « ${automation.name} » : échec`);
}

export function checkAutomationQueue(): void {
  if (busy || !useAutomationStore.persist.hasHydrated()) return;
  const { automations, queued, runningId } = useAutomationStore.getState();
  if (runningId) return;
  const now = Date.now();
  const next =
    automations.find((a) => queued.includes(a.id)) ||
    automations.find((a) => a.enabled && a.nextRunAt != null && a.nextRunAt <= now);
  if (!next) return;
  busy = true;
  useAutomationStore.getState().setRunning(next.id);
  void runAutomation(next).finally(() => {
    busy = false;
    checkAutomationQueue();
  });
}

let started = false;

export function startAutomationQueue(): () => void {
  if (started) return () => {};
  started = true;
  const unsubHydrate = useAutomationStore.persist.onFinishHydration(() => checkAutomationQueue());
  // « Lancer maintenant » ajoute à la file : prise en compte immédiate
  const unsubStore = useAutomationStore.subscribe((s, prev) => { if (s.queued !== prev.queued) checkAutomationQueue(); });
  const timer = setInterval(checkAutomationQueue, CHECK_EVERY_MS);
  checkAutomationQueue();
  return () => {
    started = false;
    clearInterval(timer);
    unsubStore();
    unsubHydrate();
    current?.stop();
  };
}
