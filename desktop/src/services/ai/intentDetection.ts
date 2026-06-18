/**
 * Intent Detection Service
 * Pure functions to classify user messages: visual intent, audit intent, project name extraction.
 *
 * NOTE: La détection d'intention "projet" est gérée uniquement côté backend
 * par l'OrchestratorAgent. Le frontend ne déclenche la génération de projet
 * que via le wizard (forceProject flag).
 */

/**
 * Détecte si le message demande du contenu visuel (images, diagrammes, etc.)
 * pour router vers Kimi/un provider visuel.
 */
export function detectVisualIntent(message: string): boolean {
  const msg = (message || '').trim().toLowerCase();
  if (msg.length < 8) return false;

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
 * Détecte si le message est une demande d'audit/revue de code sur le projet sélectionné.
 * Ne retourne true que si un projet est sélectionné (avec fichiers).
 */
export function detectAuditIntent(message: string): boolean {
  const msg = (message || '').trim().toLowerCase();
  if (msg.length < 8) return false;

  // Mots-clés d'audit/revue (FR + EN)
  const auditKeywords =
    /\b(audit[es]?|auditer|revue|review|analyse|analyser|inspecte|inspecter|examine|examiner|évalue|évaluer|evaluate|diagnostiqu|diagnostic|scanner|scan|vérifi|check|qualité|quality|bugs?|failles?|sécurité|security|performance|optimis|refactor|architecture|code\s*review)\b/i;

  // Contexte projet (indique qu'on parle du projet, pas d'un concept)
  const projectContext =
    /\b(projet|project|code|codebase|fichiers|files|app|application|repo|repository|ce projet|mon projet|le projet|this project|my project|du projet|le code|mon code)\b/i;

  // Verbes d'action d'analyse
  const analysisVerbs =
    /\b(audit[es]?|auditer|analyse|analyser|review|lis|lire|regarde|regarder|examine|examiner|inspecte|vérifie|vérifier|évalue|check|scan|passe en revue|fais un audit|fais une revue|donne.*avis|ton avis|what.*think|how.*look)\b/i;

  // Match fort: verbe d'analyse + contexte projet
  if (analysisVerbs.test(msg) && projectContext.test(msg)) return true;

  // Match fort: mot-clé audit seul (demande explicite)
  const strongAudit =
    /\b(fais[- ]?(moi\s+)?un\s+audit|audite|code\s*review|revue\s+de\s+code|analyse\s+du\s+(code|projet)|audit\s+(complet|de|du)|review\s+(this|my|the)\s+(project|code))\b/i;
  if (strongAudit.test(msg)) return true;

  // Combinaison: mot-clé audit + pas de demande de génération
  const asksToCreate = /\b(cr[ée]{1,2}[es]?\b|g[ée]n[eè]re|développe|construis|build|create|generate|make)\b/i;
  if (auditKeywords.test(msg) && !asksToCreate.test(msg)) return true;

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
