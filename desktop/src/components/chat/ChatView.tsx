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
    description: 'Une idée suffit. ANZAR structure, code et livre.',
    icon: Code2,
    color: 'from-violet-500 to-indigo-500',
    prompt: 'Je veux créer un nouveau projet',
  },
  {
    title: 'Assistant Étudiant',
    description: 'Mémoires, rapports de stage, exposés, révisions — ton allié académique.',
    icon: GraduationCap,
    color: 'from-pink-500 to-rose-500',
    prompt: 'Aide-moi avec mon travail académique',
  },
  {
    title: 'Analyser des données',
    description: 'Importe, explore, visualise. Résultats instantanés.',
    icon: BarChart3,
    color: 'from-emerald-500 to-teal-500',
    prompt: 'Je veux analyser des données',
  },
  {
    title: 'Recherche intelligente',
    description: 'Pose ta question, ANZAR cherche sur le web et synthétise.',
    icon: Globe,
    color: 'from-blue-500 to-cyan-500',
    prompt: 'Recherche sur internet',
  },
  {
    title: 'Rédiger un document',
    description: 'Rapports, présentations, emails — prêts en secondes.',
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

  /** Handle student assistant option selection */
  const handleStudentOption = useCallback((option: typeof STUDENT_OPTIONS[number]) => {
    setShowStudentMenu(false);
    // Send the specialized system prompt as context
    handleSendMessage(option.prompt);
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowStudentMenu(false)}
        >
          <div
            className="bg-bg-primary border border-border-subtle rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center shadow-md">
                  <GraduationCap size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-text-primary">Assistant Étudiant</h2>
                  <p className="text-xs text-text-muted">Choisis ce dont tu as besoin</p>
                </div>
              </div>
              <button
                onClick={() => setShowStudentMenu(false)}
                className="p-2 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Options grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {STUDENT_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    onClick={() => handleStudentOption(option)}
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
      )}
    </div>
  );
}
