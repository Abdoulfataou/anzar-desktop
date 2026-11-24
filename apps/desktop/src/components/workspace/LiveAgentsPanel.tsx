/**
 * Panneau compact des sous-agents vivants d'une conversation.
 * Il ne remplace pas le chat : il montre qui travaille, qui est au repos et qui a
 * échoué, avec une action d'arrêt. Les résultats détaillés restent dans wait_agent.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Square, Bot, Check, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import {
  listLiveAgents, stopLiveAgent, subscribeLiveAgents, type LiveAgent,
} from '@/services/agent/subagents/live';

function statusIcon(status: LiveAgent['status']) {
  if (status === 'running') return <Loader2 size={12} className="animate-spin text-accent" aria-hidden />;
  if (status === 'error') return <AlertTriangle size={12} className="text-accent-error" aria-hidden />;
  if (status === 'idle') return <Check size={12} className="text-accent-success" aria-hidden />;
  return <Square size={12} className="text-text-muted" aria-hidden />;
}

function statusLabel(status: LiveAgent['status']): string {
  switch (status) {
    case 'running': return 'en cours';
    case 'idle': return 'terminé';
    case 'error': return 'échec';
    case 'stopped': return 'arrêté';
  }
}

export default function LiveAgentsPanel({ convId }: { convId: string | null }) {
  const [agents, setAgents] = useState<LiveAgent[]>(() => listLiveAgents(convId || undefined));
  const previous = useRef<Map<string, LiveAgent['status']>>(new Map());
  useEffect(() => {
    const refresh = () => setAgents(listLiveAgents(convId || undefined));
    refresh();
    return subscribeLiveAgents(refresh);
  }, [convId]);

  // Notification immédiate à la fin d'un enfant, sans attendre le prochain pas du modèle.
  useEffect(() => {
    const prev = previous.current;
    for (const agent of agents) {
      const before = prev.get(agent.id);
      if (before === 'running' && agent.status === 'idle') {
        toast.success(`Sous-agent ${agent.name} terminé`, { id: `agent-done-${agent.id}` });
      } else if (before === 'running' && agent.status === 'error') {
        toast.error(`Sous-agent ${agent.name} en échec`, { id: `agent-error-${agent.id}` });
      }
      prev.set(agent.id, agent.status);
    }
    for (const id of [...prev.keys()]) {
      if (!agents.some((a) => a.id === id)) prev.delete(id);
    }
  }, [agents]);

  if (agents.length === 0) return null;
  return (
    <div className="mx-1 mb-1 rounded-xl border border-border-subtle bg-bg-secondary/70 px-2.5 py-2" aria-label="Sous-agents">
      <div className="mb-1 flex items-center gap-1.5 text-ui-xs uppercase tracking-wide text-text-muted">
        <Bot size={12} aria-hidden /> Sous-agents ({agents.length})
      </div>
      <ul className="space-y-1">
        {agents.map((agent) => (
          <li key={agent.id} className="flex items-start gap-2 rounded-lg px-1 py-0.5">
            <span className="mt-0.5">{statusIcon(agent.status)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-ui-sm font-medium text-text-primary">{agent.name}</span>
                <span className="shrink-0 text-ui-xs text-text-muted">{agent.role} · {statusLabel(agent.status)} · {agent.steps} étapes</span>
              </div>
              <p className={cn('truncate text-ui-xs', agent.status === 'error' ? 'text-accent-error' : 'text-text-muted')}>
                {agent.error || agent.summary || agent.task}
              </p>
            </div>
            {agent.status === 'running' && (
              <button
                type="button"
                onClick={() => stopLiveAgent(convId || undefined, agent.name)}
                className="shrink-0 rounded-md p-1 text-text-muted transition-colors hover:bg-hover-fill hover:text-accent-error"
                title={`Arrêter ${agent.name}`}
                aria-label={`Arrêter ${agent.name}`}
              >
                <Square size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
