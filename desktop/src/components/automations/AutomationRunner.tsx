/**
 * Exécuteur global des automatisations (monté une fois dans AppLayout).
 * Vérifie toutes les 30 s, lance une exécution à la fois dans une nouvelle tâche
 * du projet, sans changer la tâche affichée.
 */
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useAutomationStore, type Automation } from '@/stores/automationStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useAgentChat, type AgentChatResult } from '@/hooks/useAgentChat';

const CHECK_EVERY_MS = 30_000;

export default function AutomationRunner() {
  const [job, setJob] = useState<{ automation: Automation; key: number } | null>(null);
  const runningId = useAutomationStore((s) => s.runningId);
  const queued = useAutomationStore((s) => s.queued);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), CHECK_EVERY_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (job || runningId) return;
    // Attendre que les automatisations soient relues depuis le disque
    if (!useAutomationStore.persist.hasHydrated()) return;
    const { automations } = useAutomationStore.getState();
    const now = Date.now();
    const next =
      automations.find((a) => queued.includes(a.id)) ||
      automations.find((a) => a.enabled && a.nextRunAt != null && a.nextRunAt <= now);
    if (!next) return;
    useAutomationStore.getState().setRunning(next.id);
    setJob({ automation: next, key: now });
  }, [tick, queued, job, runningId]);

  if (!job) return null;
  return (
    <AutomationJob
      key={job.key}
      automation={job.automation}
      onDone={() => setJob(null)}
    />
  );
}

function AutomationJob({ automation, onDone }: { automation: Automation; onDone: () => void }) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === automation.projectId));
  const workspacePath = (project?.metadata?.localPath as string | undefined) || null;
  const { sendMessage } = useAgentChat({
    workspacePath,
    workspaceName: project?.name,
    model: automation.model,
    permissionMode: automation.mode,
    background: true,
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const store = useAutomationStore.getState();
    void (async () => {
      if (!project || !workspacePath) {
        store.markFinished(automation.id, { ok: false, error: 'Le projet ou son dossier est introuvable.' });
        toast.error(`Automatisation « ${automation.name} » : projet introuvable`);
        onDone();
        return;
      }
      const conv = useChatStore.getState().createConversation(`⏱ ${automation.name}`, automation.model, {
        activate: false,
        projectId: project.id,
      });
      store.markStarted(automation.id, conv.id);
      let ok = false;
      let error: string | undefined;
      try {
        const result: AgentChatResult | null = await sendMessage(automation.prompt, [], undefined, { conversationId: conv.id });
        if (result) {
          ok = !result.isError
            && result.stopReason !== 'max_steps'
            && result.stopReason !== 'aborted'
            && result.content.trim().length > 0;
        } else {
          // Résultat absent (génération déjà en cours) : repli sur l'état de la conversation.
          const msgs = useChatStore.getState().conversations.find((c) => c.id === conv.id)?.messages || [];
          const last = msgs[msgs.length - 1];
          ok = !!last && last.role === 'assistant' && !last.isError;
        }
        if (!ok) error = "La réponse a échoué ou n'a pas abouti. Ouvre la tâche pour reprendre.";
      } catch (e: any) {
        error = e?.message || 'erreur inconnue';
      }
      useAutomationStore.getState().markFinished(automation.id, { ok, error, conversationId: conv.id });
      if (ok) toast.success(`Automatisation « ${automation.name} » terminée`);
      else toast.error(`Automatisation « ${automation.name} » : échec`);
      onDone();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
