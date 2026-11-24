/**
 * Condenser : quand l'historique d'une session devient trop long, le début du travail est
 * remplacé par un résumé écrit par le modèle (comme le « condenser » d'OpenHands), au lieu
 * d'être seulement tronqué. Les échanges récents restent intacts, et l'historique reste
 * valide pour l'API (chaque appel d'outil garde sa réponse).
 *
 * Module pur : le résumé est demandé par la fonction `summarize` fournie par l'appelant.
 */
import type { APIMessage } from '@/types';

export const CONDENSED_MARK = '[Résumé du travail précédent de cette session]';
const MAX_TRANSCRIPT_CHARS = 120_000;
const TOOL_OUTPUT_CHARS = 1_200;
const TOOL_ARGS_CHARS = 300;

export const CONDENSER_PROMPT = `Tu résumes le début d'une session de travail d'un agent de code pour qu'il puisse continuer sans le relire.
Écris dans la langue de la conversation, 60 lignes au plus, EXACTEMENT sous ces titres, dans cet ordre :
## Demande et intention
## Concepts et décisions
## Fichiers et code
## Erreurs et corrections
## Travail en cours
## Prochaines étapes
## Contexte critique
Règles :
- Garde les chemins, noms de fonctions, commandes et messages d'erreur exacts.
- N'invente rien ; si une section est vide, écris « (aucun) ».
- Ne mentionne pas cette demande de résumé ni le fait que le contexte a été compacté.
- Écris des puces courtes, pas des paragraphes.`;

const text = (m: APIMessage): string =>
  typeof m.content === 'string'
    ? m.content
    : Array.isArray(m.content)
      ? m.content.map((p) => (p.type === 'text' ? (p as { text: string }).text : '[image]')).join('\n')
      : '';

/** Transcription lisible et bornée des messages à résumer. */
export function transcript(messages: APIMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const t = text(m).trim();
      if (t) parts.push(`AGENT : ${t}`);
      for (const c of m.tool_calls || []) {
        parts.push(`OUTIL ${c.function.name}(${(c.function.arguments || '').slice(0, TOOL_ARGS_CHARS)})`);
      }
    } else if (m.role === 'tool') {
      const t = text(m);
      parts.push(`RÉSULTAT : ${t.length > TOOL_OUTPUT_CHARS ? `${t.slice(0, TOOL_OUTPUT_CHARS)}… [${t.length} caractères]` : t}`);
    } else if (m.role === 'user') {
      parts.push(`UTILISATEUR : ${text(m)}`);
    }
  }
  const all = parts.join('\n\n');
  // Trop long : le début (la demande) et la fin (l'état le plus récent) comptent le plus
  if (all.length <= MAX_TRANSCRIPT_CHARS) return all;
  const head = Math.floor(MAX_TRANSCRIPT_CHARS * 0.25);
  return `${all.slice(0, head)}\n\n… [${all.length - MAX_TRANSCRIPT_CHARS} caractères omis] …\n\n${all.slice(-(MAX_TRANSCRIPT_CHARS - head))}`;
}

/**
 * Point de coupe : premier message « utilisateur » (pas un résultat d'outil) avant les
 * `keepRecent` derniers messages. Avant lui, chaque appel d'outil a déjà sa réponse.
 * Renvoie -1 s'il n'y a rien d'utile à résumer.
 */
export function cutIndex(messages: APIMessage[], keepRecent: number): number {
  const start = messages[0]?.role === 'system' ? 1 : 0;
  for (let i = Math.max(start + 2, messages.length - keepRecent); i > start + 1; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return -1;
}

/**
 * Résume sur place le début de l'historique. Renvoie true si l'historique a été condensé.
 * En cas d'échec du résumé, l'historique n'est pas touché.
 */
export async function condenseHistory(
  messages: APIMessage[],
  options: { keepRecent?: number; summarize: (transcript: string) => Promise<string> },
): Promise<boolean> {
  const keepRecent = options.keepRecent ?? 12;
  const cut = cutIndex(messages, keepRecent);
  if (cut < 0) return false;
  const start = messages[0]?.role === 'system' ? 1 : 0;
  const old = messages.slice(start, cut);
  if (!old.length) return false;
  let summary: string;
  try {
    summary = (await options.summarize(transcript(old))).trim();
  } catch {
    return false;
  }
  if (!summary) return false;
  const head = `${CONDENSED_MARK}\nRésumé automatique du travail déjà accompli. Reprends à partir de l'état décrit ci-dessous, sans le répéter.\n\n${summary}\n\n---\n`;
  const target = messages[cut];
  const merged: APIMessage = Array.isArray(target.content)
    ? { ...target, content: [{ type: 'text', text: head }, ...target.content] }
    : { ...target, content: `${head}${text(target)}` };
  messages.splice(start, cut - start + 1, merged);
  return true;
}
