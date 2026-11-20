/**
 * useAgentChat — adaptateur React de AgentRunner.
 *
 * Toute la logique vit dans services/agent/runtime/agentRunner.ts : ce hook garde un
 * AgentRunner par composant, lui passe les options à chaque rendu et s'abonne à son état
 * (génération en cours, accord ou question en attente).
 */
import { useRef, useSyncExternalStore } from 'react';
import { AgentRunner, type AgentRunnerOptions } from '@/services/agent/runtime/agentRunner';

export type { AgentChatResult, AgentRunnerOptions, ApprovalRequest } from '@/services/agent/runtime/agentRunner';
export type { PermissionMode } from '@/services/agent/policy/permissions';
export type { TimelineItem, ToolEvent } from '@/types';

export function useAgentChat(options: AgentRunnerOptions) {
  const ref = useRef<AgentRunner | null>(null);
  if (!ref.current) ref.current = new AgentRunner(options);
  const runner = ref.current;
  // Comme avant : les options (et le mode) suivent chaque rendu.
  runner.setOptions(options);
  const state = useSyncExternalStore(runner.subscribe, runner.getState);
  return {
    sendMessage: runner.sendMessage,
    stop: runner.stop,
    isGenerating: state.isGenerating,
    approval: state.approval,
    resolveApproval: runner.resolveApproval,
    question: state.question,
    resolveQuestion: runner.resolveQuestion,
    resume: runner.resume,
    setModeNow: runner.setModeNow,
  };
}
