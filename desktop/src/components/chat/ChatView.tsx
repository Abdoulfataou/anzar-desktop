/**
 * ChatView - Vue principale unifiée ANZAR
 * Accueil original + cartes fonctionnalités + chat
 * Routage multi-providers (via backend ANZAR)
 * Câblage agents: détection d'intention projet → pipeline multi-agents
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  FolderOpen,
  WifiOff,
  // Student assistant new features
  Quote, BrainCircuit, ClipboardCheck,
  Shield, Languages, Layers, Dumbbell,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { cn } from '@/lib/utils';
import { AIModel, type Message, type ChatAttachment } from '@/types';
import { aiRouter } from '@/services/router';
import { aiService } from '@/services/ai';
import { projectGeneration, type PlanResult, type ExecutionEvent, type StepEvent, type AgentsEvent, type FileEvent } from '@/services/projectGeneration';
import { fileSystemService } from '@/services/fileSystem';
import { useUsageStore } from '@/stores/usageStore';
import { useActivityStore } from '@/stores/activityStore';
import { useProjectStore } from '@/stores/projectStore';
import { useActiveConversation, useChatStore } from '@/stores/chatStore';
import { documentDir } from '@tauri-apps/api/path';
import BackgroundTasksDock from './BackgroundTasksDock';
import { useCommandStore } from '@/stores/commandStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { commandCardService } from '@/services/commandCardService';
import { shouldAutoRunCommand } from '@/services/commandAutoPolicy';
import VerifyFixNotice from './VerifyFixNotice';
import ProjectWizardModal from './ProjectWizardModal';
import GenerationPanel from './GenerationPanel';
import { runService } from '@/services/runService';
import { isAllowedProjectRoot, showPathNotAllowedMessage } from '@/lib/allowedProjectRoots';
import { generationTracker } from '@/services/generationTracker';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { STUDENT_PROMPTS, AGENT_PROMPTS, SKILL_PROMPTS } from '@/services/studentPrompts';

interface ChatViewProps {
  onlineStatus?: boolean;
  showWelcome?: boolean;
}

/* ===== Feature Cards ===== */
const FEATURES = [
  {
    title: 'Générer un projet',
    description: 'Choisis le type, donne un nom et ANZAR code tout pour toi.',
    icon: Code2,
    color: 'from-violet-500 to-indigo-500',
    prompt: '',
  },
  {
    title: 'Importer un dossier',
    description: 'Travaille sur un projet existant en important un dossier local dans ANZAR.',
    icon: FolderOpen,
    color: 'from-slate-500 to-gray-600',
    // Pas de prompt: action locale (dialog)
    prompt: '',
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

/* ===== Assistant Etudiant - Menu interactif avec categories ===== */
const STUDENT_CATEGORIES: { id: string; label: string; emoji: string }[] = [
  { id: 'all', label: 'Tout', emoji: '' },
  { id: 'redaction', label: 'Redaction', emoji: '' },
  { id: 'correction', label: 'Correction', emoji: '' },
  { id: 'revision', label: 'Revision', emoji: '' },
  { id: 'outils', label: 'Outils', emoji: '' },
];

const STUDENT_OPTIONS = [
  // --- Redaction ---
  {
    id: 'memoire',
    title: 'Memoire',
    description: 'Plan, redaction chapitre par chapitre, biblio',
    icon: BookOpen,
    color: 'from-pink-500 to-rose-500',
    tag: 'Populaire',
    category: 'redaction',
    prompt: STUDENT_PROMPTS.memoire,
  },
  {
    id: 'rapport',
    title: 'Rapport de stage',
    description: 'Page de garde, structure pro, conclusion',
    icon: PenTool,
    color: 'from-violet-500 to-purple-500',
    category: 'redaction',
    prompt: STUDENT_PROMPTS.rapport,
  },
  {
    id: 'plan',
    title: 'Plan detaille',
    description: 'Numerotation academique, objectifs, pages',
    icon: Layout,
    color: 'from-blue-500 to-indigo-500',
    category: 'redaction',
    prompt: STUDENT_PROMPTS.plan,
  },
  {
    id: 'expose',
    title: 'Expose / Oral',
    description: 'Slides, notes orales, export PowerPoint',
    icon: Presentation,
    color: 'from-teal-500 to-cyan-500',
    category: 'redaction',
    prompt: STUDENT_PROMPTS.expose,
  },
  // --- Correction ---
  {
    id: 'correction',
    title: 'Corriger / Reformuler',
    description: 'Langue, style ou correction complete',
    icon: ListChecks,
    color: 'from-emerald-500 to-green-500',
    tag: 'Upload',
    category: 'correction',
    prompt: '',
    opensFileDialog: true,
    subOptions: [
      {
        id: 'correction_langue',
        label: 'Correction langue',
        description: 'Orthographe, grammaire, ponctuation',
        emoji: '',
        prompt: STUDENT_PROMPTS.correction_langue,
      },
      {
        id: 'correction_reformulation',
        label: 'Reformulation',
        description: 'Style, fluidite, phrases elegantes',
        emoji: '',
        prompt: STUDENT_PROMPTS.correction_reformulation,
      },
      {
        id: 'correction_academique',
        label: 'Forme academique',
        description: 'Registre soutenu, transitions',
        emoji: '',
        prompt: STUDENT_PROMPTS.correction_academique,
      },
      {
        id: 'correction_tout',
        label: 'Tout corriger',
        description: 'Langue + style + structure (recommande)',
        emoji: '',
        prompt: STUDENT_PROMPTS.correction_tout,
      },
    ],
  },
  {
    id: 'evaluer',
    title: 'Mode Professeur',
    description: 'Note /20, grille, conseils',
    icon: ClipboardCheck,
    color: 'from-red-500 to-rose-600',
    tag: 'Upload',
    category: 'correction',
    prompt: STUDENT_PROMPTS.evaluer,
    opensFileDialog: true,
  },
  {
    id: 'anti_plagiat',
    title: 'Anti-Plagiat',
    description: 'Detection + reformulation auto',
    icon: Shield,
    color: 'from-red-500 to-orange-500',
    category: 'correction',
    prompt: SKILL_PROMPTS.anti_plagiat,
    opensFileDialog: true,
  },
  // --- Revision ---
  {
    id: 'explique_document',
    title: 'Explique-moi ce document',
    description: 'PDF, Word, PowerPoint, livre, memoire — je t\'explique tout',
    icon: GraduationCap,
    color: 'from-indigo-500 to-violet-500',
    tag: 'Upload',
    category: 'revision',
    prompt: STUDENT_PROMPTS.explique_document,
    opensFileDialog: true,
  },
  {
    id: 'resume',
    title: 'Resume de cours',
    description: 'Fiche de revision, definitions, formules',
    icon: BookMarked,
    color: 'from-amber-500 to-yellow-500',
    tag: 'Upload',
    category: 'revision',
    prompt: STUDENT_PROMPTS.resume,
    opensFileDialog: true,
  },
  {
    id: 'quiz',
    title: 'Quiz de revision',
    description: 'QCM interactif avec corrections',
    icon: BrainCircuit,
    color: 'from-fuchsia-500 to-pink-500',
    category: 'revision',
    prompt: STUDENT_PROMPTS.quiz,
    opensFileDialog: true,
  },
  {
    id: 'flashcards',
    title: 'Flashcards',
    description: 'Cartes recto-verso, mode Anki',
    icon: Layers,
    color: 'from-cyan-500 to-blue-500',
    category: 'revision',
    prompt: SKILL_PROMPTS.flashcards,
    opensFileDialog: true,
  },
  {
    id: 'exercices',
    title: 'Exercices',
    description: 'QCM, vrai/faux, cas pratiques',
    icon: Dumbbell,
    color: 'from-purple-500 to-fuchsia-500',
    category: 'revision',
    prompt: SKILL_PROMPTS.generateur_exercices,
    opensFileDialog: true,
  },
  // --- Outils ---
  {
    id: 'citations',
    title: 'Citations / Biblio',
    description: 'APA, MLA, Chicago, Harvard, IEEE',
    icon: Quote,
    color: 'from-orange-500 to-red-500',
    category: 'outils',
    prompt: STUDENT_PROMPTS.citations,
  },
  {
    id: 'traducteur',
    title: 'Traducteur',
    description: 'FR, EN, AR -- registre academique',
    icon: Languages,
    color: 'from-green-500 to-teal-500',
    category: 'outils',
    prompt: SKILL_PROMPTS.traducteur_academique,
    opensFileDialog: true,
  },
];

/* ===== Analyser des données - Menu interactif ===== */
const DATA_OPTIONS = [
  {
    id: 'csv_excel',
    title: 'Analyser un fichier CSV/Excel',
    description: 'Importe ton fichier de données et obtiens statistiques, tendances et insights.',
    icon: Table2,
    color: 'from-emerald-500 to-green-500',
    prompt: `Je veux analyser un fichier de données (CSV/Excel). À partir du fichier, commence par me donner un aperçu (colonnes, types, 5 premières lignes), puis propose : résumé statistique, tendances/corrélations, nettoyage, tableaux croisés et recommandations.`,
    opensFileDialog: true,
  },
  {
    id: 'visualize',
    title: 'Créer des graphiques',
    description: 'Génère des visualisations claires à partir de tes données.',
    icon: TrendingUp,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Je veux créer des graphiques à partir de mes données. Demande-moi le type de graphique (courbe/barres/camembert/scatter/histogramme) et ce que je veux montrer, puis propose 2-3 graphiques pertinents + explication (et si possible le code Python).`,
    opensFileDialog: true,
  },
  {
    id: 'survey',
    title: 'Analyser un sondage/enquête',
    description: 'Traite les résultats d\'un sondage, questionnaire ou formulaire.',
    icon: PieChart,
    color: 'from-violet-500 to-purple-500',
    prompt: `Je veux analyser les résultats d'un sondage. À partir du fichier, résume d'abord (nb répondants si présent, questions, types de réponses), puis donne : pourcentages, tendances, points surprenants et recommandations.`,
    opensFileDialog: true,
  },
  {
    id: 'compare',
    title: 'Comparer des données',
    description: 'Compare des périodes, des groupes ou des produits entre eux.',
    icon: Filter,
    color: 'from-amber-500 to-orange-500',
    prompt: `Je veux comparer des données (groupes/périodes/produits). À partir du fichier, fais une comparaison claire (écarts, points forts/faibles) puis une recommandation finale.`,
    opensFileDialog: true,
  },
];

/* ===== Recherche intelligente - Menu interactif ===== */
const SEARCH_OPTIONS = [
  {
    id: 'research',
    title: 'Recherche approfondie',
    description: 'Recherche complète sur un sujet avec sources, synthèse et analyse.',
    icon: Search,
    color: 'from-blue-500 to-cyan-500',
    prompt: `Fais une recherche approfondie sur mon sujet avec des sources. Commence par me demander le sujet, le niveau de profondeur et l'angle, puis donne une synthèse structurée + sources + conclusion.`,
  },
  {
    id: 'news',
    title: 'Actualités et tendances',
    description: 'Les dernières nouvelles et tendances sur un sujet précis.',
    icon: Newspaper,
    color: 'from-red-500 to-pink-500',
    prompt: `Donne-moi les dernières actualités sur mon sujet (période + domaine). Résume les 5-10 infos clés, avec sources, tendances et points à retenir.`,
  },
  {
    id: 'factcheck',
    title: 'Vérifier une information',
    description: 'Vérifie si une affirmation, une rumeur ou un chiffre est vrai.',
    icon: HelpCircle,
    color: 'from-amber-500 to-yellow-500',
    prompt: `Je veux vérifier une information. Demande-moi l'affirmation exacte et la source, puis donne un verdict (vrai/faux/partiel/non vérifiable) avec preuves et sources.`,
  },
  {
    id: 'compare_options',
    title: 'Comparer des options',
    description: 'Compare des produits, services, technologies ou solutions.',
    icon: Scale,
    color: 'from-green-500 to-emerald-500',
    prompt: `Compare des options (produits/services/technos). Demande-moi les critères, puis fais une comparaison claire (sans tableau ASCII) + recommandation + sources.`,
  },
];

/* ===== Rédiger un document - Menu interactif ===== */
const DOCUMENT_OPTIONS = [
  {
    id: 'email_pro',
    title: 'Email professionnel',
    description: 'Rédige un email clair, professionnel et adapté au contexte.',
    icon: Mail,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Aide-moi à rédiger un email professionnel. Demande-moi le destinataire, l'objectif, le ton et les points à inclure, puis propose un email complet (objet + corps + formule de politesse).`,
  },
  {
    id: 'rapport_pro',
    title: 'Rapport professionnel',
    description: 'Rapport d\'activité, de mission, d\'analyse ou de projet.',
    icon: FileCheck,
    color: 'from-emerald-500 to-green-500',
    prompt: `Aide-moi à rédiger un rapport professionnel. Demande-moi le type, le destinataire, la période et les points clés, puis propose une structure complète + un exemple de rédaction section par section.`,
  },
  {
    id: 'lettre',
    title: 'Lettre officielle',
    description: 'Lettre de motivation, de réclamation, administrative ou de demande.',
    icon: ScrollText,
    color: 'from-violet-500 to-purple-500',
    prompt: `Aide-moi à rédiger une lettre officielle. Demande-moi le type de lettre, le destinataire, le contexte et les infos obligatoires, puis rédige une lettre complète (date, objet, corps, formule, signature).`,
  },
  {
    id: 'article',
    title: 'Article / Post',
    description: 'Article de blog, post LinkedIn, contenu marketing ou éditorial.',
    icon: Megaphone,
    color: 'from-pink-500 to-rose-500',
    prompt: `Aide-moi à écrire un article/post. Demande-moi le format (blog/LinkedIn/etc.), le sujet, la cible, le ton et la longueur, puis rédige un contenu structuré (titre → intro → sections → conclusion).`,
  },
  {
    id: 'cv',
    title: 'CV et lettre de motivation',
    description: 'Crée ou améliore ton CV et ta lettre de motivation.',
    icon: Briefcase,
    color: 'from-amber-500 to-orange-500',
    prompt: `Aide-moi à créer/améliorer mon CV et/ou ma lettre de motivation. Demande-moi le poste visé, mon expérience, mes formations/compétences et (si j'ai déjà un CV) analyse-le puis propose une version améliorée.`,
    opensFileDialog: true,
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
// INTENT DETECTION - Détecte si le message demande une génération de projet
// ============================================================================

function detectProjectIntent(message: string): boolean {
  const msg = (message || '').trim()
  if (msg.length < 18) return false

  // Heuristiques "anti-faux-positifs"
  if (msg.includes('```')) return false // souvent un extrait de code / logs
  if (/\b(stack trace|traceback|exception)\b/i.test(msg)) return false

  // Prompts de l'assistant étudiant — JAMAIS un projet à générer
  // Couvre : correcteur, reformulation, résumé, quiz, flashcards, exercices, plagiat, traduction, citations, évaluation, plan, mémoire, rapport, exposé, tuteur
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

// ══════════════════════════════════════════════════════════════════════
// DÉTECTION D'INTENTION VISUELLE — route vers Kimi pour images/diagrammes
// ══════════════════════════════════════════════════════════════════════
function detectVisualIntent(message: string): boolean {
  const msg = (message || '').trim().toLowerCase();
  if (msg.length < 8) return false;

  // Prompts de l'assistant étudiant — JAMAIS un routage visuel
  // (ces prompts contiennent des mots comme "illustrer", "schema", "montre" dans le cadre pédagogique)
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
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState<AIModel>('fast');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // When Sidebar clicks "Nouvelle tache" it sets activeProjectId to null.
  // Listen to that and clear the local state so the old project stops following.
  const storeActiveProjectId = useProjectStore((s) => s.activeProjectId);
  const prevStoreRef = useRef(storeActiveProjectId);
  useEffect(() => {
    if (prevStoreRef.current !== null && storeActiveProjectId === null) {
      setSelectedProjectId(null);
    }
    prevStoreRef.current = storeActiveProjectId;
  }, [storeActiveProjectId]);
  const [showStudentMenu, setShowStudentMenu] = useState(false);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const [showSearchMenu, setShowSearchMenu] = useState(false);
  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [generationPanelSessionId, setGenerationPanelSessionId] = useState<string | null>(null);
  const forceProjectGenerationOnceRef = useRef(false);
  const wizardMetaRef = useRef<{ projectType: string; techs: string[] } | null>(null);
  const projectBaseDirOverrideRef = useRef<string | null>(null);
  const lastProjectGenerationWasUserActionRef = useRef(false);

  const prepareProjectGeneration = useCallback(async () => {
    lastProjectGenerationWasUserActionRef.current = true;
    projectBaseDirOverrideRef.current = null;

    // En mode non-tauri (web), pas de choix de dossier
    try {
      const docsDir = await documentDir();
      const defaultBase = `${docsDir}ANZAR/Projects`;
      // Crée le dossier par défaut si possible (non bloquant)
      try {
        await fileSystemService.createDirectory(defaultBase);
      } catch {
        // ignore
      }

      // Proposer (sans insister) le dossier par défaut. Si non, laisser l'utilisateur choisir.
      try {
        const { confirm, open } = await import('@tauri-apps/api/dialog');
        const okDefault = await confirm(
          `Où veux-tu créer le projet ?\n\nPar défaut:\n${defaultBase}\n\nUtiliser cet emplacement ?`,
          { title: 'Emplacement du projet', type: 'info' as any }
        );
        if (okDefault) {
          projectBaseDirOverrideRef.current = defaultBase;
          return;
        }
        const selected = await open({
          directory: true,
          multiple: false,
          title: 'Choisir le dossier de sortie (dans ANZAR)',
        });
        if (selected && typeof selected === 'string') {
          const allowed = await isAllowedProjectRoot(selected);
          if (!allowed) {
            toast.error('Dossier non autorisé. Choisis un dossier dans ton répertoire personnel.');
            projectBaseDirOverrideRef.current = defaultBase;
            return;
          }
          projectBaseDirOverrideRef.current = selected.replace(/\\/g, '/').replace(/\/+$/, '');
          return;
        }
      } catch {
        // ignore - fallback default
      }

      projectBaseDirOverrideRef.current = defaultBase;
    } catch {
      // Pas de documentDir / tauri: fallback sans override
      projectBaseDirOverrideRef.current = null;
    }
  }, []);

  // Chat store (source de vérité pour l'historique / sélection via Sidebar)
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const activeConversation = useActiveConversation();
  const createConversation = useChatStore((s) => s.createConversation);
  const addConversationMessage = useChatStore((s) => s.addMessage);
  const updateConversationMessage = useChatStore((s) => s.updateMessage);
  const isLoading = useChatStore((s) => s.isGenerating);
  const setIsGenerating = useChatStore((s) => s.setIsGenerating);
  const pendingRetry = useChatStore((s) => s.pendingRetry);
  const setPendingRetry = useChatStore((s) => s.setPendingRetry);
  const startStreamingMessage = useChatStore((s) => s.startStreamingMessage);
  const appendStreamingContent = useChatStore((s) => s.appendStreamingContent);
  const finalizeStreamingMessage = useChatStore((s) => s.finalizeStreamingMessage);
  const updateStreamingContent = useChatStore((s) => s.updateStreamingContent);
  const projects = useProjectStore((s) => s.projects);
  const selectedProjectPath = projects.find((p) => p.id === selectedProjectId)?.metadata?.localPath as string | undefined;
  const settings = useSettingsStore((s) => s.settings);
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() => globalThis.navigator?.onLine ?? true);

  // Network listeners (grand public) - n'affiche pas d'alert, juste un état
  useEffect(() => {
    const onOnline = () => setIsBrowserOnline(true);
    const onOffline = () => setIsBrowserOnline(false);
    globalThis.addEventListener?.('online', onOnline);
    globalThis.addEventListener?.('offline', onOffline);
    return () => {
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.removeEventListener?.('offline', onOffline);
    };
  }, []);

  const isEffectivelyOnline = onlineStatus && isBrowserOnline && !settings.offlineMode;

  // Messages affichés (on masque les messages 'tool' pour l'UI actuelle)
  const messages: Message[] = (activeConversation?.messages || []).filter((m) => m.role !== 'tool');

  // ────────────────────────────────────────────────────────────────────────────
  // Import d'un dossier local (projet existant)
  // ────────────────────────────────────────────────────────────────────────────
  const ensureActiveConversation = useCallback(() => {
    // Crée une conversation par défaut si aucune n'est active (sinon addMessage ne fait rien)
    if (!useChatStore.getState().activeConversationId) {
      createConversation(undefined, selectedModel);
    }
  }, [createConversation, selectedModel]);

  const handleImportFolder = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Importer un dossier (projet existant)',
      });

      if (!selected || typeof selected !== 'string') return;

      const allowed = await isAllowedProjectRoot(selected);
      if (!allowed) {
        toast.error('Dossier non autorisé. Choisis un dossier dans ton répertoire personnel.');
        return;
      }

      const folderName = selected.split(/[/\\]/).pop() || 'Projet importé';
      const project = useProjectStore.getState().createProject(folderName, `Projet importé: ${selected}`, selectedModel);
      useProjectStore.getState().updateProject(project.id, {
        status: 'complete',
        metadata: { localPath: selected, imported: true },
      } as any);
      // Optionnel: rendre le projet actif immédiatement
      useProjectStore.getState().setActiveProject(project.id);
      setSelectedProjectId(project.id);
      toast.success(`Projet importé : ${folderName}`);

      // UX "pro": proposer d'ouvrir le workspace, sans insister
      try {
        const { confirm } = await import('@tauri-apps/api/dialog');
        const ok = await confirm(
          `Projet importé : ${folderName}\n\nChemin:\n${selected}\n\nOuvrir le projet maintenant ?`,
          { title: 'Projet importé', type: 'info' as any }
        );
        if (ok) navigate(`/projects/${project.id}`);
      } catch {
        // Fallback web: pas de dialog natif, rester non-intrusif
      }
    } catch (err) {
      console.error('Import folder failed:', err);
      // Feedback minimal dans le chat
      ensureActiveConversation();
      const msgId = `msg_${Date.now()}`;
      const content = `Impossible d'ouvrir le selecteur de dossier. (Fonction disponible sur l'app desktop Tauri.)`;
      addConversationMessage({
        id: msgId,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        model: selectedModel,
        isError: true,
      });
      toast.error("Impossible d'importer le dossier");
    }
  }, [selectedModel, ensureActiveConversation, addConversationMessage, navigate]);

  // Auto-init au premier montage
  useEffect(() => {
    if (!activeConversationId) {
      createConversation(undefined, selectedModel);
    }
  }, [activeConversationId, createConversation, selectedModel]);

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
  const startSession = useActivityStore((s) => s.startSession);
  const endSession = useActivityStore((s) => s.endSession);
  const addStep = useActivityStore((s) => s.addStep);
  const completeStep = useActivityStore((s) => s.completeStep);
  const setTodos = useActivityStore((s) => s.setTodos);
  const updateTodo = useActivityStore((s) => s.updateTodo);
  const addContextFile = useActivityStore((s) => s.addContextFile);
  const setContextPercent = useActivityStore((s) => s.setContextPercent);
  const incrementStat = useActivityStore((s) => s.incrementStat);

  // ========================================================================
  // PROJECT GENERATION HANDLER
  // ========================================================================

  const handleProjectGeneration = useCallback(async (
    content: string,
    userMessageId: string,
    sessionId: string,
  ) => {
    setIsGenerating(true);
    const projectName = extractProjectName(content);

    // Open the TRAE-style generation panel
    setGenerationPanelSessionId(sessionId);

    // Create project in store
    const project = createProject(projectName, content, selectedModel);
    const projectId = project.id;

    // ── Create local directory for the project ──
    let localPath: string | undefined;
    try {
      const docsDir = await documentDir();
      const base = projectBaseDirOverrideRef.current || `${docsDir}ANZAR/Projects`;
      // Ensure base dir exists
      try {
        await fileSystemService.createDirectory(base);
      } catch {
        // ignore
      }
      localPath = `${base}/${projectName}`;
      await fileSystemService.createDirectory(localPath);
      // Persist localPath in project metadata
      updateProject(projectId, { metadata: { ...project.metadata, localPath } });
    } catch (fsErr) {
      // Non-blocking: project can still be generated in-memory
      console.warn('Could not create local project directory:', fsErr);
    }

    // AI placeholder message for generation progress
    const aiMessageId = `msg_${Date.now() + 1}`;
    ensureActiveConversation();
    // Persist dans l'historique (source unique)
    addConversationMessage({
      id: aiMessageId,
      role: 'assistant',
      content: `**${projectName}** - Preparation en cours...`,
      timestamp: Date.now(),
      model: selectedModel,
      isStreaming: true,
      activitySessionId: sessionId,
    });

    const startTime = Date.now();

    try {
      const planStepId = addStep(sessionId, {
        type: 'planning',
        label: 'Architecture du projet',
      });

      let lastPlan: PlanResult | null = null;
      const addedSteps = new Set<string>();
      const writtenFiles = new Set<string>(); // Track files already written to disk (for resume)

      const wizardMeta = wizardMetaRef.current;
      wizardMetaRef.current = null;

      const plan = await projectGeneration.generate(
        {
          description: content,
          project_name: projectName,
          project_type: wizardMeta?.projectType || 'other',
          tech_stack: wizardMeta?.techs || [],
        },
        {
          onPhaseChange: (phase, message) => {
            if (phase === 'planning') {
              addStep(sessionId, { type: 'planning', label: 'Planification de l\'architecture' });
              updateConversationMessage(aiMessageId, { content: `**${projectName}**\n\nPlanification de l'architecture...` });
            } else if (phase === 'planned') {
              updateConversationMessage(aiMessageId, { content: `**${projectName}**\n\n${message || 'Plan pret.'}` });
            } else if (phase === 'executing') {
              updateConversationMessage(aiMessageId, { content: `**${projectName}**\n\nGeneration du code en cours...` });
            }
          },

          onPlanReady: (p) => {
            lastPlan = p;
            completeStep(sessionId, planStepId);
            updateAgentStatus(projectId, 'orchestrator', { status: 'done', progress: 100, message: 'Architecture definie' });
            updateAgentStatus(projectId, 'planner', { status: 'done', progress: 100, message: p.files.length + ' fichiers planifies' });
            setProjectProgress(projectId, 30);

            // Persist backend project id for reference
            updateProject(projectId, {
              metadata: { ...(project.metadata as any), localPath, backendProjectId: p.project_id },
            });

            // Register background tracker so generation survives navigation
            generationTracker.track(projectId, p.project_id, p.title || projectName);

            // ── Populate TRAE-style Todos from plan phases ──
            const todoItems: { label: string; status: 'pending' | 'active' | 'done' }[] = [
              { label: 'Analyser la demande', status: 'done' },
              { label: 'Planifier l\'architecture', status: 'done' },
              { label: 'Generer le code (' + p.files.length + ' fichiers)', status: 'active' },
            ];
            if (p.phases && p.phases.length > 0) {
              for (const phase of p.phases) {
                todoItems.push({ label: phase.name, status: 'pending' });
              }
            }
            todoItems.push(
              { label: 'Tester et valider', status: 'pending' },
              { label: 'Ecrire les fichiers sur le PC', status: 'pending' },
            );
            setTodos(sessionId, todoItems);

            // ── Populate Context files from plan ──
            setContextPercent(sessionId, 25);
            for (const f of p.files) {
              addContextFile(sessionId, {
                path: f.path,
                type: 'file',
                status: 'reading',
              });
            }

            addStep(sessionId, { type: 'complete', label: 'Architecture: ' + p.files.length + ' fichiers planifies' });
            addStep(sessionId, { type: 'writing', label: 'Generation du code' });

            const nextContent =
              '**' + (p.title || projectName) + '**\n\n' +
              'Architecture validee - ' + p.files.length + ' fichiers prevus.\n\n' +
              'Generation du code en cours...';
            updateConversationMessage(aiMessageId, { content: nextContent });

            updateAgentStatus(projectId, 'coder', { status: 'working', progress: 10, message: 'Generation du code...' });
          },

          onAgentUpdate: (event: ExecutionEvent) => {
            // ── Handle file content events — write to disk immediately ──
            if (event.type === 'file') {
              const fileEvt = event as FileEvent;
              if (localPath && !writtenFiles.has(fileEvt.path)) {
                const fullPath = `${localPath}/${fileEvt.path}`;
                const tmpPath = `${fullPath}.tmp`;
                const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));

                // Atomic write: .tmp → rename (async, fire-and-forget in SSE handler)
                (async () => {
                  try {
                    await fileSystemService.createDirectory(parentDir).catch(() => {});
                    await fileSystemService.writeFile(tmpPath, fileEvt.content);
                    // Rename .tmp → final (atomic)
                    try {
                      await fileSystemService.renameFile(tmpPath, fullPath);
                    } catch {
                      // renameFile may not exist — fallback: write directly
                      await fileSystemService.writeFile(fullPath, fileEvt.content);
                      await fileSystemService.deleteFile(tmpPath).catch(() => {});
                    }
                    writtenFiles.add(fileEvt.path);
                    incrementStat(sessionId, 'filesCreated');
                    addContextFile(sessionId, { path: fileEvt.path, type: 'file', status: 'done' });
                    addStep(sessionId, { type: 'creating', label: `Ecrit ${fileEvt.path}`, filePath: fileEvt.path });
                  } catch (err) {
                    console.warn('Failed to write file:', fileEvt.path, err);
                    addStep(sessionId, { type: 'error', label: `Erreur ecriture ${fileEvt.path}` });
                  }
                })();
              }
              return;
            }

            // ── Handle granular step events (TRAE-style) ──
            if (event.type === 'step') {
              const step = event as StepEvent;
              const actionMap: Record<string, string> = {
                reading: 'reading',
                thinking: 'thinking',
                writing: 'writing',
                creating: 'creating',
                testing: 'testing',
                complete: 'complete',
                error: 'error',
              };
              const stepType = actionMap[step.action] || 'thinking';
              const stepKey = 'step:' + step.action + ':' + step.label;
              if (!addedSteps.has(stepKey)) {
                addedSteps.add(stepKey);
                addStep(sessionId, {
                  type: stepType as any,
                  label: step.label,
                  filePath: step.file || undefined,
                });
              }

              // ── Update context panel with file info ──
              if (step.file) {
                if (step.action === 'writing' || step.action === 'creating') {
                  addContextFile(sessionId, { path: step.file, type: 'file', status: 'writing' });
                  incrementStat(sessionId, 'filesCreated');
                } else if (step.action === 'reading') {
                  addContextFile(sessionId, { path: step.file, type: 'file', status: 'reading' });
                }
              }
              if (step.action === 'testing') {
                updateTodo(sessionId, 'todo-' + (lastPlan ? lastPlan.phases.length + 2 : 4), 'active');
              }

              // Update context percent based on progress
              const totalFiles = lastPlan?.files.length || 10;
              const writtenCount = [...addedSteps].filter((k) => k.startsWith('step:writing:') || k.startsWith('step:creating:')).length;
              setContextPercent(sessionId, Math.min(90, 25 + Math.round((writtenCount / totalFiles) * 65)));

              // Update chat message with the latest step label
              if (step.action !== 'complete') {
                const nextContent =
                  '**' + (lastPlan?.title || projectName) + '**\n\n' +
                  step.label;
                updateConversationMessage(aiMessageId, { content: nextContent });
              }
              return;
            }

            // ── Handle agent status events (progress tracking) ──
            const agentsEvent = event as AgentsEvent;
            for (const agent of agentsEvent.agents) {
              updateAgentStatus(projectId, agent.name, {
                status: agent.status === 'done' ? 'done' : agent.status === 'error' ? 'error' : agent.status === 'running' ? 'working' : 'idle',
                progress: agent.progress,
                message: agent.message || '',
              });

              // ── Update todos based on agent completion ──
              if (agent.name === 'coder' && agent.status === 'done') {
                updateTodo(sessionId, 'todo-2', 'done'); // "Generer le code"
              }
              if (agent.name === 'tester' && agent.status === 'done') {
                const testTodoIdx = lastPlan ? lastPlan.phases.length + 2 : 4;
                updateTodo(sessionId, 'todo-' + testTodoIdx, 'done');
              }
            }

            const totalProgress = agentsEvent.agents.reduce((sum, a) => sum + a.progress, 0);
            const overallProgress = Math.round(30 + (totalProgress / agentsEvent.agents.length) * 0.7);
            setProjectProgress(projectId, overallProgress);

            const doneAgents = agentsEvent.agents.filter((a) => a.status === 'done');
            const runningAgent = agentsEvent.agents.find((a) => a.status === 'running');
            const total = agentsEvent.agents.length;

            const statusLine = runningAgent
              ? (runningAgent.message || runningAgent.name)
              : doneAgents.length === total ? 'Finalisation...' : 'En cours...';

            const nextContent =
              '**' + (lastPlan?.title || projectName) + '**\n\n' +
              statusLine;
            updateConversationMessage(aiMessageId, { content: nextContent });
          },

          onComplete: async (backendProjectId: string) => {
            // SSE stream completed — stop background tracker
            generationTracker.untrack(projectId);

            const writeTodoIdx = lastPlan ? lastPlan.phases.length + 3 : 5;

            // ── Reprise sur coupure: download only MISSING files ──
            if (localPath && backendProjectId) {
              try {
                // Check if all files were already written via SSE streaming
                const expectedFiles = lastPlan?.files.map((f) => f.path) || [];
                const missingFiles = expectedFiles.filter((p) => !writtenFiles.has(p));

                if (missingFiles.length > 0) {
                  // Some files missed during SSE — fallback to /download-files
                  updateTodo(sessionId, 'todo-' + writeTodoIdx, 'active');
                  addStep(sessionId, { type: 'reading', label: `Recuperation de ${missingFiles.length} fichier(s) manquant(s)` });

                  const allFiles = await projectGeneration.downloadFiles(backendProjectId);

                  for (const missingPath of missingFiles) {
                    const content = allFiles[missingPath];
                    if (!content) continue;

                    const fullPath = `${localPath}/${missingPath}`;
                    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
                    await fileSystemService.createDirectory(parentDir).catch(() => {});
                    await fileSystemService.writeFile(fullPath, content);
                    writtenFiles.add(missingPath);
                    addStep(sessionId, { type: 'creating', label: `Ecrit ${missingPath}`, filePath: missingPath });
                  }
                }

                // Mark todo as done + context 100%
                updateTodo(sessionId, 'todo-' + writeTodoIdx, 'done');
                setContextPercent(sessionId, 100);

                addStep(sessionId, { type: 'complete', label: `${writtenFiles.size} fichiers ecrits sur le PC` });

                // Sync into project store
                await loadProjectFromDisk(projectId);
              } catch (syncErr) {
                console.warn('Could not sync project files:', syncErr);
                addStep(sessionId, { type: 'error', label: 'Erreur lors de la synchronisation des fichiers' });
              }
            }
          },

          onError: (errorMsg) => {
            generationTracker.untrack(projectId);
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
      addStep(sessionId, { type: 'complete', label: `Projet genere en ${elapsed}s` });
      endSession(sessionId, 'done');

      const nextContent =
        `**${plan.title || projectName}** - Projet pret !\n\n` +
        `${plan.files.length} fichiers crees en ${elapsed}s.\n\n` +
        `Tu peux ouvrir le projet depuis la barre laterale pour explorer les fichiers et le code.`;
      updateConversationMessage(aiMessageId, {
        content: nextContent,
        isStreaming: false,
        activitySessionId: sessionId,
        routingInfo: {
          provider: 'deepseek',
          taskType: 'project_generation',
          wasFallback: false,
          reason: 'multi-agent pipeline',
        },
      });

      useProjectStore.getState().setActiveProject(projectId);
      setSelectedProjectId(projectId);

      // UX pro: proposer d'ouvrir le workspace seulement si l'utilisateur a cliqué sur "Générer un projet"
      if (lastProjectGenerationWasUserActionRef.current) {
        lastProjectGenerationWasUserActionRef.current = false;
        try {
          const { confirm } = await import('@tauri-apps/api/dialog');
          const ok = await confirm(
            `Projet généré : ${plan.title || projectName}\n\nOuvrir le workspace maintenant ?`,
            { title: 'Projet prêt', type: 'info' as any }
          );
          if (ok) navigate(`/projects/${projectId}`);
        } catch {
          // ignore
        }
      }

    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';
      const errorMsg = error?.message || 'Erreur lors de la generation';

      if (isAbort) {
        // User explicitly cancelled — stop tracking, backend will also stop
        generationTracker.untrack(projectId);
      } else {
        // Real error (network, credits, etc.) — stop tracking
        generationTracker.untrack(projectId);
      }

      addStep(sessionId, { type: 'error', label: errorMsg.slice(0, 80) });
      endSession(sessionId, 'error');
      setProjectStatus(projectId, 'error', errorMsg);

      const isCredit = /solde|insuffisant|credit|402|epuis/i.test(errorMsg);
      const nextContent = isAbort
        ? 'Generation annulee.'
        : isCredit
          ? 'Credits insuffisants. Recharge ton compte pour continuer.'
          : 'Une erreur est survenue. Verifie ta connexion et reessaie.';
      updateConversationMessage(aiMessageId, {
        content: nextContent,
        isStreaming: false,
        isError: true,
        activitySessionId: sessionId,
      });
    } finally {
      // Reset l'override après usage (évite de réutiliser un vieux dossier par accident)
      projectBaseDirOverrideRef.current = null;
      setIsGenerating(false);
    }
  }, [
    selectedModel,
    createProject,
    updateAgentStatus,
    setProjectStatus,
    setProjectProgress,
    updateProject,
    loadProjectFromDisk,
    addStep,
    completeStep,
    endSession,
    setTodos,
    updateTodo,
    addContextFile,
    setContextPercent,
    incrementStat,
    ensureActiveConversation,
    addConversationMessage,
    updateConversationMessage,
    setIsGenerating,
    navigate,
  ]);

  // ========================================================================
  // MAIN MESSAGE HANDLER
  // ========================================================================

  const handleSendMessage = useCallback(async (
    content: string,
    hasImages = false,
    opts?: { skipUserMessage?: boolean; userMessageId?: string; attachments?: ChatAttachment[] }
  ): Promise<boolean> => {
    if (!content.trim()) return false;

    // Assure une conversation active (sinon l'historique Sidebar ne suivra pas)
    ensureActiveConversation();
    setIsGenerating(true);

    const userMessageId = opts?.userMessageId || `msg_${Date.now()}`;

    if (!isEffectivelyOnline) {
      // En mode "retry" (pas de doublon dans le chat) => toast uniquement
      if (opts?.skipUserMessage) {
        toast.error("Hors ligne - impossible d'envoyer pour le moment.");
        setPendingRetry({
          userMessageId,
          content,
          hasImages,
          model: selectedModel,
          attempts: 1,
          lastError: 'offline',
        });
        setIsGenerating(false);
        return false;
      }
      addConversationMessage({
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: 'Hors ligne - connecte-toi à internet pour continuer. Tu peux préparer ton message et réessayer.',
        timestamp: Date.now(),
        isError: true,
        model: selectedModel,
      });
      setIsGenerating(false);
      return false;
    }

    if (!opts?.skipUserMessage) {
      const atts = (opts?.attachments || []).slice(0, 8).map((a, idx) => ({
        ...a,
        ref: String.fromCharCode(65 + idx),
      }));
      const userMessage: Message = {
        id: userMessageId,
        content,
        role: 'user',
        timestamp: Date.now(),
        model: selectedModel,
        attachments: atts.length > 0 ? atts : undefined,
      };
      addConversationMessage(userMessage);
    }
    const startTime = Date.now();

    // ── Start activity session ──
    const sessionId = `chat-${Date.now()}`;
    const sessionLabel = content.length > 60 ? content.slice(0, 60) + '...' : content;
    startSession(sessionId, sessionLabel);

    // ══════════════════════════════════════════════════════════════
    // INTENT DETECTION: est-ce une demande de génération de projet ?
    // ══════════════════════════════════════════════════════════════
    const forceProject = forceProjectGenerationOnceRef.current;
    if (forceProject) forceProjectGenerationOnceRef.current = false;

    if (forceProject || detectProjectIntent(content)) {
      const detectStepId = addStep(sessionId, {
        type: 'understanding',
        label: 'Preparation du projet',
      });
      completeStep(sessionId, detectStepId);

      // Route vers le pipeline multi-agents
      await handleProjectGeneration(content, userMessageId, sessionId);
      return true;
    }

    // ══════════════════════════════════════════════════════════════
    // INTENT DETECTION: demande visuelle → routage vers Kimi
    // ══════════════════════════════════════════════════════════════
    const isVisualRequest = detectVisualIntent(content);

    // ══════════════════════════════════════════════════════════════
    // DEFAULT: Chat normal avec tool calling
    // ══════════════════════════════════════════════════════════════

    // Step 1: Understanding
    const understandStepId = addStep(sessionId, {
      type: 'understanding',
      label: isVisualRequest ? 'Détection de demande visuelle' : 'Compréhension de la demande',
    });

      // Build API messages - le routeur injecte le prompt système optimisé pour le cache
    const history = useChatStore
      .getState()
      .getMessagesForAPI()
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system');

    const systemPrompt = isVisualRequest
      ? `Tu es ANZAR, un assistant IA expert en création de contenu visuel. Tu es spécialisé dans la génération d'images, diagrammes, schémas, graphiques et illustrations.

Quand on te demande un diagramme ou schéma :
- Utilise le format Mermaid (entre des blocs \`\`\`mermaid) pour les diagrammes de flux, séquence, classe, état, ER, Gantt, pie charts, mind maps, etc.
- Utilise SVG (entre des blocs \`\`\`svg ou \`\`\`html) pour les illustrations personnalisées, infographies ou visuels complexes.
- Structure le diagramme de manière claire et lisible avec des labels en français.

Quand on te demande une image ou illustration :
- Décris l'image en détail et génère un SVG si possible.
- Pour les graphiques de données, utilise Mermaid pie/bar/line charts.

Quand on te demande un organigramme, flowchart ou carte mentale :
- Utilise Mermaid flowchart (graph TD/LR) ou mindmap.

Réponds TOUJOURS avec le contenu visuel demandé (Mermaid ou SVG), accompagné d'une brève explication. Ne te contente jamais de décrire — génère le visuel.`
      : "Tu es ANZAR, un assistant IA intelligent. Tu peux chercher des informations sur le web. Si tu proposes des commandes, mets-les dans un bloc ```bash```.";

      const rawMessages = [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      ...history.map((m) => ({ role: m.role as any, content: m.content })),
    ];
    const apiMessages = aiRouter.prepareMessages(rawMessages);

    completeStep(sessionId, understandStepId);

    // Create placeholder AI message for streaming with activity link
    const aiMessageId = `msg_${Date.now() + 1}`;
    addConversationMessage({
      id: aiMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: selectedModel,
      isStreaming: true,
      activitySessionId: sessionId,
    });
    // Real-time streaming state in store (token-by-token)
    startStreamingMessage(aiMessageId);
    updateStreamingContent('');

    // Routing info captured during stream
    let routingProvider = isVisualRequest ? 'kimi' : 'deepseek';
    let routingTaskType = isVisualRequest ? 'visual' : 'chat';
    let routingReason = isVisualRequest ? 'visual-intent-detected' : '';
    let routingWasFallback = false;

    try {
      let fullContent = '';
      let reasoningContent = '';

      // Step 2: Routing / Classification
      const routingStepId = addStep(sessionId, {
        type: 'analyzing',
        label: isVisualRequest ? 'Routage vers Kimi (visuel)' : 'Classification de la tache',
      });

      completeStep(sessionId, routingStepId);
      addStep(sessionId, { type: 'planning', label: isVisualRequest ? 'Génération du contenu visuel' : 'Recherche et redaction' });

      // Route: Kimi pour le visuel, DeepSeek smartChat pour le reste
      if (isVisualRequest) {
        const resp = await aiService.chat(apiMessages as any, {
          provider: 'kimi',
          model: selectedModel,
          temperature: 0.7,
        });
        fullContent = resp?.choices?.[0]?.message?.content || '';
      } else {
        const modelId = aiService.resolveModel('deepseek', selectedModel);

        const resp = await aiService.smartChat(apiMessages as any, {
          model: modelId,
          temperature: 0.7,
        });

        fullContent = resp?.choices?.[0]?.message?.content || '';
        reasoningContent = resp?.choices?.[0]?.message?.reasoning_content || '';

        // Extract bash commands from response and create command cards
        const ensureCard = useCommandStore.getState().ensureCard;
        const bashRegex = /```(?:bash|sh|shell)\n([\s\S]*?)```/g;
        let cmdMatch: RegExpExecArray | null;
        let cardIdx = 0;
        while ((cmdMatch = bashRegex.exec(fullContent)) !== null) {
          const cmds = cmdMatch[1].trim().split('\n').filter((l: string) => l.trim() && !l.trim().startsWith('#'));
          for (const cmd of cmds) {
            const cardId = `${aiMessageId}::tool::${cardIdx++}`;
            ensureCard({
              id: cardId,
              messageId: aiMessageId,
              command: cmd.trim(),
              title: 'Commande proposee',
              projectId: selectedProjectId,
              projectPath: selectedProjectPath,
            });
            if (selectedProjectPath) {
              const auto = shouldAutoRunCommand(cmd.trim(), settings);
              if (auto.ok) void commandCardService.run(cardId);
            }
          }
        }
      } // end else (DeepSeek path)

      addStep(sessionId, { type: 'complete', label: `Terminé (${((Date.now() - startTime) / 1000).toFixed(1)}s)` });
      endSession(sessionId, 'done');

      // Stream the final content progressively (token-by-token UX)
      // Note: tool calling itself is non-streaming, but we still render the answer incrementally.
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      if (fullContent.length <= 420) {
        // Réponse courte => afficher immédiatement (plus fluide)
        updateStreamingContent(fullContent);
      } else {
        // Réponse longue => incrémental mais rapide (évite une attente artificielle)
        const chunkSize = 80;
        for (let i = 0; i < fullContent.length; i += chunkSize) {
          if (!useChatStore.getState().isGenerating) break;
          appendStreamingContent(fullContent.slice(i, i + chunkSize));
          // Yield de temps en temps pour garder l'UI réactive
          if (i % (chunkSize * 6) === 0) await sleep(0);
        }
      }
      // Finalize (marks message as non-streaming + clears streamingContent/isGenerating)
      finalizeStreamingMessage();
      // Persist metadata after finalize (routing/activity + reasoning)
      const msgUpdate: Record<string, any> = {
        activitySessionId: sessionId,
        routingInfo: {
          provider: routingProvider,
          taskType: routingTaskType,
          wasFallback: routingWasFallback,
          reason: routingReason || 'smart-chat-with-search',
        },
      };
      if (reasoningContent) {
        msgUpdate.reasoning = [reasoningContent];
        msgUpdate.thinking = true;
      }
      updateConversationMessage(aiMessageId, msgUpdate);

      // Track usage (approx)
      const inputTokens = Math.ceil(apiMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 4);
      const outputTokens = Math.ceil(fullContent.length / 4);
      const cost = aiRouter.estimateCost(routingProvider as any, selectedModel, inputTokens, outputTokens);
      addUsageRecord({
        timestamp: Date.now(),
        provider: routingProvider as any,
        model: selectedModel,
        taskType: routingTaskType,
        inputTokens,
        outputTokens,
        costUSD: cost.costUSD,
        costFCFA: cost.costFCFA,
        wasFallback: routingWasFallback,
        durationMs: Date.now() - startTime,
      });

      // Si un retry était en attente et qu'on a réussi, on le clear
      if (useChatStore.getState().pendingRetry?.userMessageId === userMessageId) {
        setPendingRetry(null);
      }
      return true;

    } catch (error: any) {
      // End activity session with error
      addStep(sessionId, {
        type: 'error',
        label: error.name === 'AbortError' ? 'Arrêté par l\'utilisateur' : `Erreur: ${error.message?.slice(0, 80) || 'Connexion échouée'}`,
      });
      endSession(sessionId, 'error');

      const errMsg = error.message || '';
      const isCreditErr = /solde|insuffisant|credit|402|epuis|recharg/i.test(errMsg);
      const isTimeoutErr = /timeout|trop de temps/i.test(errMsg);
      const isNetworkErr = /hors ligne|pas de connexion|failed to fetch|network|impossible de joindre/i.test(errMsg);
      const isAuthErr = /authentification|401|token.*invalide|token.*expir/i.test(errMsg);
      const isConfigErr = /configuration|service IA/i.test(errMsg);
      const errorContent = error.name === 'AbortError'
        ? "Generation annulee."
        : isCreditErr
          ? "Credits insuffisants. Recharge ton compte pour continuer."
          : isTimeoutErr
            ? "Le serveur met trop de temps a repondre. Clique 'Reessayer' ci-dessous."
            : isNetworkErr
              ? "Probleme de connexion. Verifie ton internet et clique 'Reessayer'."
              : isAuthErr
                ? "Session expiree. Reconnecte-toi et reessaie."
                : isConfigErr
                  ? "Probleme temporaire du service. Reessaie dans quelques instants."
                  : `${errMsg.slice(0, 150) || 'Probleme inattendu'}. Clique \'Reessayer\'.`;

      // Stop any pending UI streaming
      useChatStore.getState().stopGeneration();
      updateConversationMessage(aiMessageId, {
        content: errorContent,
        isStreaming: false,
        isError: true,
        activitySessionId: sessionId,
      });

      // Si c'est un problème réseau, on prépare un retry automatique (discret)
      const msg = String(error?.message || '');
      const looksNetwork =
        /hors ligne/i.test(msg) ||
        /failed to fetch/i.test(msg) ||
        /timeout/i.test(msg) ||
        /connexion échouée/i.test(msg) ||
        /network/i.test(msg);
      if (looksNetwork) {
        const prev = useChatStore.getState().pendingRetry;
        const prevAttempts = prev?.userMessageId === userMessageId ? prev.attempts : 0;
        if (prevAttempts < 3) {
          setPendingRetry({
            userMessageId,
            content,
            hasImages,
            model: selectedModel,
            attempts: prevAttempts + 1,
            lastError: msg,
          });
        }
        if (!prev) {
          toast('Connexion instable - réessai automatique dès que possible.', { id: 'net-auto' });
        }
      }
      return false;
    } finally {
      setIsGenerating(false);
    }
  }, [
    selectedModel,
    addUsageRecord,
    startSession,
    endSession,
    addStep,
    completeStep,
    handleProjectGeneration,
    ensureActiveConversation,
    addConversationMessage,
    updateConversationMessage,
    selectedProjectId,
    selectedProjectPath,
    settings,
    setIsGenerating,
    startStreamingMessage,
    updateStreamingContent,
    appendStreamingContent,
    finalizeStreamingMessage,
    isEffectivelyOnline,
    setPendingRetry,
  ]);

  /**
   * Réessayer depuis un message assistant (souvent un message d'erreur)
   * - retrouve le dernier message user avant ce message assistant
   * - relance sans re-poster le message user (évite les doublons)
   */
  const handleRegenerateMessage = useCallback(async (assistantMessageId: string) => {
    const conv = useChatStore.getState().getActiveConversation();
    const list = (conv?.messages || []).filter((m) => m.role !== 'tool');
    const idx = list.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) {
      toast.error('Impossible de retrouver le message à réessayer.');
      return;
    }
    const prevUser = [...list.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (!prevUser) {
      toast.error('Impossible de retrouver la question précédente.');
      return;
    }
    // On efface un retry en attente (l'utilisateur reprend la main)
    setPendingRetry(null);
    await handleSendMessage(prevUser.content, false, { skipUserMessage: true, userMessageId: prevUser.id });
  }, [handleSendMessage, setPendingRetry]);

  /**
   * Auto-retry discret: dès que l'on redevient online, relancer une fois.
   */
  const autoRetryInFlightRef = useRef(false);
  useEffect(() => {
    if (!isEffectivelyOnline) return;
    if (!pendingRetry) return;
    if (isLoading) return;
    if (pendingRetry.attempts >= 3) return;
    if (autoRetryInFlightRef.current) return;

    autoRetryInFlightRef.current = true;
    toast.loading("Reconnexion... Reessai en cours", { id: 'net-retry' });
    void (async () => {
      try {
        const ok = await handleSendMessage(pendingRetry.content, pendingRetry.hasImages, {
          skipUserMessage: true,
          userMessageId: pendingRetry.userMessageId,
        });
        if (ok) {
          setPendingRetry(null);
          toast.success('Reconnexion OK', { id: 'net-retry' });
        } else {
          toast.dismiss('net-retry');
        }
      } finally {
        autoRetryInFlightRef.current = false;
      }
    })();
  }, [isEffectivelyOnline, pendingRetry, isLoading, handleSendMessage, setPendingRetry]);

  const handleStopGeneration = useCallback(() => {
    // Stop normal chat streaming
    aiRouter.stopStream();
    // Also abort any running project generation (SSE stream + planning fetch)
    projectGeneration.abort();
    useChatStore.getState().stopGeneration();
    setIsGenerating(false);
  }, [setIsGenerating]);

  const handleQuickStart = useCallback((prompt: string) => {
    handleSendMessage(prompt);
  }, [handleSendMessage]);




  return (
    <div className="h-full min-h-0 flex bg-bg-primary">
      {/* Main chat column */}
      <div className="flex-1 min-h-0 flex flex-col bg-bg-primary">
      {/* Chat area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {!isEffectivelyOnline && (
          <div className="px-4 pt-3">
            <div className="max-w-4xl mx-auto rounded-xl border border-border-subtle bg-surface-default/70 backdrop-blur px-4 py-2 flex items-center gap-2 text-xs text-text-secondary">
              <WifiOff size={14} className="text-text-muted" />
              <span>
                {settings.offlineMode ? 'Mode hors ligne activé.' : 'Hors ligne.'} Certaines fonctionnalités réseau sont désactivées.
              </span>
            </div>
          </div>
        )}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 w-full max-w-6xl mb-10">
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
                      } else if (feature.title === 'Importer un dossier') {
                        void handleImportFolder();
                      } else if (feature.title === 'Générer un projet') {
                        setShowProjectWizard(true);
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
            onRegenerateMessage={handleRegenerateMessage}
          />
        )}
      </div>

      {/* ===== INPUT BAR ===== */}
      <div className="flex-shrink-0">
        <VerifyFixNotice />
        <ChatInput
          onSendMessage={async (msg, attachments) => { await handleSendMessage(msg, false, { attachments }); }}
          onStopGeneration={handleStopGeneration}
          isLoading={isLoading}
          isOnline={isEffectivelyOnline}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          placeholder="Décris ta tâche, ANZAR s'en occupe..."
        />
      </div>

      <BackgroundTasksDock />

      {/* ===== STUDENT ASSISTANT MENU (modal overlay) ===== */}
      {showStudentMenu && (
        <FeatureMenuModal
          title="Assistant Etudiant"
          subtitle="Choisis ce dont tu as besoin"
          icon={GraduationCap}
          iconColor="from-pink-500 to-rose-500"
          options={STUDENT_OPTIONS}
          categories={STUDENT_CATEGORIES}
          onSelect={(opt) => {
            setShowStudentMenu(false);
            // Pour "Corriger / Reformuler": on évite d'envoyer un message séparé
            // puis un second "Analyse les pièces jointes.".
            // On demande au ChatInput d'ouvrir le picker puis d'envoyer UN seul message
            // (prompt + pièces jointes) dès qu'un fichier est ajouté.
            if ((opt as any).opensFileDialog) {
              window.dispatchEvent(new CustomEvent('anzar:compose-with-attachments', {
                detail: { text: opt.prompt, autoSend: true },
              }));
              return;
            }
            handleSendMessage(opt.prompt);
          }}
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
          onSelect={(opt) => {
            setShowDataMenu(false);
            if ((opt as any).opensFileDialog) {
              window.dispatchEvent(new CustomEvent('anzar:compose-with-attachments', {
                detail: { text: opt.prompt, autoSend: true },
              }));
              return;
            }
            handleSendMessage(opt.prompt);
          }}
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

      {/* ===== PROJECT WIZARD (modal overlay) ===== */}
      {showProjectWizard && (
        <ProjectWizardModal
          onClose={() => setShowProjectWizard(false)}
          onGenerate={async (prompt, projectName, projectType, techs) => {
            setShowProjectWizard(false);
            await prepareProjectGeneration();
            forceProjectGenerationOnceRef.current = true;
            wizardMetaRef.current = { projectType, techs };

            // Show a clean user message instead of the full technical prompt
            const displayMessage = `Genere le projet "${projectName}"`;
            ensureActiveConversation();
            const userMsgId = `msg_${Date.now()}`;
            addConversationMessage({
              id: userMsgId,
              content: displayMessage,
              role: 'user',
              timestamp: Date.now(),
              model: selectedModel,
            });

            // Send the full prompt to the pipeline but skip adding another user message
            handleSendMessage(prompt, false, { skipUserMessage: true, userMessageId: userMsgId });
          }}
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
          onSelect={(opt) => {
            setShowDocumentMenu(false);
            if ((opt as any).opensFileDialog) {
              window.dispatchEvent(new CustomEvent('anzar:compose-with-attachments', {
                detail: { text: opt.prompt, autoSend: true },
              }));
              return;
            }
            handleSendMessage(opt.prompt);
          }}
          onClose={() => setShowDocumentMenu(false)}
        />
      )}
    </div>
    {/* ── Generation Panel (right sidebar, TRAE-style) ── */}
    {generationPanelSessionId && (
      <GenerationPanel
        sessionId={generationPanelSessionId}
        onClose={() => setGenerationPanelSessionId(null)}
      />
    )}
    </div>
  );
}

/* ===== Reusable Feature Menu Modal ===== */
interface SubOption {
  id: string;
  label: string;
  description: string;
  emoji: string;
  prompt: string;
}

interface FeatureOption {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  prompt: string;
  opensFileDialog?: boolean;
  tag?: string;
  category?: string;
  subOptions?: SubOption[];
}

function FeatureMenuModal({
  title, subtitle, icon: TitleIcon, iconColor, options, onSelect, onClose,
  categories,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  iconColor: string;
  options: FeatureOption[];
  onSelect: (option: FeatureOption) => void;
  onClose: () => void;
  categories?: { id: string; label: string; emoji: string }[];
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [expandedSub, setExpandedSub] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const idsRef = useRef({
    titleId: `modal_title_${Math.random().toString(16).slice(2)}`,
    descId: `modal_desc_${Math.random().toString(16).slice(2)}`,
  });

  const hasCats = categories && categories.length > 0;
  const filteredOptions = hasCats && activeCategory !== 'all'
    ? options.filter((o) => (o as any).category === activeCategory)
    : options;

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const root = modalRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!active || active === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="bg-bg-primary border border-border-subtle rounded-2xl shadow-2xl w-full max-w-xl mx-4 p-5 animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idsRef.current.titleId}
        aria-describedby={idsRef.current.descId}
      >
        {/* Header — compact */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md', iconColor)}>
              <TitleIcon size={18} className="text-white" />
            </div>
            <div>
              <h2 id={idsRef.current.titleId} className="text-base font-bold text-text-primary">{title}</h2>
              <p id={idsRef.current.descId} className="text-[11px] text-text-muted">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            ref={closeButtonRef}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Category tabs */}
        {hasCats && !expandedSub && (
          <div className="flex gap-1.5 mb-4 flex-shrink-0 overflow-x-auto pb-1 -mx-1 px-1">
            {categories.map((cat) => {
              const count = cat.id === 'all'
                ? options.length
                : options.filter((o) => (o as any).category === cat.id).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150',
                    activeCategory === cat.id
                      ? 'bg-accent-primary text-white shadow-sm'
                      : 'bg-surface-default text-text-muted hover:bg-surface-hover hover:text-text-primary',
                  )}
                >
                  {cat.label}
                  <span className={cn(
                    'ml-1.5 text-[10px]',
                    activeCategory === cat.id ? 'text-white/70' : 'text-text-muted/60',
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 min-h-0 -mx-1 px-1">
          {expandedSub ? (
            (() => {
              const parent = options.find((o) => o.id === expandedSub);
              if (!parent?.subOptions) return null;
              return (
                <div className="space-y-2">
                  <button
                    onClick={() => setExpandedSub(null)}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors mb-2"
                  >
                    <ChevronLeft size={14} />
                    Retour
                  </button>
                  <p className="text-sm font-semibold text-text-primary mb-2">
                    {parent.title} :
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {parent.subOptions.map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => {
                          onSelect({
                            ...parent,
                            id: sub.id,
                            title: sub.label,
                            description: sub.description,
                            prompt: sub.prompt,
                            opensFileDialog: true,
                          });
                        }}
                        className={cn(
                          'group flex items-center gap-2.5 p-3 rounded-xl border border-border-subtle',
                          'bg-surface-default hover:bg-surface-hover',
                          'transition-all duration-150 text-left',
                          'hover:border-emerald-500/40 hover:shadow-sm',
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-text-primary">
                            {sub.label}
                          </p>
                          <p className="text-[11px] text-text-muted leading-snug">
                            {sub.description}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filteredOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      if (option.subOptions && option.subOptions.length > 0) {
                        setExpandedSub(option.id);
                      } else {
                        onSelect(option);
                      }
                    }}
                    className={cn(
                      'group flex items-center gap-2.5 p-3 rounded-xl border border-border-subtle',
                      'bg-surface-default hover:bg-surface-hover',
                      'transition-all duration-150 text-left',
                      'hover:border-accent-primary/30 hover:shadow-sm',
                    )}
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0',
                      'group-hover:scale-105 transition-transform duration-150 shadow-sm',
                      option.color,
                    )}>
                      <Icon size={14} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-semibold text-text-primary truncate">
                          {option.title}
                        </p>
                        {option.tag && (
                          <span className={cn(
                            'text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0',
                            option.tag === 'Nouveau' && 'bg-accent-primary/15 text-accent-primary',
                            option.tag === 'Upload' && 'bg-emerald-500/15 text-emerald-500',
                            option.tag === 'Populaire' && 'bg-amber-500/15 text-amber-500',
                          )}>
                            {option.tag}
                          </span>
                        )}
                        {option.subOptions && (
                          <ChevronRight size={11} className="text-text-muted ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-text-muted leading-snug truncate">
                        {option.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
