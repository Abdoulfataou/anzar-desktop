/**
 * Assemble les tool_calls fragmentés du streaming SSE (format OpenAI).
 * Chaque fragment porte un `index` ; id et nom arrivent au premier fragment,
 * puis les arguments s'accumulent.
 */
import type { ToolCall } from '@/types';

export class ToolCallAssembler {
  private calls = new Map<number, ToolCall>();

  add(fragments: Partial<ToolCall>[] = []): void {
    for (const frag of fragments) {
      const index = (frag as Partial<ToolCall> & { index?: number }).index ?? 0;
      let call = this.calls.get(index);
      if (!call) {
        call = {
          id: frag.id || `call_${Date.now()}_${index}`,
          type: 'function',
          function: { name: '', arguments: '' },
        };
        this.calls.set(index, call);
      }
      if (frag.id) call.id = frag.id;
      if (frag.function?.name) call.function.name += frag.function.name;
      if (frag.function?.arguments) call.function.arguments += frag.function.arguments;
    }
  }

  finish(): ToolCall[] {
    return [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  }

  get hasCalls(): boolean {
    return this.calls.size > 0;
  }
}
