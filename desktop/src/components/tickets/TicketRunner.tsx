/**
 * Exécutant du super-agent (monté une fois dans AppLayout). Prend le prochain ticket
 * de la file, le fait traiter par l'agent dans une worktree isolée, et le surveille :
 * budget en FCFA, durée maximale, absence d'activité, demande d'arrêt. À la fin, le
 * travail est commité sur la branche du ticket et attend la validation.
 * Un ticket à la fois ; l'app doit rester ouverte (et l'ordinateur allumé).
 */
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTicketStore, inWorkWindow, nextTicket, type Ticket } from '@/stores/ticketStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useAgentChat } from '@/hooks/useAgentChat';
import { refreshCredits } from '@/lib/credits';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { commitAll, isGitRepo, prepareWorktree } from '@/services/superagent/ticketGit';

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

export default function TicketRunner() {
  const [job, setJob] = useState<{ ticket: Ticket; key: number } | null>(null);
  const runningId = useTicketStore((s) => s.runningId);
  const tickets = useTicketStore((s) => s.tickets);
  const settings = useTicketStore((s) => s.settings);
  const [tick, setTick] = useState(0);
  const recovered = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), CHECK_EVERY_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!useTicketStore.persist.hasHydrated()) return;
    if (!recovered.current) { recovered.current = true; useTicketStore.getState().recoverInterrupted(); }
    if (job || runningId || settings.paused || !inWorkWindow(settings)) return;
    const next = nextTicket(useTicketStore.getState().tickets);
    if (!next) return;
    useTicketStore.getState().setRunning(next.id);
    setJob({ ticket: next, key: Date.now() });
  }, [tick, tickets, settings, job, runningId]);

  if (!job) return null;
  return <TicketJob key={job.key} ticket={job.ticket} onDone={() => { useTicketStore.getState().setRunning(null); setJob(null); }} />;
}

function TicketJob({ ticket, onDone }: { ticket: Ticket; onDone: () => void }) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === ticket.projectId));
  const repo = (project?.metadata?.localPath as string | undefined) || null;
  const [worktree, setWorktree] = useState<string | null>(ticket.worktreePath ?? null);
  const progress = useRef({ costFCFA: 0, lastActivity: Date.now() });
  const stopReason = useRef<Ticket['stopReason']>(undefined);

  const { sendMessage, stop } = useAgentChat({
    workspacePath: worktree,
    workspaceName: project ? `${project.name} · ticket` : undefined,
    model: ticket.model,
    permissionMode: 'full',
    background: true,
    onProgress: ({ costFCFA }) => { progress.current = { costFCFA, lastActivity: Date.now() }; },
  });
  const started = useRef(false);
  const update = (patch: Partial<Ticket>) => useTicketStore.getState().updateTicket(ticket.id, patch);
  const fail = (error: string) => {
    update({ status: 'failed', error, finishedAt: Date.now() });
    toast.error(`Ticket « ${ticket.title} » : ${error}`);
    onDone();
  };

  // 1. Préparation : dépôt git, crédit, worktree
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (!project || !repo) return fail('le projet ou son dossier est introuvable.');
      if (!(await isGitRepo(repo).catch(() => false))) {
        return fail("le projet n'est pas un dépôt git. Initialise-le (onglet Git) : chaque ticket travaille sur sa propre branche.");
      }
      const balance = await refreshCredits().catch(() => null);
      if (balance !== null && balance <= 0) {
        useTicketStore.getState().setSettings({ paused: true });
        return fail('crédit épuisé. La file est mise en pause : recharge, puis reprends-la.');
      }
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
        setWorktree(path!);
      } catch (e: any) {
        fail(`préparation de la worktree impossible — ${e?.message || e}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Exécution, dès que l'agent pointe sur la worktree
  const launched = useRef(false);
  useEffect(() => {
    if (!worktree || launched.current) return;
    const t = useTicketStore.getState().tickets.find((x) => x.id === ticket.id);
    if (!t || t.status !== 'running' || !t.conversationId) return;
    launched.current = true;
    const startedAt = Date.now();
    progress.current = { costFCFA: 0, lastActivity: Date.now() };

    // Watchdog
    const watch = setInterval(() => {
      const cur = useTicketStore.getState().tickets.find((x) => x.id === ticket.id);
      const halt = (reason: NonNullable<Ticket['stopReason']>) => { if (!stopReason.current) { stopReason.current = reason; stop(); } };
      if (cur?.stopRequested) halt('user');
      else if (progress.current.costFCFA >= t.budgetFCFA) halt('budget');
      else if (Date.now() - startedAt > t.maxMinutes * 60_000) halt('time');
      else if (Date.now() - progress.current.lastActivity > STALL_MS) halt('stalled');
    }, WATCH_EVERY_MS);

    void (async () => {
      try {
        await sendMessage(ticketPrompt(t), [], undefined, { conversationId: t.conversationId });
      } catch { /* l'état final est lu dans la conversation */ }
      clearInterval(watch);

      const msgs = useChatStore.getState().conversations.find((c) => c.id === t.conversationId)?.messages || [];
      const last = [...msgs].reverse().find((m) => m.role === 'assistant');
      const cost = typeof last?.costFCFA === 'number' ? last.costFCFA : Math.round(progress.current.costFCFA);
      const report = (last?.content || '').replace(/_\(interrompu\)_/g, '').trim().slice(0, 4_000);
      const reason = stopReason.current;

      // Le travail est toujours commité, même interrompu : rien n'est perdu
      let diffStat: string | null = null;
      try {
        diffStat = await commitAll(worktree, `ANZAR ticket : ${t.title}`);
      } catch (e: any) {
        update({ status: 'failed', error: `commit impossible — ${e?.message || e}`, costFCFA: (t.costFCFA || 0) + cost, report, finishedAt: Date.now() });
        toast.error(`Ticket « ${t.title} » : commit impossible`);
        return onDone();
      }

      const totalCost = Math.round(((t.costFCFA || 0) + cost) * 100) / 100;
      const base = { costFCFA: totalCost, report, finishedAt: Date.now(), stopRequested: false, diffStat: diffStat ?? t.diffStat };
      if (reason) {
        const why = {
          budget: `budget de ${t.budgetFCFA} FCFA atteint`,
          time: `durée de ${t.maxMinutes} min dépassée`,
          stalled: 'aucune activité depuis 8 minutes (réseau ?)',
          user: 'arrêté à ta demande',
        }[reason];
        update({ ...base, status: diffStat || t.diffStat ? 'review' : 'failed', stopReason: reason, error: `Arrêté : ${why}.${diffStat ? ' Le travail fait est gardé : relis-le, relance avec un budget plus grand, ou rejette.' : ''}` });
        toast(`Ticket « ${t.title} » arrêté : ${why}`, { icon: '⏹' });
      } else if (last?.isError) {
        update({ ...base, status: diffStat ? 'review' : 'failed', error: "L'agent s'est arrêté sur une erreur (réseau ou crédit). Le travail fait est gardé." });
        toast.error(`Ticket « ${t.title} » : erreur pendant le travail`);
      } else {
        update({ ...base, status: diffStat ? 'review' : 'done' });
        toast.success(diffStat ? `Ticket « ${t.title} » prêt à valider` : `Ticket « ${t.title} » terminé (aucun fichier modifié)`);
      }
      onDone();
    })();
    return () => clearInterval(watch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktree]);

  return null;
}
