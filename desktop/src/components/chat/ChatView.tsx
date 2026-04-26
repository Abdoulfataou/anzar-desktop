/**
 * ChatView - Vue principale unifiée ANZAR
 * Accueil original + cartes fonctionnalités + chat
 * Routage intelligent: DeepSeek 80% / Kimi 20%
 * Câblage agents: détection d'intention projet → pipeline multi-agents
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  Code2, BarChart3, GraduationCap,
  Globe, FileText, BookOpen, PenTool,
  ListChecks, Layout, BookMarked, Presentation,
  X, Wand2,
  // Data analysis icons
  Table2, TrendingUp, PieChart, Filter,
  // Search icons
  Search, Newspaper, HelpCircle, Scale,
  // Document icons
  Mail, FileCheck, Megaphone, ScrollText, Briefcase, Pen,
} from 'lucide-react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { cn } from '@/lib/utils';
import { AIModel, ToolDefinition } from '@/types';
import { aiRouter } from '@/services/router';
import { projectGeneration, type PlanResult, type ExecutionEvent } from '@/services/projectGeneration';
import { fileSystemService } from '@/services/fileSystem';
import { useUsageStore } from '@/stores/usageStore';
import { useActivityStore } from '@/stores/activityStore';
import { useProjectStore } from '@/stores/projectStore';
import { documentDir } from '@tauri-apps/api/path';
import BackgroundTasksDock from './BackgroundTasksDock';
import { useCommandStore } from '@/stores/commandStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { commandCardService } from '@/services/commandCardService';
import { shouldAutoRunCommand } from '@/services/commandAutoPolicy';
import VerifyFixNotice from './VerifyFixNotice';
import { runService } from '@/services/runService';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  reasoning?: string[];
  model?: AIModel;
  isError?: boolean;
  isStreaming?: boolean;
  thinking?: string;
  activitySessionId?: string;  // Link to ActivityTimeline
  routingInfo?: {
    provider: string;
    taskType: string;
    wasFallback: boolean;
    reason: string;
  };
}

interface ChatViewProps {
  onlineStatus?: boolean;
  showWelcome?: boolean;
}

/* ===== Feature Cards ===== */
const FEATURES = [
  {
    title: 'Créer un projet',
    description: 'Une idée suffit : ANZAR structure, code et génère les fichiers.',
    icon: Code2,
    color: 'from-violet-500 to-indigo-500',
    prompt: 'Je veux créer un nouveau projet',
  },
  {
    title: 'Assistant Étudiant',
    description: 'Mémoires, rapports, exposés, révisions : plan, rédaction et correction.',
    icon: GraduationCap,
    color: 'from-pink-500 to-rose-500',
    prompt: 'Aide-moi avec mon travail académique',
  },
  {
    title: 'Analyser des données',
    description: 'Importe, explore, visualise : graphiques et insights en quelques secondes.',
    icon: BarChart3,
    color: 'from-emerald-500 to-teal-500',
    prompt: 'Je veux analyser des données',
  },
  {
    title: 'Recherche intelligente',
    description: 'Pose ta question : ANZAR cherche, compare et synthétise avec sources.',
    icon: Globe,
    color: 'from-blue-500 to-cyan-500',
    prompt: 'Recherche sur internet',
  },
  {
    title: 'Rédiger un document',
    description: 'Rapports, présentations, emails : clairs, structurés, prêts à envoyer.',
    icon: FileText,
    color: 'from-orange-500 to-amber-500',
    prompt: 'Aide-moi à rédiger un document',
  },
];

/* ===== Suggested Prompts (quick start) ===== */
const QUICK_STARTS = [
  'Crée une application de gestion de stock avec React et SQLite',
  'Corrige et reformule mon mémoire de fin d\'études',
  'Recherche les dernières tendances en intelligence artificielle',
  'Génère un plan détaillé pour mon rapport de stage',
  'Écris un script Python pour automatiser mes tâches',
  'Prépare un exposé sur les énergies renouvelables en Afrique',
];

/* ===== Assistant Étudiant — Menu interactif ===== */
const STUDENT_OPTIONS = [
  {
    id: 'memoire',
    title: 'Rédiger un mémoire',
    description: 'Mémoire de fin d\'études : plan, introduction, développement, conclusion, bibliographie.',
    icon: BookOpen,
    color: 'from-pink-500 to-rose-500',
    prompt: `Tu es un assistant académique expert. L'étudiant veut rédiger un mémoire de fin d'études. Commence par lui demander :
1. Quel est le sujet/thème du mémoire ?
2. Quel est son niveau (Licence, Master, Doctorat) ?
3. A-t-il déjà un plan ou part-il de zéro ?
4. Quelle est la longueur attendue (nombre de pages) ?
5. Y a-t-il des consignes spécifiques de son université ?
Sois professionnel, structuré, et adapte-toi au niveau académique.`,
  },
  {
    id: 'rapport',
    title: 'Rapport de stage',
    description: 'Structure, rédaction et mise en forme de ton rapport de stage professionnel.',
    icon: PenTool,
    color: 'from-violet-500 to-purple-500',
    prompt: `Tu es un assistant académique expert en rapports de stage. L'étudiant veut rédiger un rapport de stage. Demande-lui :
1. Dans quelle entreprise/organisation a-t-il fait son stage ?
2. Quelle était sa mission principale ?
3. Quelle est la durée du stage ?
4. Quel est son niveau (BTS, Licence, Master) ?
5. A-t-il déjà un brouillon ou part-il de zéro ?
Aide-le à structurer : page de garde, remerciements, sommaire, introduction, présentation de l'entreprise, missions, bilan, conclusion.`,
  },
  {
    id: 'correction',
    title: 'Corriger / Reformuler',
    description: 'Upload ton document (PDF, Word) ou colle ton texte. Correction complète sur mesure.',
    icon: ListChecks,
    color: 'from-emerald-500 to-green-500',
    prompt: `Tu es un expert en révision et correction de documents académiques et professionnels. L'étudiant veut faire corriger ou améliorer un document.

Commence par lui dire :
"Bienvenue dans l'assistant de correction ! Tu peux :
📎 **Joindre ton document** (PDF ou Word) avec le bouton 📎 en bas
✍️ **Coller ton texte** directement ici

Ensuite, dis-moi ce que tu veux que je fasse :"

Puis propose ces options :
1. **Correction complète** — orthographe, grammaire, syntaxe, ponctuation, conjugaison
2. **Reformulation** — réécrire pour améliorer la clarté, le style et la fluidité
3. **Mise en forme académique** — structurer selon les normes universitaires (introduction, développement, conclusion, citations, bibliographie)
4. **Amélioration du contenu** — enrichir les arguments, ajouter des transitions, renforcer la cohérence
5. **Adaptation du ton** — passer d'un ton informel à académique, ou l'inverse
6. **Tout corriger** — correction + reformulation + mise en forme complète

IMPORTANT : Quand l'étudiant envoie son document, tu dois :
- Identifier le type de document (mémoire, rapport, dissertation, lettre, etc.)
- Signaler les erreurs par catégorie
- Proposer le texte corrigé avec les changements visibles
- Donner un résumé des améliorations faites
- Si le document est long, traiter section par section

Sois encourageant mais honnête sur la qualité du travail.`,
    opensFileDialog: true,
  },
  {
    id: 'plan',
    title: 'Plan détaillé',
    description: 'Génère un plan structuré pour n\'importe quel travail académique.',
    icon: Layout,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Tu es un assistant académique expert en méthodologie. L'étudiant veut un plan détaillé. Demande-lui :
1. Quel est le sujet ou la problématique ?
2. Quel type de travail ? (mémoire, rapport, dissertation, exposé, thèse)
3. Combien de parties/chapitres sont attendus ?
4. Y a-t-il des contraintes ou consignes spécifiques ?
Propose un plan structuré avec titres, sous-titres et brèves descriptions de chaque section.`,
  },
  {
    id: 'resume',
    title: 'Résumé de cours',
    description: 'Synthétise un cours, un chapitre ou un document en points clés.',
    icon: BookMarked,
    color: 'from-amber-500 to-yellow-500',
    prompt: `Tu es un assistant académique expert en synthèse. L'étudiant veut résumer un cours. Demande-lui :
1. Colle le contenu du cours ou décris le sujet
2. Quel niveau de détail ? (résumé court, fiche de révision détaillée, mind map textuel)
3. Y a-t-il des points spécifiques à mettre en avant ?
Produis un résumé clair, structuré, facile à réviser, avec les concepts clés mis en évidence.`,
  },
  {
    id: 'expose',
    title: 'Préparer un exposé',
    description: 'Plan, contenu, notes de présentation et support pour ton exposé oral.',
    icon: Presentation,
    color: 'from-teal-500 to-cyan-500',
    prompt: `Tu es un assistant académique expert en présentations orales. L'étudiant veut préparer un exposé. Demande-lui :
1. Quel est le sujet de l'exposé ?
2. Quelle est la durée prévue (5 min, 10 min, 20 min) ?
3. C'est individuel ou en groupe ?
4. Y a-t-il un support visuel attendu (PowerPoint, poster) ?
5. Quel est le public (camarades, jury, professeur) ?
Aide-le avec : plan de l'exposé, contenu de chaque partie, notes pour l'oral, conseils de présentation.`,
  },
];

/* ===== Analyser des données — Menu interactif ===== */
const DATA_OPTIONS = [
  {
    id: 'csv_excel',
    title: 'Analyser un fichier CSV/Excel',
    description: 'Importe ton fichier de données et obtiens statistiques, tendances et insights.',
    icon: Table2,
    color: 'from-emerald-500 to-green-500',
    prompt: `Tu es un expert en analyse de données. L'utilisateur veut analyser un fichier de données. Dis-lui :
"Bienvenue dans l'assistant d'analyse ! Tu peux :
📎 **Joindre ton fichier** (CSV, Excel, texte) avec le bouton 📎 en bas
✍️ **Coller tes données** directement ici

Je vais analyser tes données et te fournir :"

Puis propose :
1. **Résumé statistique** — moyennes, médianes, min/max, écart-type, distribution
2. **Tendances et patterns** — évolutions dans le temps, corrélations, anomalies
3. **Nettoyage des données** — valeurs manquantes, doublons, incohérences
4. **Tableaux croisés** — regroupements, comparaisons entre catégories
5. **Recommandations** — insights actionables basés sur les données

Quand l'utilisateur envoie ses données, commence TOUJOURS par un résumé rapide : nombre de lignes/colonnes, types de données détectés, aperçu des premières valeurs. Puis propose les analyses pertinentes.`,
  },
  {
    id: 'visualize',
    title: 'Créer des graphiques',
    description: 'Génère des visualisations claires à partir de tes données.',
    icon: TrendingUp,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Tu es un expert en visualisation de données. L'utilisateur veut créer des graphiques. Demande-lui :
1. Quelles données veux-tu visualiser ? (colle-les ou joins un fichier avec 📎)
2. Quel type de graphique ? (courbe d'évolution, barres comparatives, camembert, scatter plot, histogramme)
3. Que veux-tu mettre en évidence ?

Génère du code Python (matplotlib/seaborn) ou des descriptions précises de graphiques. Explique ce que chaque visualisation révèle sur les données.`,
  },
  {
    id: 'survey',
    title: 'Analyser un sondage/enquête',
    description: 'Traite les résultats d\'un sondage, questionnaire ou formulaire.',
    icon: PieChart,
    color: 'from-violet-500 to-purple-500',
    prompt: `Tu es un expert en analyse de sondages et enquêtes. L'utilisateur a des résultats de sondage à analyser. Demande-lui :
1. Colle les résultats ou joins le fichier avec 📎
2. Combien de répondants ?
3. Quel était l'objectif du sondage ?
4. Y a-t-il des questions spécifiques à analyser en priorité ?

Fournis : distribution des réponses par question, pourcentages, tendances principales, segments intéressants, et une conclusion synthétique avec recommandations.`,
  },
  {
    id: 'compare',
    title: 'Comparer des données',
    description: 'Compare des périodes, des groupes ou des produits entre eux.',
    icon: Filter,
    color: 'from-amber-500 to-orange-500',
    prompt: `Tu es un expert en analyse comparative. L'utilisateur veut comparer des données. Demande-lui :
1. Quelles données veux-tu comparer ? (colle-les ou joins un fichier)
2. Quels groupes/périodes/catégories comparer ?
3. Quels critères sont importants pour la comparaison ?

Produis une analyse structurée : tableau comparatif, écarts significatifs, avantages/inconvénients de chaque option, et recommandation finale.`,
  },
];

/* ===== Recherche intelligente — Menu interactif ===== */
const SEARCH_OPTIONS = [
  {
    id: 'research',
    title: 'Recherche approfondie',
    description: 'Recherche complète sur un sujet avec sources, synthèse et analyse.',
    icon: Search,
    color: 'from-blue-500 to-cyan-500',
    prompt: `Tu es un assistant de recherche expert. L'utilisateur veut une recherche approfondie. Demande-lui :
1. Quel est le sujet de recherche ?
2. Quel niveau de profondeur ? (survol rapide, analyse détaillée, recherche exhaustive)
3. Y a-t-il un angle spécifique ou une question précise ?
4. C'est pour quel contexte ? (travail, études, curiosité personnelle, projet professionnel)

Effectue une recherche web complète, puis fournis :
- Une synthèse structurée avec les points clés
- Les sources et réf��rences
- Les différents points de vue s'il y en a
- Une conclusion avec recommandations

Utilise la recherche web pour trouver des informations actualisées.`,
  },
  {
    id: 'news',
    title: 'Actualités et tendances',
    description: 'Les dernières nouvelles et tendances sur un sujet précis.',
    icon: Newspaper,
    color: 'from-red-500 to-pink-500',
    prompt: `Tu es un journaliste de recherche expert. L'utilisateur veut les dernières actualités. Demande-lui :
1. Sur quel sujet veux-tu les actualités ?
2. Quelle période ? (aujourd'hui, cette semaine, ce mois)
3. Quel domaine ? (tech, business, politique, sport, science, santé, Afrique)

Recherche les actualités les plus récentes sur le web, puis fournis :
- Un résumé des 5-10 actualités les plus importantes
- Les sources pour chaque information
- Les tendances qui se dégagent
- Ce qu'il faut retenir

Utilise la recherche web pour avoir les informations les plus récentes.`,
  },
  {
    id: 'factcheck',
    title: 'Vérifier une information',
    description: 'Vérifie si une affirmation, une rumeur ou un chiffre est vrai.',
    icon: HelpCircle,
    color: 'from-amber-500 to-yellow-500',
    prompt: `Tu es un fact-checker rigoureux. L'utilisateur veut vérifier une information. Demande-lui :
1. Quelle information veux-tu vérifier ?
2. Où as-tu vu/entendu cette information ?

Recherche sur le web pour vérifier, puis donne :
- Verdict : VRAI / FAUX / PARTIELLEMENT VRAI / NON VÉRIFIABLE
- Les preuves pour et contre
- Les sources fiables qui confirment ou infirment
- Le contexte complet de l'information
- Conclusion claire

Sois objectif et cite toujours tes sources.`,
  },
  {
    id: 'compare_options',
    title: 'Comparer des options',
    description: 'Compare des produits, services, technologies ou solutions.',
    icon: Scale,
    color: 'from-green-500 to-emerald-500',
    prompt: `Tu es un expert en analyse comparative. L'utilisateur veut comparer des options. Demande-lui :
1. Quelles options veux-tu comparer ? (produits, services, technologies, villes, formations...)
2. Quels critères sont importants pour toi ? (prix, qualité, facilité, performance...)
3. Quel est le contexte de ta décision ?

Recherche sur le web les informations à jour, puis fournis :
- Un tableau comparatif clair
- Avantages et inconvénients de chaque option
- Le meilleur choix selon différents profils/besoins
- Sources consultées

Sois objectif et factuel.`,
  },
];

/* ===== Rédiger un document — Menu interactif ===== */
const DOCUMENT_OPTIONS = [
  {
    id: 'email_pro',
    title: 'Email professionnel',
    description: 'Rédige un email clair, professionnel et adapté au contexte.',
    icon: Mail,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Tu es un expert en communication professionnelle. L'utilisateur veut rédiger un email. Demande-lui :
1. À qui est destiné l'email ? (patron, client, collègue, fournisseur, recruteur)
2. Quel est l'objet/le but ? (demande, relance, remerciement, réclamation, candidature, information)
3. Quel ton ? (formel, semi-formel, amical mais professionnel)
4. Y a-t-il des points spécifiques à inclure ?

Rédige un email complet avec : objet, formule d'appel, corps structuré, formule de politesse. Propose 2 versions si le ton n'est pas clair (une formelle, une plus décontractée).`,
  },
  {
    id: 'rapport_pro',
    title: 'Rapport professionnel',
    description: 'Rapport d\'activité, de mission, d\'analyse ou de projet.',
    icon: FileCheck,
    color: 'from-emerald-500 to-green-500',
    prompt: `Tu es un expert en rédaction de rapports professionnels. L'utilisateur veut rédiger un rapport. Demande-lui :
1. Quel type de rapport ? (activité, mission, analyse, audit, projet, bilan)
2. Pour qui ? (direction, client, équipe, partenaire)
3. Quelle période couvre-t-il ?
4. Quels sont les points clés à inclure ?
5. Quelle longueur attendue ?

Structure le rapport avec : page de titre, sommaire, résumé exécutif, introduction, développement, conclusion, recommandations, annexes si nécessaire. Utilise un ton professionnel et factuel.`,
  },
  {
    id: 'lettre',
    title: 'Lettre officielle',
    description: 'Lettre de motivation, de réclamation, administrative ou de demande.',
    icon: ScrollText,
    color: 'from-violet-500 to-purple-500',
    prompt: `Tu es un expert en rédaction de lettres officielles et administratives. L'utilisateur veut rédiger une lettre. Demande-lui :
1. Quel type de lettre ? (motivation, réclamation, démission, demande administrative, recommandation, mise en demeure)
2. À qui est-elle adressée ? (entreprise, administration, personne)
3. Quel est le contexte précis ?
4. Y a-t-il des informations obligatoires à inclure ?

Rédige une lettre complète aux normes : lieu/date, coordonnées expéditeur/destinataire, objet, corps structuré avec formules appropriées, signature. Respecte les conventions françaises/africaines selon le contexte.`,
  },
  {
    id: 'article',
    title: 'Article / Post',
    description: 'Article de blog, post LinkedIn, contenu marketing ou éditorial.',
    icon: Megaphone,
    color: 'from-pink-500 to-rose-500',
    prompt: `Tu es un expert en rédaction de contenu et copywriting. L'utilisateur veut rédiger un article ou post. Demande-lui :
1. Quel type ? (article de blog, post LinkedIn, post Instagram, communiqué de presse, newsletter)
2. Quel sujet ?
3. Quel public cible ?
4. Quel ton ? (informatif, engageant, persuasif, inspirant, technique)
5. Quelle longueur ? (court 200 mots, moyen 500 mots, long 1000+ mots)

Rédige le contenu avec : titre accrocheur, introduction captivante, corps structuré, conclusion avec appel à l'action. Optimise pour le format choisi (hashtags pour LinkedIn, sous-titres pour blog, etc.).`,
  },
  {
    id: 'cv',
    title: 'CV et lettre de motivation',
    description: 'Crée ou améliore ton CV et ta lettre de motivation.',
    icon: Briefcase,
    color: 'from-amber-500 to-orange-500',
    prompt: `Tu es un expert en recrutement et rédaction de CV. L'utilisateur veut créer ou améliorer son CV et/ou sa lettre de motivation. Demande-lui :
1. Créer un nouveau CV ou améliorer un existant ? (s'il a un existant, demande-lui de le coller ou joindre avec 📎)
2. Quel poste vise-t-il ?
3. Quel est son niveau d'expérience ? (étudiant, junior, confirmé, senior)
4. Quels sont ses points forts, formations et expériences clés ?

Pour le CV : structure claire, mots-clés adaptés au poste, formulation percutante des expériences (verbes d'action + résultats chiffrés).
Pour la lettre : personnalisée pour l'entreprise/poste, valorise les compétences pertinentes, montre la motivation.`,
  },
  {
    id: 'contrat',
    title: 'Document contractuel',
    description: 'Devis, contrat simple, CGV, facture ou accord de confidentialité.',
    icon: Pen,
    color: 'from-slate-500 to-gray-600',
    prompt: `Tu es un assistant juridique. L'utilisateur veut rédiger un document contractuel. Demande-lui :
1. Quel type de document ? (devis, contrat de prestation, CGV, facture, NDA, accord de partenariat)
2. Entre quelles parties ?
3. Quel est l'objet du contrat/document ?
4. Y a-t-il des clauses spécifiques à inclure ?

Rédige un document professionnel avec les clauses standards. ATTENTION : précise toujours que ce document est un modèle et qu'il est recommandé de le faire valider par un professionnel du droit avant signature.`,
  },
];

// ============================================================================
// INTENT DETECTION — Détecte si le message demande une génération de projet
// ============================================================================

function detectProjectIntent(message: string): boolean {
  const msg = (message || '').trim()
  if (msg.length < 18) return false

  // Heuristiques "anti-faux-positifs"
  if (msg.includes('```')) return false // souvent un extrait de code / logs
  if (/\b(stack trace|traceback|exception)\b/i.test(msg)) return false

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
    /\b(corrige|corriger|fix|débug|debug|bug|erreur|errors?|refactor|optimise|lint|tests?|build)\b/i.test(msg) &&
    !asksToCreate
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

/** Extrait un nom de projet court depuis le message */
function extractProjectName(message: string): string {
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

// ============================================================================
// COMPONENT
// ============================================================================

export default function ChatView({ onlineStatus = true, showWelcome = true }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<AIModel>('fast');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showStudentMenu, setShowStudentMenu] = useState(false);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const [showSearchMenu, setShowSearchMenu] = useState(false);
  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const streamingRef = useRef<string>('');
  const projects = useProjectStore((s) => s.projects);
  const selectedProjectPath = projects.find((p) => p.id === selectedProjectId)?.metadata?.localPath as string | undefined;
  const settings = useSettingsStore((s) => s.settings);

  // Project store actions
  const createProject = useProjectStore((s) => s.createProject);
  const updateAgentStatus = useProjectStore((s) => s.updateAgentStatus);
  const setProjectStatus = useProjectStore((s) => s.setProjectStatus);
  const setProjectProgress = useProjectStore((s) => s.setProjectProgress);
  const updateProject = useProjectStore((s) => s.updateProject);
  const addFile = useProjectStore((s) => s.addFile);
  const loadProjectFromDisk = useProjectStore((s) => s.loadProjectFromDisk);

  // Usage tracking
  const addUsageRecord = useUsageStore((s) => s.addRecord);

  // Activity tracking
  const { startSession, endSession, addStep, completeStep } = useActivityStore();

  // ========================================================================
  // PROJECT GENERATION HANDLER
  // ========================================================================

  const handleProjectGeneration = useCallback(async (
    content: string,
    userMessageId: string,
    sessionId: string,
  ) => {
    const projectName = extractProjectName(content);

    // Create project in store
    const project = createProject(projectName, content, selectedModel);
    const projectId = project.id;

    // ── Create local directory for the project ──
    let localPath: string | undefined;
    try {
      const docsDir = await documentDir();
      localPath = `${docsDir}ANZAR_Projects/${projectName}`;
      await fileSystemService.createDirectory(localPath);
      // Persist localPath in project metadata
      updateProject(projectId, { metadata: { ...project.metadata, localPath } });
    } catch (fsErr) {
      // Non-blocking: project can still be generated in-memory
      console.warn('Could not create local project directory:', fsErr);
    }

    // AI placeholder message for generation progress
    const aiMessageId = `msg_${Date.now() + 1}`;
    setMessages((prev) => [
      ...prev,
      {
        id: aiMessageId,
        type: 'ai',
        content: `🚀 **Génération de projet lancée : ${projectName}**\n\nLe pipeline multi-agents démarre...`,
        timestamp: new Date(),
        model: selectedModel,
        isStreaming: true,
        activitySessionId: sessionId,
      },
    ]);

    const startTime = Date.now();

    try {
      const planStepId = addStep(sessionId, {
        type: 'planning',
        label: 'Orchestrator + Planner — architecture du projet',
      });

      let lastPlan: PlanResult | null = null;

      const plan = await projectGeneration.generate(
        { description: content, project_name: projectName },
        {
          onPhaseChange: (phase, message) => {
            // Keep activity steps meaningful
            if (phase === 'planning') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMessageId
                    ? { ...m, content: `🚀 **${projectName}**\n\n⏳ ${message}` }
                    : m
                )
              );
            }
          },

          onPlanReady: (p) => {
            lastPlan = p;
            completeStep(sessionId, planStepId);
            updateAgentStatus(projectId, 'orchestrator', { status: 'done', progress: 100, message: 'Plan créé' });
            updateAgentStatus(projectId, 'planner', { status: 'done', progress: 100, message: `${p.files.length} fichiers planifiés` });
            setProjectProgress(projectId, 30);

            // Persist backend project id for reference
            updateProject(projectId, {
              metadata: { ...(project.metadata as any), localPath, backendProjectId: p.project_id },
            });

            const fileList = p.files.slice(0, 10).map((f) => `  • \`${f.path}\``).join('\n');
            const moreFiles = p.files.length > 10 ? `\n  ... et ${p.files.length - 10} autres fichiers` : '';
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId
                  ? {
                      ...m,
                      content: `🚀 **${p.title || projectName}**\n\n✅ **Plan prêt** — ${p.files.length} fichiers prévus :\n${fileList}${moreFiles}\n\n⏳ **Coder** génère le code...`,
                    }
                  : m
              )
            );

            // Start execution step
            addStep(sessionId, { type: 'writing', label: 'Coder + Tester + Executor — génération du code' });
            updateAgentStatus(projectId, 'coder', { status: 'working', progress: 10, message: 'Génération du code...' });
          },

          onAgentUpdate: (event: ExecutionEvent) => {
            for (const agent of event.agents) {
              updateAgentStatus(projectId, agent.name, {
                status: agent.status === 'done' ? 'done' : agent.status === 'error' ? 'error' : agent.status === 'running' ? 'working' : 'idle',
                progress: agent.progress,
                message: agent.message || '',
              });
            }
            const totalProgress = event.agents.reduce((sum, a) => sum + a.progress, 0);
            const overallProgress = Math.round(30 + (totalProgress / event.agents.length) * 0.7);
            setProjectProgress(projectId, overallProgress);

            const doneAgents = event.agents.filter((a) => a.status === 'done');
            const agentLines = event.agents
              .map((a) => {
                const icon = a.status === 'done' ? '✅' : a.status === 'running' ? '⏳' : a.status === 'error' ? '❌' : '⬜';
                return `${icon} **${a.name}** — ${a.message || a.status}`;
              })
              .join('\n');

            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId
                  ? {
                      ...m,
                      content: `🚀 **${lastPlan?.title || projectName}**\n\n${agentLines}\n\n_${doneAgents.length}/${event.agents.length} agents terminés_`,
                    }
                  : m
              )
            );
          },

          onComplete: async () => {
            // Sync generated files into the store
            if (localPath) {
              try {
                await loadProjectFromDisk(projectId);
              } catch (syncErr) {
                console.warn('Could not sync project files from disk:', syncErr);
              }
            }

            // Auto-verify after generation
            if (localPath) {
              try {
                await runService.executeVerifyPipeline({ projectId, projectPath: localPath });
              } catch (verifyErr) {
                console.warn('Auto verify failed to start:', verifyErr);
              }
            }
          },

          onError: (errorMsg) => {
            throw new Error(errorMsg);
          },
        },
        localPath
      );

      if (!plan) throw new Error('Erreur lors de la génération');

      // Done
      setProjectStatus(projectId, 'complete');
      setProjectProgress(projectId, 100);
      updateProject(projectId, {
        name: plan.title || projectName,
        description: plan.overview || content,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      addStep(sessionId, { type: 'complete', label: `Projet généré en ${elapsed}s` });
      endSession(sessionId, 'done');

      const fileList = plan.files.slice(0, 10).map((f) => `  • \`${f.path}\``).join('\n');
      const moreFiles = plan.files.length > 10 ? `\n  ... et ${plan.files.length - 10} autres fichiers` : '';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessageId
            ? {
                ...m,
                content: `🎉 **${plan.title || projectName}** — Projet généré avec succès !\n\n` +
                  `📁 **${plan.files.length} fichiers** créés en **${elapsed}s**\n` +
                  `🏗️ Complexité: ${plan.complexity || 'medium'}\n\n` +
                  `**Fichiers générés :**\n${fileList}${moreFiles}\n\n` +
                  (localPath ? `📂 Sauvegardé dans: \`${localPath}\`\n\n` : '') +
                  `👉 Ouvre le projet dans la barre latérale pour voir les fichiers et le code.`,
                isStreaming: false,
                activitySessionId: sessionId,
                routingInfo: {
                  provider: 'deepseek',
                  taskType: 'project_generation',
                  wasFallback: false,
                  reason: 'multi-agent pipeline',
                },
              }
            : m
        )
      );

      useProjectStore.getState().setActiveProject(projectId);

    } catch (error: any) {
      const errorMsg = error?.message || 'Erreur lors de la génération';
      addStep(sessionId, { type: 'error', label: errorMsg.slice(0, 80) });
      endSession(sessionId, 'error');
      setProjectStatus(projectId, 'error', errorMsg);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessageId
            ? {
                ...m,
                content:
                  error?.name === 'AbortError'
                    ? '⏹ Génération arrêtée.'
                    : `❌ **Erreur de génération**\n\n${errorMsg}\n\n_Vérifie ta connexion au backend et tes crédits._`,
                isStreaming: false,
                isError: true,
                activitySessionId: sessionId,
              }
            : m
        )
      );
    }
  }, [selectedModel, createProject, updateAgentStatus, setProjectStatus, setProjectProgress, updateProject, loadProjectFromDisk, addStep, completeStep, endSession]);

  // ========================================================================
  // MAIN MESSAGE HANDLER
  // ========================================================================

  const handleSendMessage = useCallback(async (content: string, hasImages = false) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      type: 'user',
      content,
      timestamp: new Date(),
      model: selectedModel,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    streamingRef.current = '';
    const startTime = Date.now();

    // ── Start activity session ──
    const sessionId = `chat-${Date.now()}`;
    const sessionLabel = content.length > 60 ? content.slice(0, 60) + '...' : content;
    startSession(sessionId, sessionLabel);

    // ══════════════════════════════════════════════════════════════
    // INTENT DETECTION: est-ce une demande de génération de projet ?
    // ══════════════════════════════════════════════════════════════
    if (detectProjectIntent(content)) {
      const detectStepId = addStep(sessionId, {
        type: 'understanding',
        label: 'Intention détectée: génération de projet',
      });
      completeStep(sessionId, detectStepId);

      // Route vers le pipeline multi-agents
      await handleProjectGeneration(content, userMessage.id, sessionId);
      setIsLoading(false);
      return;
    }

    // ══════════════════════════════════════════════════════════════
    // DEFAULT: Chat normal avec tool calling
    // ══════════════════════════════════════════════════════════════

    // Step 1: Understanding
    const understandStepId = addStep(sessionId, {
      type: 'understanding',
      label: 'Compréhension de la demande',
    });

    // Build API messages — le routeur injecte le prompt système optimisé pour le cache
    const rawMessages = [
      {
        role: 'system' as const,
        content:
          "Quand tu veux exécuter une commande, utilise le tool run_command (ne mets pas de commande en bloc ```bash```). Donne d’abord une explication courte, puis propose les commandes via run_command.",
      },
      ...messages.map((m) => ({
        role: (m.type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content },
    ];
    const apiMessages = aiRouter.prepareMessages(rawMessages);

    completeStep(sessionId, understandStepId);

    // Create placeholder AI message for streaming with activity link
    const aiMessageId = `msg_${Date.now() + 1}`;
    const placeholderMessage: Message = {
      id: aiMessageId,
      type: 'ai',
      content: '',
      timestamp: new Date(),
      model: selectedModel,
      isStreaming: true,
      activitySessionId: sessionId,
    };
    setMessages((prev) => [...prev, placeholderMessage]);

    // Routing info captured during stream
    let routingProvider = 'deepseek';
    let routingTaskType = 'chat';
    let routingReason = '';
    let routingWasFallback = false;

    try {
      let fullContent = '';

      // Step 2: Routing / Classification
      const routingStepId = addStep(sessionId, {
        type: 'analyzing',
        label: 'Classification de la tâche',
      });

      // ── DEFAULT: tool-calling (command cards), cowork-style ──
      completeStep(sessionId, routingStepId);
      addStep(sessionId, { type: 'planning', label: 'Propositions de commandes' });

      const tools: ToolDefinition[] = [
        {
          type: 'function',
          function: {
            name: 'run_command',
            description:
              "Propose une commande à exécuter. IMPORTANT: ne l’exécute pas automatiquement sauf si l’app est configurée en auto-run allowlist.",
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string', description: "Commande à exécuter (ex: 'npm test')" },
              },
              required: ['command'],
            },
          },
        },
      ];

      const ensureCard = useCommandStore.getState().ensureCard;
      let idx = 0;
      const toolExecutor = async (name: string, args: Record<string, any>) => {
        if (name !== 'run_command') return JSON.stringify({ ok: false, error: 'Tool inconnu' });
        const cmd = String(args?.command || '').trim();
        if (!cmd) return JSON.stringify({ ok: false, error: 'Commande vide' });
        const cardId = `${aiMessageId}::tool::${idx++}`;
        ensureCard({
          id: cardId,
          messageId: aiMessageId,
          command: cmd,
          title: 'Commande proposée',
          projectId: selectedProjectId,
          projectPath: selectedProjectPath,
        });
        if (selectedProjectPath) {
          const auto = shouldAutoRunCommand(cmd, settings);
          if (auto.ok) void commandCardService.run(cardId);
        }
        return JSON.stringify({ ok: true, cardId, status: 'suggested' });
      };

      const resp = await aiRouter.chatWithTools(apiMessages as any, tools as any, toolExecutor, {
        model: selectedModel,
        enableFallback: true,
        hasImages,
      } as any);

      fullContent = resp?.choices?.[0]?.message?.content || '';

      addStep(sessionId, { type: 'complete', label: `Terminé (${((Date.now() - startTime) / 1000).toFixed(1)}s)` });
      endSession(sessionId, 'done');

      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessageId
            ? {
                ...m,
                content: fullContent,
                isStreaming: false,
                activitySessionId: sessionId,
                routingInfo: {
                  provider: routingProvider,
                  taskType: 'cowork',
                  wasFallback: routingWasFallback,
                  reason: 'cowork-default',
                },
              }
            : m
        )
      );

      // Track usage (approx)
      const inputTokens = Math.ceil(apiMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 4);
      const outputTokens = Math.ceil(fullContent.length / 4);
      const cost = aiRouter.estimateCost(routingProvider as any, selectedModel, inputTokens, outputTokens);
      addUsageRecord({
        timestamp: Date.now(),
        provider: routingProvider as any,
        model: selectedModel,
        taskType: 'cowork',
        inputTokens,
        outputTokens,
        costUSD: cost.costUSD,
        costFCFA: cost.costFCFA,
        wasFallback: routingWasFallback,
        durationMs: Date.now() - startTime,
      });

      return;

    } catch (error: any) {
      // End activity session with error
      addStep(sessionId, {
        type: 'error',
        label: error.name === 'AbortError' ? 'Arrêté par l\'utilisateur' : `Erreur: ${error.message?.slice(0, 80) || 'Connexion échouée'}`,
      });
      endSession(sessionId, 'error');

      const errorContent = error.name === 'AbortError'
        ? '⏹ Génération arrêtée.'
        : `❌ Erreur: ${error.message || 'Connexion échouée. Vérifie ta connexion et la configuration API.'}`;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessageId
            ? { ...m, content: errorContent, isStreaming: false, isError: true, activitySessionId: sessionId }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedModel, messages, addUsageRecord, startSession, endSession, addStep, completeStep, handleProjectGeneration]);

  const handleStopGeneration = useCallback(() => {
    // Stop normal chat streaming
    aiRouter.stopStream();
    // Also abort any running project generation (SSE stream + planning fetch)
    projectGeneration.abort();
    setIsLoading(false);
  }, []);

  const handleQuickStart = useCallback((prompt: string) => {
    handleSendMessage(prompt);
  }, [handleSendMessage]);




  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* Chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {messages.length === 0 && showWelcome ? (
          /* ===== WELCOME SCREEN ===== */
          <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto">
            {/* Hero section */}
            <div className="text-center mb-10 max-w-2xl">
              {/* Logo */}
              <div className="relative inline-block mb-6">
                <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center animate-float shadow-lg">
                  <Wand2 className="w-8 h-8 text-white" />
                </div>
                <div className="absolute inset-0 w-16 h-16 rounded-2xl gradient-bg opacity-25 blur-xl" />
              </div>

              {/* Title */}
              <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">
                Imagine. <span className="gradient-text">ANZAR</span> construit.
              </h1>

              <p className="text-base text-text-secondary max-w-md mx-auto">
                Dis ce que tu veux créer. Ton assistant IA transforme chaque idée en réalité.
              </p>
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 w-full max-w-5xl mb-10">
              {FEATURES.map((feature, idx) => {
                const Icon = feature.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      if (feature.title === 'Assistant Étudiant') {
                        setShowStudentMenu(true);
                      } else if (feature.title === 'Analyser des données') {
                        setShowDataMenu(true);
                      } else if (feature.title === 'Recherche intelligente') {
                        setShowSearchMenu(true);
                      } else if (feature.title === 'Rédiger un document') {
                        setShowDocumentMenu(true);
                      } else {
                        handleQuickStart(feature.prompt || feature.title);
                      }
                    }}
                    className={cn(
                      'group p-4 rounded-xl border border-border-subtle',
                      'bg-surface-default hover:bg-surface-hover',
                      'transition-all duration-300 text-left',
                      'hover:border-accent-primary/30 hover:shadow-lg',
                      'card-hover',
                    )}
                  >
                    <div className={cn(
                      'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3',
                      'group-hover:scale-110 transition-transform duration-300 shadow-md',
                      feature.color
                    )}>
                      <Icon size={20} className="text-white" />
                    </div>
                    <p className="text-sm font-semibold text-text-primary mb-1">
                      {feature.title}
                    </p>
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      {feature.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Quick start suggestions */}
            <div className="flex flex-wrap justify-center gap-2 w-full max-w-4xl">
              {QUICK_STARTS.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickStart(prompt)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs',
                    'bg-surface-default border border-border-subtle',
                    'text-text-secondary hover:text-text-primary',
                    'hover:bg-surface-hover hover:border-accent-primary/30',
                    'transition-all duration-200',
                  )}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ===== MESSAGE LIST ===== */
          <MessageList
            messages={messages}
            isLoading={isLoading}
            selectedProjectId={selectedProjectId}
            selectedProjectPath={selectedProjectPath}
          />
        )}
      </div>

      {/* ===== INPUT BAR ===== */}
      <VerifyFixNotice />
      <ChatInput
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        isLoading={isLoading}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        placeholder="Décris ta tâche, ANZAR s'en occupe..."
      />

      <BackgroundTasksDock />

      {/* ===== STUDENT ASSISTANT MENU (modal overlay) ===== */}
      {showStudentMenu && (
        <FeatureMenuModal
          title="Assistant Étudiant"
          subtitle="Choisis ce dont tu as besoin"
          icon={GraduationCap}
          iconColor="from-pink-500 to-rose-500"
          options={STUDENT_OPTIONS}
          onSelect={(opt) => { setShowStudentMenu(false); handleSendMessage(opt.prompt); }}
          onClose={() => setShowStudentMenu(false)}
        />
      )}

      {/* ===== DATA ANALYSIS MENU (modal overlay) ===== */}
      {showDataMenu && (
        <FeatureMenuModal
          title="Analyser des données"
          subtitle="Choisis ton type d'analyse"
          icon={BarChart3}
          iconColor="from-emerald-500 to-teal-500"
          options={DATA_OPTIONS}
          onSelect={(opt) => { setShowDataMenu(false); handleSendMessage(opt.prompt); }}
          onClose={() => setShowDataMenu(false)}
        />
      )}

      {/* ===== SEARCH MENU (modal overlay) ===== */}
      {showSearchMenu && (
        <FeatureMenuModal
          title="Recherche intelligente"
          subtitle="Quel type de recherche ?"
          icon={Globe}
          iconColor="from-blue-500 to-cyan-500"
          options={SEARCH_OPTIONS}
          onSelect={(opt) => { setShowSearchMenu(false); handleSendMessage(opt.prompt); }}
          onClose={() => setShowSearchMenu(false)}
        />
      )}

      {/* ===== DOCUMENT MENU (modal overlay) ===== */}
      {showDocumentMenu && (
        <FeatureMenuModal
          title="Rédiger un document"
          subtitle="Quel document veux-tu créer ?"
          icon={FileText}
          iconColor="from-orange-500 to-amber-500"
          options={DOCUMENT_OPTIONS}
          onSelect={(opt) => { setShowDocumentMenu(false); handleSendMessage(opt.prompt); }}
          onClose={() => setShowDocumentMenu(false)}
        />
      )}
    </div>
  );
}

/* ===== Reusable Feature Menu Modal ===== */
function FeatureMenuModal({
  title, subtitle, icon: TitleIcon, iconColor, options, onSelect, onClose,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  iconColor: string;
  options: { id: string; title: string; description: string; icon: React.ElementType; color: string; prompt: string }[];
  onSelect: (option: typeof options[number]) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary border border-border-subtle rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md', iconColor)}>
              <TitleIcon size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">{title}</h2>
              <p className="text-xs text-text-muted">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Options grid */}
        <div className={cn(
          'grid gap-3',
          options.length <= 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        )}>
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                onClick={() => onSelect(option)}
                className={cn(
                  'group flex items-start gap-3 p-4 rounded-xl border border-border-subtle',
                  'bg-surface-default hover:bg-surface-hover',
                  'transition-all duration-200 text-left',
                  'hover:border-accent-primary/30 hover:shadow-md',
                )}
              >
                <div className={cn(
                  'w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0',
                  'group-hover:scale-110 transition-transform duration-200 shadow-sm',
                  option.color,
                )}>
                  <Icon size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary mb-0.5">
                    {option.title}
                  </p>
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
