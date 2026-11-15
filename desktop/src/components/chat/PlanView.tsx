/**
 * Plan proposé par l'agent en mode plan.
 * - PlanCard : rappel compact dans la conversation
 * - PlanPanel : contenu complet dans l'onglet « Plan » du panneau de droite
 * La validation passe par un événement global, géré par WorkspaceView.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ListChecks, Play, PanelRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { markdownComponents } from './markdownComponents';
import type { Message } from '@/types';

export const OPEN_PLAN_EVENT = 'anzar:open-plan';
export const APPROVE_PLAN_EVENT = 'anzar:approve-plan';

type Plan = NonNullable<Message['plan']>;

const openPlan = (messageId: string) => window.dispatchEvent(new CustomEvent(OPEN_PLAN_EVENT, { detail: messageId }));
const approvePlan = (messageId: string) => window.dispatchEvent(new CustomEvent(APPROVE_PLAN_EVENT, { detail: messageId }));

function StatusChip({ status }: { status: Plan['status'] }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 text-ui-sm text-accent-success">
        <CheckCircle2 size={13} /> Validé
      </span>
    );
  }
  return <span className="text-ui-sm text-text-muted">En attente de validation</span>;
}

export function PlanCard({ messageId, plan, disabled }: { messageId: string; plan: Plan; disabled?: boolean }) {
  return (
    <div className="mt-3 rounded-xl border border-border-medium bg-surface-default overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <ListChecks size={16} className="flex-shrink-0 text-text-secondary" />
        <div className="flex-1 min-w-0">
          <p className="text-ui-base font-medium text-text-primary truncate">{plan.title}</p>
          <StatusChip status={plan.status} />
        </div>
        <button
          onClick={() => openPlan(messageId)}
          className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-ui-base text-text-secondary hover:text-text-primary hover:bg-hover-fill transition-colors"
        >
          <PanelRight size={14} /> Ouvrir
        </button>
        {plan.status === 'pending' && (
          <button
            onClick={() => approvePlan(messageId)}
            disabled={disabled}
            className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Play size={13} /> Valider et exécuter
          </button>
        )}
      </div>
    </div>
  );
}

export function PlanPanel({ messageId, plan, disabled }: { messageId: string; plan: Plan; disabled?: boolean }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        <h2 className="text-ui-lg font-semibold text-text-primary mb-1">{plan.title}</h2>
        <div className="mb-4"><StatusChip status={plan.status} /></div>
        <div className="text-ui-base text-text-primary break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents()}>
            {plan.markdown}
          </ReactMarkdown>
        </div>
      </div>
      {plan.status === 'pending' && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-border-medium flex-shrink-0">
          <p className="flex-1 text-ui-sm text-text-muted">
            Pour le modifier, écris tes remarques dans la conversation : l'agent proposera un nouveau plan.
          </p>
          <button
            onClick={() => approvePlan(messageId)}
            disabled={disabled}
            className={cn(
              'flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base font-medium flex-shrink-0',
              'bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity disabled:opacity-50'
            )}
          >
            <Play size={14} /> Valider et exécuter
          </button>
        </div>
      )}
    </div>
  );
}
