/**
 * Intent Detection Service
 * Pure functions to classify user messages: project generation, visual intent, project name extraction.
 */

import { aiRouter } from '@/services/router';

/**
 * Détecte si le message de l'utilisateur est une demande de génération de projet.
 * Utilise un scoring heuristique (verbes, objets, scope, domaine) + classifieur local.
 */
export function detectProjectIntent(message: string): boolean {
  const msg = (message || '').trim()
  if (msg.length < 18) return false

  // Heuristiques "anti-faux-positifs"
  if (msg.includes('```')) return false // souvent un extrait de code / logs
  if (/\b(stack trace|traceback|exception)\b/i.test(msg)) return false

  // Prompts de l'assistant étudiant — JAMAIS un projet à générer
  const isStudentPrompt =
    /^Tu es un[e]?\s+(super-)?(correct|expert|profess|traducteur|assistant|tuteur)/i.test(msg) &&
    /\b(correction|reformulat|orthographe|grammaire|academique|pedagogique|exercice|flashcard|quiz|bareme|evaluat|plagiat|bibliograph|citation|revision|memoire|rapport|expose|redaction|traduction|fiche|tuteur|enseign|expliqu)/i.test(msg)
  if (isStudentPrompt) return false

  const questionLike = /(\bcomment\b|\bpourquoi\b|\bexplique\b|\bexpliquer\b|\bwhat\b|\bwhy\b|\bhow\b)\b/i.test(msg)
  const asksToCreate = /\b(cr[ée]{1,2}[es]?\b|cr[ée]{1,2}[- ]?moi|g[ée]n[eè]re|développe|construis|build|create|generate|make|develop)\b/i.test(msg)
  if (questionLike && !asksToCreate) return false

  const verb = /\b(cr[ée]{1,2}[es]?\b|cr[ée]{1,2}[- ]?moi|g[ée]n[eè]re|développe|construis|fais|monte|build|create|generate|make|develop)\b/i
  const obj = /\b(app|application|projet|site|api|dashboard|plateforme|système|logiciel|outil|saas|mvp|prototype|backend|frontend|page web|landing|project|website|platform)\b/i
  const scope = /\b(complet|from scratch|de zéro|entier|full\s*stack|crud|auth|authentification|base de données|database)\b/i
  const domain = /\b(stock|inventaire|crm|facturation|billing|e-?commerce|boutique|restaurant|réservation|booking|gestion)\b/i

  let score = 0
  if (verb.test(msg)) score += 1
  if (obj.test(msg)) score += 1
  if (scope.test(msg)) score += 1
  if (domain.test(msg)) score += 1

  // Si ça ressemble à une demande de debug/correction, on ne déclenche pas le builder
  const looksLikeFix =
    /\b(corrige[rs]?|corriger|correcteur|corrections?|reformul|fix|débug|debug|bug|erreur|errors?|refactor|optimise|lint|tests?)\b/i.test(msg)
  if (looksLikeFix) return false

  // Appui du classifieur local (0 coût, heuristique)
  try {
    const cls = aiRouter.classifyTask([{ role: 'user', content: msg } as any], { hasImages: false })
    if (cls.type === 'planning' || cls.type === 'code_gen') score += 1
    if (cls.type === 'code_review' || cls.type === 'debug_visual') score -= 1
  } catch {
    // ignore
  }

  return score >= 3
}

/**
 * Détecte si le message demande du contenu visuel (images, diagrammes, etc.)
 * pour router vers Kimi/un provider visuel.
 */
export function detectVisualIntent(message: string): boolean {
  const msg = (message || '').trim().toLowerCase();
  if (msg.length < 8) return false;

  // Prompts de l'assistant étudiant — JAMAIS un routage visuel
  const isStudentPrompt =
    /^tu es un[e]?\s+(super-)?(correct|expert|profess|traducteur|assistant|tuteur)/i.test(msg) &&
    /\b(correction|reformulat|orthographe|grammaire|academique|pedagogique|exercice|flashcard|quiz|bareme|evaluat|plagiat|bibliograph|citation|revision|memoire|rapport|expose|redaction|traduction|fiche|tuteur|enseign|expliqu)/i.test(msg);
  if (isStudentPrompt) return false;

  // Mots-clés visuels (FR + EN)
  const visualKeywords =
    /\b(image|images|photo|photos|illustration|illustrations|diagramme|diagrammes|schéma|schémas|schema|schemas|graphique|graphiques|graph|graphs|chart|charts|dessin|dessins|dessine|dessiner|illustre|illustrer|visuel|visuels|visualise|visualiser|infographie|infographies|organigramme|organigrammes|flowchart|mind\s?map|carte\s?mentale|arbre|figure|figures|tableau\s?visuel|mermaid|svg|uml|sequence\s?diagram|class\s?diagram|diag)\b/i;

  // Verbes de création visuelle
  const visualVerbs =
    /\b(génère|genere|génerer|generer|crée|cree|créer|créée|créées|creer|fais|faire|montre|montrer|trace|tracer|représente|represente|représenter|representer|draw|create|generate|make|show|plot|sketch|render|design)\b/i;

  // Contexte visuel fort (demande explicite d'image/diagramme)
  const strongVisual =
    /\b(fais[- ]?moi\s+(un|une|le|la|des)\s+(image|diagramme|schéma|schema|graphique|dessin|illustration|organigramme|infographie|flowchart|figure|svg|mermaid)|dessine[- ]?moi|illustre[- ]?moi|génère[- ]?moi\s+(un|une)\s+(image|diagramme|schéma|schema|graphique)|create\s+(a|an|the)\s+(image|diagram|chart|graph|flowchart|figure))\b/i;

  if (strongVisual.test(msg)) return true;

  // Combinaison verbe + mot-clé visuel
  if (visualVerbs.test(msg) && visualKeywords.test(msg)) return true;

  // Demande directe de type de diagramme
  const diagramTypes =
    /\b(diagramme\s+(de\s+)?(classe|séquence|sequence|flux|activité|activite|état|etat|cas\s+d'utilisation|use\s+case|entité|entite|relation|er)|class\s+diagram|sequence\s+diagram|flowchart|er\s+diagram|state\s+diagram|activity\s+diagram|use\s+case\s+diagram)\b/i;
  if (diagramTypes.test(msg)) return true;

  return false;
}

/**
 * Extrait un nom de projet court depuis le message utilisateur.
 */
export function extractProjectName(message: string): string {
  // Essayer d'extraire après "de gestion de", "pour", etc.
  const match = message.match(
    /(?:de gestion de|pour|d'|de)\s+([a-zàâéèêëïîôùûüæœç\s]{2,30})/i
  );
  if (match) {
    return match[1].trim().replace(/\s+/g, '_').slice(0, 30);
  }
  // Fallback: premiers mots significatifs
  const words = message
    .replace(/[^\w\sàâéèêëïîôùûüæœç]/gi, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 3);
  return words.join('_').slice(0, 30) || 'mon_projet';
}
