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
} from 'lucide-react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { cn } from '@/lib/utils';
import { AIModel, type Message, type ChatAttachment } from '@/types';
import { aiRouter } from '@/services/router';
import { aiService } from '@/services/ai';
import { projectGeneration, type PlanResult, type ExecutionEvent } from '@/services/projectGeneration';
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
import { runService } from '@/services/runService';
import { isAllowedProjectRoot, showPathNotAllowedMessage } from '@/lib/allowedProjectRoots';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

interface ChatViewProps {
  onlineStatus?: boolean;
  showWelcome?: boolean;
}

/* ===== Feature Cards ===== */
const FEATURES = [
  {
    title: 'Générer un projet',
    description: 'À partir d’une idée : ANZAR planifie, code et crée les fichiers (dossier auto par défaut).',
    icon: Code2,
    color: 'from-violet-500 to-indigo-500',
    prompt: 'Je veux créer un nouveau projet',
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

/* ===== Assistant Étudiant — Menu interactif ===== */
const STUDENT_OPTIONS = [
  {
    id: 'memoire',
    title: 'Rédiger un mémoire',
    description: 'Mémoire de fin d\'études : plan, introduction, développement, conclusion, bibliographie.',
    icon: BookOpen,
    color: 'from-pink-500 to-rose-500',
    prompt: `Je veux rédiger un mémoire de fin d’études. Pose-moi d’abord les questions essentielles (sujet, niveau, contraintes, nombre de pages, plan existant), puis propose une structure/plan détaillé et les prochaines étapes.`,
  },
  {
    id: 'rapport',
    title: 'Rapport de stage',
    description: 'Structure, rédaction et mise en forme de ton rapport de stage professionnel.',
    icon: PenTool,
    color: 'from-violet-500 to-purple-500',
    prompt: `Je veux rédiger mon rapport de stage. Commence par me poser les questions clés (entreprise, missions, durée, niveau, consignes, brouillon), puis propose un plan complet (page de garde → conclusion) et un exemple de contenu pour chaque section.`,
  },
  {
    id: 'correction',
    title: 'Corriger / Reformuler',
    description: 'Upload ton document (PDF, Word) ou colle ton texte. Correction complète sur mesure.',
    icon: ListChecks,
    color: 'from-emerald-500 to-green-500',
    prompt: `Je veux faire corriger/reformuler un document (mémoire/rapport/etc.).

Commence par m’expliquer comment te l’envoyer (PDF/Word ou texte collé), puis pose 2–3 questions (type de document, niveau, consignes).

Ensuite propose les options sous forme de liste numérotée claire :
1) Correction complète
2) Reformulation
3) Mise en forme académique
4) Amélioration du contenu
5) Adaptation du ton
6) Tout corriger

IMPORTANT : évite les tableaux ASCII, les barres verticales “|”, et les séparateurs à base de tirets. Utilise seulement des titres et des listes.`,
    opensFileDialog: true,
  },
  {
    id: 'plan',
    title: 'Plan détaillé',
    description: 'Génère un plan structuré pour n\'importe quel travail académique.',
    icon: Layout,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Aide-moi à faire un plan détaillé. Demande-moi le sujet/problématique, le type de travail (mémoire/rapport/dissertation/exposé/thèse), le nombre de parties/chapitres et les consignes, puis propose un plan structuré avec sous-parties et objectifs.`,
  },
  {
    id: 'resume',
    title: 'Résumé de cours',
    description: 'Synthétise un cours, un chapitre ou un document en points clés.',
    icon: BookMarked,
    color: 'from-amber-500 to-yellow-500',
    prompt: `Je veux résumer un cours/document. Demande-moi le contenu (ou le sujet) et le niveau de détail (résumé court / fiche de révision / mind map), puis fais une synthèse claire avec points clés et définitions importantes.`,
  },
  {
    id: 'expose',
    title: 'Préparer un exposé',
    description: 'Plan, contenu, notes de présentation et support pour ton exposé oral.',
    icon: Presentation,
    color: 'from-teal-500 to-cyan-500',
    prompt: `Aide-moi à préparer un exposé. Demande-moi le sujet, la durée, le public, le type de support attendu (PowerPoint/poster), puis propose un plan, le contenu par partie, et des notes pour l’oral.`,
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
    prompt: `Je veux analyser un fichier de données (CSV/Excel). À partir du fichier, commence par me donner un aperçu (colonnes, types, 5 premières lignes), puis propose : résumé statistique, tendances/corrélations, nettoyage, tableaux croisés et recommandations.`,
    opensFileDialog: true,
  },
  {
    id: 'visualize',
    title: 'Créer des graphiques',
    description: 'Génère des visualisations claires à partir de tes données.',
    icon: TrendingUp,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Je veux créer des graphiques à partir de mes données. Demande-moi le type de graphique (courbe/barres/camembert/scatter/histogramme) et ce que je veux montrer, puis propose 2–3 graphiques pertinents + explication (et si possible le code Python).`,
    opensFileDialog: true,
  },
  {
    id: 'survey',
    title: 'Analyser un sondage/enquête',
    description: 'Traite les résultats d\'un sondage, questionnaire ou formulaire.',
    icon: PieChart,
    color: 'from-violet-500 to-purple-500',
    prompt: `Je veux analyser les résultats d’un sondage. À partir du fichier, résume d’abord (nb répondants si présent, questions, types de réponses), puis donne : pourcentages, tendances, points surprenants et recommandations.`,
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

/* ===== Recherche intelligente — Menu interactif ===== */
const SEARCH_OPTIONS = [
  {
    id: 'research',
    title: 'Recherche approfondie',
    description: 'Recherche complète sur un sujet avec sources, synthèse et analyse.',
    icon: Search,
    color: 'from-blue-500 to-cyan-500',
    prompt: `Fais une recherche approfondie sur mon sujet avec des sources. Commence par me demander le sujet, le niveau de profondeur et l’angle, puis donne une synthèse structurée + sources + conclusion.`,
  },
  {
    id: 'news',
    title: 'Actualités et tendances',
    description: 'Les dernières nouvelles et tendances sur un sujet précis.',
    icon: Newspaper,
    color: 'from-red-500 to-pink-500',
    prompt: `Donne-moi les dernières actualités sur mon sujet (période + domaine). Résume les 5–10 infos clés, avec sources, tendances et points à retenir.`,
  },
  {
    id: 'factcheck',
    title: 'Vérifier une information',
    description: 'Vérifie si une affirmation, une rumeur ou un chiffre est vrai.',
    icon: HelpCircle,
    color: 'from-amber-500 to-yellow-500',
    prompt: `Je veux vérifier une information. Demande-moi l’affirmation exacte et la source, puis donne un verdict (vrai/faux/partiel/non vérifiable) avec preuves et sources.`,
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

/* ===== Rédiger un document — Menu interactif ===== */
const DOCUMENT_OPTIONS = [
  {
    id: 'email_pro',
    title: 'Email professionnel',
    description: 'Rédige un email clair, professionnel et adapté au contexte.',
    icon: Mail,
    color: 'from-blue-500 to-indigo-500',
    prompt: `Aide-moi à rédiger un email professionnel. Demande-moi le destinataire, l’objectif, le ton et les points à inclure, puis propose un email complet (objet + corps + formule de politesse).`,
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
    prompt: `Aide-moi à créer/améliorer mon CV et/ou ma lettre de motivation. Demande-moi le poste visé, mon expérience, mes formations/compétences et (si j’ai déjà un CV) analyse-le puis propose une version améliorée.`,
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
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState<AIModel>('fast');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showStudentMenu, setShowStudentMenu] = useState(false);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const [showSearchMenu, setShowSearchMenu] = useState(false);
  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const forceProjectGenerationOnceRef = useRef(false);
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

      // Proposer (sans insister) le dossier par défaut. Si non, laisser l’utilisateur choisir.
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
        // ignore — fallback default
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

  // Network listeners (grand public) — n'affiche pas d'alert, juste un état
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
      const content = '❌ Impossible d’ouvrir le sélecteur de dossier. (Fonction disponible sur l’app desktop Tauri.)';
      addConversationMessage({
        id: msgId,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        model: selectedModel,
        isError: true,
      });
      toast.error('Impossible d’importer le dossier');
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
      content:
        `🚀 **Génération de projet lancée : ${projectName}**\n\n` +
        (localPath ? `📁 Dossier: \`${localPath}\`\n\n` : '') +
        `Le pipeline multi-agents démarre...`,
      timestamp: Date.now(),
      model: selectedModel,
      isStreaming: true,
      activitySessionId: sessionId,
    });

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
              const nextContent = `🚀 **${projectName}**\n\n⏳ ${message}`;
              updateConversationMessage(aiMessageId, { content: nextContent });
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
            const nextContent =
              `🚀 **${p.title || projectName}**\n\n✅ **Plan prêt** — ${p.files.length} fichiers prévus :\n${fileList}${moreFiles}\n\n⏳ **Coder** génère le code...`;
            updateConversationMessage(aiMessageId, { content: nextContent });

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

            const nextContent =
              `🚀 **${lastPlan?.title || projectName}**\n\n${agentLines}\n\n_${doneAgents.length}/${event.agents.length} agents terminés_`;
            updateConversationMessage(aiMessageId, { content: nextContent });
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
      const nextContent =
        `🎉 **${plan.title || projectName}** — Projet généré avec succès !\n\n` +
        `📁 **${plan.files.length} fichiers** créés en **${elapsed}s**\n` +
        `🏗️ Complexité: ${plan.complexity || 'medium'}\n\n` +
        `**Fichiers générés :**\n${fileList}${moreFiles}\n\n` +
        (localPath ? `📂 Sauvegardé dans: \`${localPath}\`\n\n` : '') +
        `👉 Ouvre le projet dans la barre latérale pour voir les fichiers et le code.`;
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
      const errorMsg = error?.message || 'Erreur lors de la génération';
      addStep(sessionId, { type: 'error', label: errorMsg.slice(0, 80) });
      endSession(sessionId, 'error');
      setProjectStatus(projectId, 'error', errorMsg);

      const nextContent =
        error?.name === 'AbortError'
          ? '⏹ Génération arrêtée.'
          : `❌ **Erreur de génération**\n\n${errorMsg}\n\n_Vérifie ta connexion au backend et tes crédits._`;
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
        toast.error('Hors ligne — impossible d’envoyer pour le moment.');
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
        content: 'Hors ligne — connecte-toi à internet pour continuer. Tu peux préparer ton message et réessayer.',
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
        label: forceProject
          ? 'Génération de projet (action utilisateur)'
          : 'Intention détectée: génération de projet',
      });
      completeStep(sessionId, detectStepId);

      // Route vers le pipeline multi-agents
      await handleProjectGeneration(content, userMessageId, sessionId);
      return true;
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
    const history = useChatStore
      .getState()
      .getMessagesForAPI()
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system');

      const rawMessages = [
      {
        role: 'system' as const,
        content:
          "Tu es ANZAR, un assistant IA intelligent. Tu peux chercher des informations sur le web. Si tu proposes des commandes, mets-les dans un bloc ```bash```.",
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
    let routingProvider = 'deepseek';
    let routingTaskType = 'chat';
    let routingReason = '';
    let routingWasFallback = false;

    try {
      let fullContent = '';

      // Step 2: Routing / Classification
      const routingStepId = addStep(sessionId, {
        type: 'analyzing',
        label: 'Classification de la tache',
      });

      // Smart chat: backend handles web search (Serper) + tool calling
      completeStep(sessionId, routingStepId);
      addStep(sessionId, { type: 'planning', label: 'Recherche et redaction' });

      const modelId = aiService.resolveModel('deepseek', selectedModel);

      const resp = await aiService.smartChat(apiMessages as any, {
        model: modelId,
        temperature: 0.7,
      });

      fullContent = resp?.choices?.[0]?.message?.content || '';
      const reasoningContent = resp?.choices?.[0]?.message?.reasoning_content || '';

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
          taskType: 'smart_chat',
          wasFallback: routingWasFallback,
          reason: 'smart-chat-with-search',
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
        taskType: 'smart_chat',
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

      const errorContent = error.name === 'AbortError'
        ? '⏹ Génération arrêtée.'
        : `❌ Erreur: ${error.message || 'Connexion échouée. Vérifie ta connexion et la configuration API.'}`;

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
        if (prevAttempts < 2) {
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
          toast('Connexion instable — réessai automatique dès que possible.', { id: 'net-auto' });
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
    if (pendingRetry.attempts >= 2) return;
    if (autoRetryInFlightRef.current) return;

    autoRetryInFlightRef.current = true;
    toast.loading('Reconnexion… Réessai en cours', { id: 'net-retry' });
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
    <div className="h-full min-h-0 flex flex-col bg-bg-primary">
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
                        // UX grand public: action déterministe (pas d'heuristique)
                        void (async () => {
                          await prepareProjectGeneration();
                          forceProjectGenerationOnceRef.current = true;
                          handleQuickStart(feature.prompt || 'Je veux créer un projet');
                        })();
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
          title="Assistant Étudiant"
          subtitle="Choisis ce dont tu as besoin"
          icon={GraduationCap}
          iconColor="from-pink-500 to-rose-500"
          options={STUDENT_OPTIONS}
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
  options: { id: string; title: string; description: string; icon: React.ElementType; color: string; prompt: string; opensFileDialog?: boolean }[];
  onSelect: (option: typeof options[number]) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const idsRef = useRef({
    titleId: `modal_title_${Math.random().toString(16).slice(2)}`,
    descId: `modal_desc_${Math.random().toString(16).slice(2)}`,
  });

  // UX grand public: Escape ferme le modal + focus initial sur "fermer" + focus trap Tab
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
        className="bg-bg-primary border border-border-subtle rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idsRef.current.titleId}
        aria-describedby={idsRef.current.descId}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md', iconColor)}>
              <TitleIcon size={20} className="text-white" />
            </div>
            <div>
              <h2 id={idsRef.current.titleId} className="text-lg font-bold text-text-primary">{title}</h2>
              <p id={idsRef.current.descId} className="text-xs text-text-muted">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            ref={closeButtonRef}
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
