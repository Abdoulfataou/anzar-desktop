/**
 * Détection de boucle : repère les appels d'outils identiques et les séries d'échecs.
 *
 * Deux pathologies coûtent cher dans un agent :
 * - le même appel rejoué à l'identique (même outil, mêmes arguments) alors qu'il a déjà
 *   échoué — le modèle s'entête au lieu de changer d'approche ;
 * - une série d'échecs avec des arguments différents (offsets, chemins voisins) — la
 *   signature ne suffit pas, il faut un compteur d'échecs consécutifs.
 *
 * Le garde **bloque** l'appel (résultat d'erreur expliqué au modèle) avant de l'exécuter,
 * puis **arrête la session** si le modèle insiste. Module pur : ni React, ni Tauri, ni horloge.
 */
import type { ToolCall } from '@/types';

export type LoopVerdict =
  | { action: 'allow' }
  | { action: 'block'; message: string; stop: boolean };

export interface LoopGuardOptions {
  /** Appels identiques déjà vus avant de bloquer (défaut : 3). */
  maxIdentical?: number;
  /** Échecs identiques déjà vus avant de bloquer (défaut : 2). */
  maxIdenticalFailures?: number;
  /** Blocages d'un même appel avant l'arrêt sec (défaut : 1). */
  maxBlocks?: number;
  /** Échecs consécutifs, toutes signatures confondues, avant l'arrêt (défaut : 8). */
  maxConsecutiveFailures?: number;
}

export const DEFAULT_LOOP_GUARD: Required<LoopGuardOptions> = {
  maxIdentical: 3,
  maxIdenticalFailures: 2,
  maxBlocks: 1,
  maxConsecutiveFailures: 8,
};

/** Sérialisation stable : l'ordre des clés ne doit pas changer la signature. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

/** FNV-1a : court, déterministe, suffisant pour une fenêtre de tour. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Aperçu lisible de l'appel, pour le message renvoyé au modèle. */
function previewOf(name: string, args: unknown): string {
  if (args && typeof args === 'object') {
    const first = Object.values(args as Record<string, unknown>).find((v) => typeof v === 'string' && v.trim());
    if (typeof first === 'string') {
      const short = first.replace(/\s+/g, ' ').trim().slice(0, 70);
      return `${name}(${short}${first.length > 70 ? '…' : ''})`;
    }
  }
  return `${name}(…)`;
}

/** Signature d'un appel : outil + arguments normalisés. */
export function callSignature(call: ToolCall): { key: string; preview: string } {
  let args: unknown = call.function.arguments;
  try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* arguments non JSON : signature sur le texte brut */ }
  return {
    key: `${call.function.name}:${hash(stable(args))}`,
    preview: previewOf(call.function.name, args),
  };
}

export class LoopGuard {
  readonly options: Required<LoopGuardOptions>;
  private readonly totals = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private readonly blocks = new Map<string, number>();
  private consecutiveFailures = 0;
  private blocked = 0;

  constructor(options: LoopGuardOptions = {}) {
    this.options = { ...DEFAULT_LOOP_GUARD, ...options };
  }

  /** Décision avant exécution. `stop` = le modèle insiste après un blocage. */
  before(call: ToolCall): LoopVerdict {
    const { key, preview } = callSignature(call);
    const blocks = this.blocks.get(key) ?? 0;
    if (blocks >= this.options.maxBlocks) {
      return {
        action: 'block',
        stop: true,
        message:
          `Boucle détectée : ${preview} a déjà été refusé ${blocks} fois et tu insistes avec les mêmes arguments. ` +
          `La session s'arrête pour ne pas consommer le budget inutilement. Explique ce qui te bloque.`,
      };
    }
    const total = this.totals.get(key) ?? 0;
    const fails = this.failures.get(key) ?? 0;
    if (fails >= this.options.maxIdenticalFailures || total >= this.options.maxIdentical) {
      const why = fails > 0 ? `a échoué ${fails} fois` : `a déjà été appelé ${total} fois`;
      return {
        action: 'block',
        stop: false,
        message:
          `Appel bloqué : ${preview} ${why} avec exactement les mêmes arguments. ` +
          `Ne le répète pas. Change d'approche : autre portion du fichier (offset/limit), search_files, ` +
          `lecture du fichier pour vérifier son contenu réel, ou explique le blocage dans task_done.`,
      };
    }
    return { action: 'allow' };
  }

  /** À appeler après exécution d'un appel autorisé. */
  after(call: ToolCall, outcome: { isError?: boolean }): void {
    const { key } = callSignature(call);
    this.totals.set(key, (this.totals.get(key) ?? 0) + 1);
    if (outcome.isError) {
      this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
      this.consecutiveFailures += 1;
    } else {
      this.consecutiveFailures = 0;
    }
  }

  /** À appeler quand un appel a été bloqué sans être exécuté. */
  onBlocked(call: ToolCall): void {
    const { key } = callSignature(call);
    this.blocks.set(key, (this.blocks.get(key) ?? 0) + 1);
    this.blocked += 1;
    this.consecutiveFailures += 1;
  }

  /** Trop d'échecs consécutifs (toutes signatures) : la session doit s'arrêter. */
  exhausted(): boolean {
    return this.options.maxConsecutiveFailures > 0
      && this.consecutiveFailures >= this.options.maxConsecutiveFailures;
  }

  get consecutiveErrors(): number { return this.consecutiveFailures; }
  get blockedCalls(): number { return this.blocked; }

  /** Message d'arrêt pour échecs consécutifs. */
  stopMessage(): string {
    return `Boucle détectée : ${this.consecutiveFailures} échecs d'outils consécutifs. ` +
      `La session s'arrête pour ne pas consommer le budget inutilement. Explique ce qui te bloque.`;
  }
}
