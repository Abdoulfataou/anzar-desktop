/**
 * Préparation de l'historique API d'un nouveau tour, en respectant le cache du fournisseur.
 *
 * Tout ce qui précède la demande de l'utilisateur doit rester identique d'un appel à
 * l'autre : le prompt système n'est donc remplacé que si le projet ou la version de
 * l'app changent ; la mémoire, les skills et les instructions personnelles sont
 * renvoyées dans la demande (`systemRefresh`), et les résultats d'outils anciens ne
 * sont raccourcis qu'à cache froid ou au-delà du plafond.
 *
 * Module pur : aucune dépendance à React, Tauri ou aux stores.
 */
import type { APIMessage, ChatAttachment, Message } from '@/types';
import { closeDanglingToolCalls, compactHistory, historyChars, SOFT_LIMIT_CHARS } from '../engine/history';
import { UNTRUSTED_PROMPT_RULE } from '../policy/untrusted';
import type { SessionPromptBundle } from '../context/systemPrompt';

/** Au-delà, le cache fournisseur a pu être vidé : raccourcir coûte moins que renvoyer tel quel. */
export const CACHE_COLD_MS = 30 * 60 * 1000;

/** Début du message qui montre au modèle les captures d'écran de capture_page. */
export const CAPTURE_MARK = "[Captures d'écran de capture_page]";

/** Échanges texte gardés d'une conversation existante quand l'historique API est vide. */
const MAX_PRIOR_MESSAGES = 12;
const MAX_PRIOR_CHARS = 6000;
const MAX_IMAGES_PER_TURN = 8;

export interface SessionSetupInput {
  /** Historique mutable : la fonction y ajoute le message système et la demande. */
  apiHistory: APIMessage[];
  /** Heure du dernier appel au modèle (sert à savoir si le cache est encore chaud). */
  lastCallAt: number;
  /** Demande envoyée au modèle, pièces jointes déjà copiées et résumées (`withAttachments`). */
  apiContent: string;
  attachments: ChatAttachment[];
  /** Messages déjà affichés (reprise d'un fil existant, redémarrage). */
  priorMessages: Message[];
  userMsgId: string;
  assistantId: string;
  prompt: SessionPromptBundle;
}

/**
 * Installe le prompt système et la demande du tour dans `apiHistory`.
 *
 * - historique vide : prompt système + derniers échanges texte de la conversation ;
 * - historique existant : prompt conservé si son début est identique (cache), sinon
 *   remplacé ; les données qui ont changé sont ajoutées à la demande.
 */
export function setupNewTurn(input: SessionSetupInput): void {
  const { apiHistory, lastCallAt, attachments, priorMessages, userMsgId, assistantId, prompt } = input;
  let turnContext = prompt.turnContext;

  if (apiHistory.length === 0) {
    // Reprise d'une conversation existante (redémarrage, changement de tâche) :
    // on redonne à l'agent les échanges texte précédents.
    const prior = priorMessages
      .filter((m) => m.id !== userMsgId && m.id !== assistantId)
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-MAX_PRIOR_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_PRIOR_CHARS) }) as APIMessage);
    apiHistory.push(prompt.system, ...prior);
  } else {
    const prev = apiHistory[0];
    const prevText = typeof prev?.content === 'string' ? prev.content : '';
    if (prev?.role !== 'system' || !prevText.startsWith(prompt.systemHead)) {
      // Autre projet, passage chat ↔ agent ou nouvelle version de l'app : prompt remplacé
      apiHistory[0] = prompt.system;
    } else if (prevText !== prompt.system.content && prompt.systemRefresh) {
      // Seules la mémoire, les skills ou les instructions ont changé : on garde le prompt
      // d'origine (servi par le cache) et on donne la version à jour dans la demande.
      turnContext += `\n\n---\n# Contexte mis à jour (remplace celui du début de la conversation)\n${prompt.systemRefresh}`;
    }
    // Conversation commencée avant la règle sur le contenu externe : on la rappelle
    if (!prevText.includes('## Contenu externe')) turnContext += `\n\n---\n${UNTRUSTED_PROMPT_RULE}`;
    // Si la réponse précédente a été coupée, l'historique doit rester valide pour « continue »
    closeDanglingToolCalls(apiHistory);
  }

  // Les résultats d'outils des demandes précédentes ne servent plus qu'en résumé. On ne
  // les raccourcit que si le cache est froid ou l'historique trop long : sinon, les garder
  // tels quels coûte bien moins cher (servis par le cache) que de tout renvoyer modifié.
  if (Date.now() - lastCallAt > CACHE_COLD_MS || historyChars(apiHistory) > SOFT_LIMIT_CHARS) {
    compactHistory(apiHistory, 0, 300);
  }

  // Le raisonnement des demandes précédentes n'est plus utile au modèle : on l'enlève
  // pour ne pas le repayer. Les images déjà analysées sont remplacées par un marqueur.
  for (let i = 0; i < apiHistory.length; i++) {
    const m = apiHistory[i];
    if (m.reasoning_content) apiHistory[i] = { ...m, reasoning_content: undefined };
    if (m.role === 'user' && Array.isArray(m.content)) {
      const text = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
      const n = m.content.filter((p) => p.type === 'image_url').length;
      apiHistory[i] = {
        ...apiHistory[i],
        content: text.startsWith(CAPTURE_MARK)
          ? `(${n} capture${n > 1 ? 's' : ''} d'écran prise${n > 1 ? 's' : ''} par capture_page, déjà examinée${n > 1 ? 's' : ''}.)`
          : `${text}\n\n(${n} image${n > 1 ? 's' : ''} jointe${n > 1 ? 's' : ''} à cette demande, déjà analysée${n > 1 ? 's' : ''} dans ta réponse.)`,
      };
    }
  }

  // Images jointes : envoyées au modèle (deepseek-flash est multimodal)
  const images = attachments.filter((a) => a.kind === 'image' && a.dataUrl).slice(0, MAX_IMAGES_PER_TURN);
  apiHistory.push({
    role: 'user',
    content: images.length
      ? [
          { type: 'text', text: input.apiContent + turnContext },
          ...images.map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl!, detail: 'auto' as const } })),
        ]
      : input.apiContent + turnContext,
  });
}
