/**
 * Modèle simulé pour la **fumée** du lanceur : intercepte les appels `fetch` vers le
 * serveur ANZAR et joue un agent scripté (écriture, commande, fin) en SSE, avec des
 * coûts serveur. Ça valide la plomberie complète du banc — shim, isolation, outils,
 * journal, mesures — sans inventer le moindre résultat de banc : les passages de fumée
 * sont marqués `smoke` et vont dans `results/smoke/`, jamais dans le relevé.
 */
import { ReadableStream } from 'node:stream/web';

let installed = false;

/** Installe le modèle simulé pour toutes les URL commençant par `backend`. */
export function installSmokeModel(backend: string): void {
  if (installed) return;
  installed = true;
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init: any) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (!url.startsWith(`${backend}/api/`)) return realFetch(input, init);

    // Solde du compte (refreshCredits).
    if (url.includes('/api/credits')) {
      return jsonResponse({ balance_fcfa: 5000, total_recharged: 0, total_used: 0, reserved_fcfa: 0 });
    }

    // Chat completions en flux SSE : un appel par étape, selon le nombre d'outils déjà passés.
    const body = JSON.parse(init?.body || '{}');
    const toolCount = body.messages.filter((m: any) => m.role === 'tool').length;
    const step: 'write' | 'cmd' | 'done' = toolCount === 0 ? 'write' : toolCount === 1 ? 'cmd' : 'done';

    const chunks: string[] = [];
    chunks.push(`data: ${JSON.stringify({ anzar: { cost_fcfa: 1.25 } })}\n\n`);
    if (step === 'write') {
      chunks.push(sse({ tool_calls: [{ index: 0, id: 'call-smoke-1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'bonjour.txt', content: 'ÉCRIT par la fumée du banc\n' }) } }] }));
      chunks.push(sse({ finish_reason: 'tool_calls' }));
    } else if (step === 'cmd') {
      // `node --version` : autorisé par la liste d'« avant » ET par l'« après » (plus de liste).
      chunks.push(sse({ tool_calls: [{ index: 0, id: 'call-smoke-2', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'node --version' }) } }] }));
      chunks.push(sse({ finish_reason: 'tool_calls' }));
    } else {
      chunks.push(sse({ content: 'Fumée terminée : fichier écrit, commande passée.' }));
      chunks.push(sse({ finish_reason: 'stop' }));
    }
    chunks.push('data: [DONE]\n\n');

    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    return new Response(stream as unknown as BodyInit, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ delta: payload, finish_reason: null }] })}\n\n`;
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}
