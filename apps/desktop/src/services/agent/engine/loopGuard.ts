/**
 * Rappel de boucle : repère les appels d'outils identiques répétés et **informe** le
 * modèle, sans jamais bloquer l'appel ni arrêter la session.
 *
 * Un agent légitime répète parfois exactement le même appel : relancer le même test après
 * avoir corrigé un fichier, relire la même page après une modification, vérifier deux fois
 * un build. Ces répétitions ne sont pas des boucles. Le rôle de ce module est de rappeler
 * au modèle, à quelques seuils, de relire le dernier résultat et de changer d'approche
 * s'il n'avance plus — la décision reste la sienne, et le budget du tour reste le seul
 * plafond.
 *
 * Adapté du paquet `repeat-tool-reminder` de DeepSeek Harness (MIT) :
 * https://github.com/deepseek-ai/deepseek-harness — voir THIRD_PARTY_NOTICES.
 */
import type { ToolCall } from '@/types';

export interface LoopGuardOptions {
  /** Seuils de répétitions consécutives qui déclenchent un rappel (défaut : 3, 5, 8). */
  thresholds?: number[];
  /** Longueur maximale des arguments cités dans le rappel (défaut : 500). */
  argumentsPreviewChars?: number;
}

export const DEFAULT_LOOP_GUARD: Required<LoopGuardOptions> = {
  thresholds: [3, 5, 8],
  argumentsPreviewChars: 500,
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

/** Texte du premier rappel : doux, il demande de relire avant de répéter. */
const GENTLE_REMINDER =
  "Tu répètes exactement le même appel d'outil avec les mêmes arguments. "
  + "Lis le dernier résultat avant de recommencer : si la tâche n'est pas finie, "
  + "change d'approche ou d'arguments au lieu de répéter l'appel.";

/** Texte des rappels suivants : nomme l'outil, le nombre d'appels et les arguments. */
function detailedReminder(toolName: string, count: number, argumentsPreview: string): string {
  return 'Appel répété détecté :\n'
    + `- outil : ${toolName}\n`
    + `- appels consécutifs identiques : ${count}\n`
    + `- arguments : ${argumentsPreview}\n`
    + "Ces répétitions ne font pas avancer la tâche. Ne rappelle pas cet outil avec ces "
    + "arguments exacts : inspecte le dernier résultat, change d'action ou d'arguments, "
    + "ou termine si tu en sais assez.";
}

function validateThresholds(values: number[]): number[] {
  if (values.length === 0) throw new Error('loopGuard: `thresholds` ne peut pas être vide');
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(`loopGuard: seuil invalide ${value} — chaque seuil doit être un entier >= 2`);
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('loopGuard: `thresholds` ne peut pas contenir de doublons');
  }
  return [...values].sort((a, b) => a - b);
}

/** Aperçu borné des arguments complets : le compteur, lui, compare toujours la chaîne entière. */
function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical;
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} caractères)`;
}

/**
 * Compteur de répétitions par agent. Il n'a plus de décision `allow`/`block` : il ne peut
 * pas empêcher un appel. `after` renvoie un rappel aux seuils configurés, sinon `null`.
 */
export class LoopGuard {
  readonly options: Required<LoopGuardOptions>;
  private chain: { key: string; count: number } | null = null;
  private consecutiveErrors = 0;

  constructor(options: LoopGuardOptions = {}) {
    this.options = {
      thresholds: validateThresholds(options.thresholds ?? DEFAULT_LOOP_GUARD.thresholds),
      argumentsPreviewChars: options.argumentsPreviewChars ?? DEFAULT_LOOP_GUARD.argumentsPreviewChars,
    };
  }

  /**
   * À appeler après l'exécution d'un appel (réussi ou non). Ne lève jamais et ne bloque
   * jamais : renvoie le rappel à ajouter à l'historique, ou `null`.
   */
  after(call: ToolCall, outcome: { isError?: boolean } = {}): string | null {
    const { key } = callSignature(call);
    const count = this.chain?.key === key ? this.chain.count + 1 : 1;
    this.chain = { key, count };
    this.consecutiveErrors = outcome.isError ? this.consecutiveErrors + 1 : 0;
    if (!this.options.thresholds.includes(count)) return null;
    let args: unknown = call.function.arguments;
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* signature brute */ }
    if (count === this.options.thresholds[0]) return GENTLE_REMINDER;
    return detailedReminder(call.function.name, count, previewArguments(stable(args), this.options.argumentsPreviewChars));
  }

  /** Un nouveau message utilisateur ou une nouvelle consigne remet la chaîne à zéro. */
  reset(): void {
    this.chain = null;
    this.consecutiveErrors = 0;
  }

  /** Nombre d'échecs consécutifs, pour les diagnostics et les tests. */
  get consecutiveFailures(): number { return this.consecutiveErrors; }
}
