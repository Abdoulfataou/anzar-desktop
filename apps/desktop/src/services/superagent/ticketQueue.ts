/**
 * File du super-agent, sans React. Prend le prochain ticket, le fait traiter par un
 * AgentRunner dans une worktree isolée et le surveille : budget en FCFA, durée maximale,
 * absence d'activité, demande d'arrêt. À la fin, le travail est commité sur la branche du
 * ticket et attend la validation. Un ticket à la fois.
 *
 * Démarrée une fois par startBackgroundQueues() : un ticket en cours ne dépend d'aucun
 * composant à l'écran.
 */
import toast from 'react-hot-toast';
import { useTicketStore, inWorkWindow, nextTicket, type Ticket } from '@/stores/ticketStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { AgentRunner, type AgentChatResult } from '@/services/agent/runtime/agentRunner';
import { refreshCredits } from '@/lib/credits';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { commitAll, isGitRepo, prepareWorktree } from './ticketGit';

const CHECK_EVERY_MS = 20_000;
const WATCH_EVERY_MS = 10_000;
/** Sans aucun appel au modèle ni outil pendant ce temps, l'exécutant est considéré bloqué */
const STALL_MS = 8 * 60_000;

export function ticketPrompt(t: Ticket): string {
  return `# Ticket : ${t.title}

${t.description}
${t.feedback ? `\n## Remarques de l'utilisateur après la tentative précédente\n${t.feedback}\n` : ''}
## Règles de ce ticket
- Tu travailles dans une copie isolée du projet (branche ${t.branch}). Personne ne peut te répondre pendant ce travail : ne pose aucune question, fais les choix raisonnables et note-les dans ton résumé.
- Reste dans le périmètre du ticket : pas de refonte ni d'amélioration non demandée.
- Budget : ${t.budgetFCFA} FCFA, durée : ${t.maxMinutes} minutes au plus. Sois efficace ; au-delà, tu seras arrêté.
- Vérifie ton travail : erreurs de code, build ou tests, et check_page pour une app web.
- Ne commite pas et ne change pas de branche : ANZAR commitera ton travail pour que l'utilisateur le valide.
- Termine par task_done avec : ce qui a été fait, comment tu l'as vérifié, les choix faits et ce qui reste éventuellement.`;
}

/** Exécutant en cours (un seul ticket à la fois). */
let current: { ticketId: string; runner: AgentRunner | null } | null = null;

/** Traite un ticket de bout en bout. Ne lève jamais : tout échec est écrit sur le ticket. */
export async function runTicket(ticket: Ticket): Promise<void> {
  const update = (patch: Partial<Ticket>) => useTicketStore.getState().updateTicket(ticket.id, patch);
  const fail = (error: string) => {
    update({ status: 'failed', error, finishedAt: Date.now() });
    toast.error(`Ticket « ${ticket.title} » : ${error}`);
  };

  // 1. Préparation : dépôt git, crédit, worktree
  const project = useProjectStore.getState().projects.find((p) => p.id === ticket.projectId);
  const repo = (project?.metadata?.localPath as string | undefined) || null;
  if (!project || !repo) return fail('le projet ou son dossier est introuvable.');
  if (!(await isGitRepo(repo).catch(() => false))) {
    return fail("le projet n'est pas un dépôt git. Initialise-le (onglet Git) : chaque ticket travaille sur sa propre branche.");
  }
  const balance = await refreshCredits().catch(() => null);
  if (balance !== null && balance <= 0) {
    useTicketStore.getState().setSettings({ paused: true });
    return fail('crédit épuisé. La file est mise en pause : recharge, puis reprends-la.');
  }
  let worktree: string;
  try {
    let path = ticket.worktreePath;
    let branch = ticket.branch;
    // Nouvelle tentative : on repart du travail précédent s'il existe encore
    if (!path || !(await fileSystemService.exists(path).catch(() => false))) {
      ({ path, branch } = await prepareWorktree(repo, ticket));
    }
    const conv = ticket.conversationId && useChatStore.getState().conversations.some((c) => c.id === ticket.conversationId)
      ? ticket.conversationId
      : useChatStore.getState().createConversation(`🎫 ${ticket.title}`, ticket.model, { activate: false, projectId: project.id }).id;
    update({ status: 'running', startedAt: Date.now(), finishedAt: undefined, worktreePath: path, branch, conversationId: conv, attempts: ticket.attempts + 1, error: undefined, stopReason: undefined });
    worktree = path!;
  } catch (e: any) {
    return fail(`préparation de la worktree impossible — ${e?.message || e}`);
  }

  const t = useTicketStore.getState().tickets.find((x) => x.id === ticket.id);
  if (!t || t.status !== 'running' || !t.conversationId) return;

  // 2. Exécution, surveillée
  const progress = { costFCFA: 0, lastActivity: Date.now() };
  let stopReason: Ticket['stopReason'];
  const runner = new AgentRunner({
    workspacePath: worktree,
    workspaceName: `${project.name} · ticket`,
    model: t.model,
    permissionMode: 'auto',
    background: true,
    budget: { fcfa: t.budgetFCFA, wallMs: t.maxMinutes * 60_000 },
    onProgress: ({ costFCFA }) => { progress.costFCFA = costFCFA; progress.lastActivity = Date.now(); },
  });
  if (current) current.runner = runner;
  const startedAt = Date.now();
  const watch = setInterval(() => {
    const cur = useTicketStore.getState().tickets.find((x) => x.id === ticket.id);
    const halt = (reason: NonNullable<Ticket['stopReason']>) => { if (!stopReason) { stopReason = reason; runner.stop(); } };
    if (cur?.stopRequested) halt('user');
    else if (progress.costFCFA >= t.budgetFCFA) halt('budget');
    else if (Date.now() - startedAt > t.maxMinutes * 60_000) halt('time');
    else if (Date.now() - progress.lastActivity > STALL_MS) halt('stalled');
  }, WATCH_EVERY_MS);

  let result: AgentChatResult | null = null;
  try {
    result = await runner.sendMessage(ticketPrompt(t), [], undefined, { conversationId: t.conversationId });
  } catch { /* filet de sécurité : le résultat structuré est la source principale */ }
  clearInterval(watch);

  // Repli uniquement pour les anciennes sessions sans résultat structuré.
  const msgs = useChatStore.getState().conversations.find((c) => c.id === t.conversationId)?.messages || [];
  const last = [...msgs].reverse().find((m) => m.role === 'assistant');
  const cost = result?.costFCFA ?? (typeof last?.costFCFA === 'number' ? last.costFCFA : Math.round(progress.costFCFA));
  const report = (result?.content || last?.content || '').replace(/_\(interrompu\)_/g, '').trim().slice(0, 4_000);
  const agentFailed = result
    ? result.isError || result.stopReason === 'max_steps' || result.stopReason === 'aborted'
      || result.stopReason === 'budget_exhausted' || result.stopReason === 'loop_detected'
      || result.stopReason === 'verify_failed'
    : !!last?.isError;

  // Le travail est toujours commité, même interrompu : rien n'est perdu
  let diffStat: string | null = null;
  try {
    diffStat = await commitAll(worktree, `ANZAR ticket : ${t.title}`);
  } catch (e: any) {
    update({ status: 'failed', error: `commit impossible — ${e?.message || e}`, costFCFA: (t.costFCFA || 0) + cost, report, finishedAt: Date.now() });
    toast.error(`Ticket « ${t.title} » : commit impossible`);
    return;
  }

  const totalCost = Math.round(((t.costFCFA || 0) + cost) * 100) / 100;
  const base = { costFCFA: totalCost, report, finishedAt: Date.now(), stopRequested: false, diffStat: diffStat ?? t.diffStat };
  if (stopReason) {
    const why = {
      budget: `budget de ${t.budgetFCFA} FCFA atteint`,
      time: `durée de ${t.maxMinutes} min dépassée`,
      stalled: 'aucune activité depuis 8 minutes (réseau ?)',
      user: 'arrêté à ta demande',
    }[stopReason];
    update({ ...base, status: diffStat || t.diffStat ? 'review' : 'failed', stopReason, error: `Arrêté : ${why}.${diffStat ? ' Le travail fait est gardé : relis-le, relance avec un budget plus grand, ou rejette.' : ''}` });
    toast(`Ticket « ${t.title} » arrêté : ${why}`, { icon: '⏹' });
  } else if (agentFailed) {
    const verify = result?.stopReason === 'verify_failed' ? ' La vérification (lint, build ou tests) échoue encore.' : '';
    update({ ...base, status: diffStat ? 'review' : 'failed', error: `L'agent n'a pas abouti (budget, annulation ou erreur).${verify} Le travail fait est gardé.` });
    toast.error(`Ticket « ${t.title} » : erreur pendant le travail`);
  } else {
    update({ ...base, status: diffStat ? 'review' : 'done' });
    toast.success(diffStat ? `Ticket « ${t.title} » prêt à valider` : `Ticket « ${t.title} » terminé (aucun fichier modifié)`);
  }
}

/** Regarde s'il y a un ticket à lancer ; n'en lance qu'un à la fois. */
export function checkTicketQueue(): void {
  const store = useTicketStore.getState();
  if (!useTicketStore.persist.hasHydrated()) return;
  if (current || store.runningId || store.settings.paused || !inWorkWindow(store.settings)) return;
  const next = nextTicket(store.tickets);
  if (!next) return;
  store.setRunning(next.id);
  current = { ticketId: next.id, runner: null };
  void runTicket(next).finally(() => {
    current = null;
    useTicketStore.getState().setRunning(null);
    checkTicketQueue();
  });
}

let started = false;

/** Démarre la surveillance de la file. Retourne la fonction d'arrêt (idempotente). */
export function startTicketQueue(): () => void {
  if (started) return () => {};
  started = true;
  // Tickets « en cours » lors d'une fermeture brutale : remis dans un état reprenable
  const recover = () => { if (useTicketStore.persist.hasHydrated()) useTicketStore.getState().recoverInterrupted(); };
  recover();
  const unsubHydrate = useTicketStore.persist.onFinishHydration(() => { recover(); checkTicketQueue(); });
  // Un ticket ajouté ou des réglages changés : on regarde tout de suite
  const unsubStore = useTicketStore.subscribe((s, prev) => {
    if (s.tickets !== prev.tickets || s.settings !== prev.settings) checkTicketQueue();
  });
  const timer = setInterval(checkTicketQueue, CHECK_EVERY_MS);
  checkTicketQueue();
  return () => {
    started = false;
    clearInterval(timer);
    unsubStore();
    unsubHydrate();
    current?.runner?.stop();
  };
}
