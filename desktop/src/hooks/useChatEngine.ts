/**
 * useChatEngine — Hook autonome pour toute la logique d'envoi de messages chat.
 *
 * Extrait de ChatView.tsx pour isolation complète.
 * Gère : offline detection, retry, intent detection (projet/audit/visual),
 * routage AI (DeepSeek/Kimi), streaming progressif, usage tracking, error handling.
 */
import { useCallback, useRef, useEffect } from 'react';
import { AIModel, type Message, type ChatAttachment } from '@/types';
import { aiRouter } from '@/services/router';
import { aiService } from '@/services/ai/ai';
import { projectGeneration } from '@/services/projectGeneration';
import { detectVisualIntent, detectAuditIntent } from '@/services/ai/intentDetection';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { useUsageStore } from '@/stores/usageStore';
import { useActivityStore } from '@/stores/activityStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { documentDir } from '@tauri-apps/api/path';
import toast from 'react-hot-toast';

// ── Types ──

interface SendMessageOpts {
  skipUserMessage?: boolean;
  userMessageId?: string;
  attachments?: ChatAttachment[];
}

interface ChatEngineParams {
  selectedModel: AIModel;
  selectedProjectId: string | null;
  isEffectivelyOnline: boolean;
  /** Refs from ChatView for project generation routing */
  forceProjectGenerationOnceRef: React.MutableRefObject<boolean>;
  wizardMetaRef: React.MutableRefObject<{ projectType: string; techs: string[] } | null>;
  /** Studio actions for VibeCoding integration */
  studioActions: {
    startGeneration: (prompt: string, meta?: { projectType?: string; techs?: string[] }) => void;
  };
  /** Callback to trigger the project generation pipeline */
  onProjectGeneration: (content: string, userMessageId: string, sessionId: string) => Promise<void>;
  /** Callback to set the generation panel session */
  setGenerationPanelSessionId: (id: string | null) => void;
  /** For restoring project selection after async */
  setSelectedProjectId: (id: string | null) => void;
}

export function useChatEngine(params: ChatEngineParams) {
  const {
    selectedModel,
    selectedProjectId,
    isEffectivelyOnline,
    forceProjectGenerationOnceRef,
    wizardMetaRef,
    studioActions,
    onProjectGeneration,
    setGenerationPanelSessionId,
    setSelectedProjectId,
  } = params;

  // ── Store selectors ──
  const addConversationMessage = useChatStore((s) => s.addMessage);
  const updateConversationMessage = useChatStore((s) => s.updateMessage);
  const setIsGenerating = useChatStore((s) => s.setIsGenerating);
  const pendingRetry = useChatStore((s) => s.pendingRetry);
  const setPendingRetry = useChatStore((s) => s.setPendingRetry);
  const startStreamingMessage = useChatStore((s) => s.startStreamingMessage);
  const appendStreamingContent = useChatStore((s) => s.appendStreamingContent);
  const finalizeStreamingMessage = useChatStore((s) => s.finalizeStreamingMessage);
  const updateStreamingContent = useChatStore((s) => s.updateStreamingContent);
  const isLoading = useChatStore((s) => s.isGenerating);

  const projects = useProjectStore((s) => s.projects);
  const updateProject = useProjectStore((s) => s.updateProject);
  const settings = useSettingsStore((s) => s.settings);

  const addUsageRecord = useUsageStore((s) => s.addRecord);

  const startSession = useActivityStore((s) => s.startSession);
  const endSession = useActivityStore((s) => s.endSession);
  const addStep = useActivityStore((s) => s.addStep);
  const completeStep = useActivityStore((s) => s.completeStep);
  const setTodos = useActivityStore((s) => s.setTodos);
  const updateTodo = useActivityStore((s) => s.updateTodo);
  const addContextFile = useActivityStore((s) => s.addContextFile);
  const setContextPercent = useActivityStore((s) => s.setContextPercent);
  const incrementStat = useActivityStore((s) => s.incrementStat);

  // ── Ensure active conversation helper (shared via store) ──
  const ensureActiveConversation = useCallback(() => {
    useChatStore.getState().ensureActiveConversation(selectedModel);
  }, [selectedModel]);

  // ── Main send handler ──
  const handleSendMessage = useCallback(async (
    content: string,
    hasImages = false,
    opts?: SendMessageOpts,
  ): Promise<boolean> => {
    if (!content.trim()) return false;

    ensureActiveConversation();
    setIsGenerating(true);

    const userMessageId = opts?.userMessageId || `msg_${Date.now()}`;

    // ── Offline handling ──
    if (!isEffectivelyOnline) {
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

    // ── User message ──
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
    // PROJECT GENERATION: uniquement via le wizard (forceProject)
    // Le backend orchestrator gère la classification automatique.
    // ══════════════════════════════════════════════════════════════
    const forceProject = forceProjectGenerationOnceRef.current;
    if (forceProject) forceProjectGenerationOnceRef.current = false;

    if (forceProject) {
      const detectStepId = addStep(sessionId, {
        type: 'understanding',
        label: 'Preparation du projet',
      });
      completeStep(sessionId, detectStepId);

      const wizardMeta = wizardMetaRef.current;
      wizardMetaRef.current = null;
      studioActions.startGeneration(content, {
        projectType: wizardMeta?.projectType,
        techs: wizardMeta?.techs,
      });

      await onProjectGeneration(content, userMessageId, sessionId);
      return true;
    }

    // ══════════════════════════════════════════════════════════════
    // INTENT DETECTION: demande d'audit → CodeReviewAgent backend
    // ══════════════════════════════════════════════════════════════
    if (selectedProjectId && detectAuditIntent(content)) {
      const project = useProjectStore.getState().projects.find((p) => p.id === selectedProjectId);
      if (project) {
        const localPath = project.localPath || (project.metadata as any)?.localPath;
        if (localPath) {
          try {
            setGenerationPanelSessionId(sessionId);

            setTodos(sessionId, [
              { label: 'Lecture des fichiers du projet', status: 'active' },
              { label: 'Analyse du stack & architecture', status: 'pending' },
              { label: 'Identification des points forts', status: 'pending' },
              { label: 'Détection des problèmes critiques', status: 'pending' },
              { label: 'Analyse de sécurité & performance', status: 'pending' },
              { label: 'Audit des dépendances & dette technique', status: 'pending' },
              { label: 'Rédaction du rapport final', status: 'pending' },
            ]);
            setContextPercent(sessionId, 5);

            addStep(sessionId, { type: 'reading', label: `Lecture des fichiers de "${project.name}"` });

            const diskFiles = await fileSystemService.readProjectFiles(localPath);
            const filesMap: Record<string, string> = {};
            for (const f of diskFiles) {
              if (f.content) {
                filesMap[f.path] = f.content;
                addContextFile(sessionId, { path: f.path, type: 'file', status: 'reading' });
              }
            }

            if (Object.keys(filesMap).length > 0) {
              setContextPercent(sessionId, 15);
              setTodos(sessionId, [
                { label: 'Lecture des fichiers du projet', status: 'done' },
                { label: 'Analyse du stack & architecture', status: 'active' },
                { label: 'Identification des points forts', status: 'pending' },
                { label: 'Détection des problèmes critiques', status: 'pending' },
                { label: 'Analyse de sécurité & performance', status: 'pending' },
                { label: 'Audit des dépendances & dette technique', status: 'pending' },
                { label: 'Rédaction du rapport final', status: 'pending' },
              ]);
              addStep(sessionId, { type: 'analyzing', label: `${Object.keys(filesMap).length} fichiers chargés — lancement de l'audit` });

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
              startStreamingMessage(aiMessageId);
              updateStreamingContent('Audit en cours...');

              let progressInterval: ReturnType<typeof setInterval> | null = null;
              try {
                addStep(sessionId, { type: 'analyzing', label: 'Analyse de l\'architecture et du code' });
                setContextPercent(sessionId, 25);

                let progressPct = 20;
                const todoLabels = [
                  'Lecture des fichiers du projet',
                  'Analyse du stack & architecture',
                  'Identification des points forts',
                  'Détection des problèmes critiques',
                  'Analyse de sécurité & performance',
                  'Audit des dépendances & dette technique',
                  'Rédaction du rapport final',
                ];
                const todoPhases = [
                  { at: 28, idx: 1, label: 'Analyse du stack & architecture' },
                  { at: 38, idx: 2, label: 'Identification des points forts' },
                  { at: 50, idx: 3, label: 'Détection des problèmes critiques' },
                  { at: 62, idx: 4, label: 'Analyse de sécurité & performance' },
                  { at: 74, idx: 5, label: 'Audit des dépendances & dette technique' },
                  { at: 85, idx: 6, label: 'Rédaction du rapport final' },
                ];
                let phaseIdx = 0;
                progressInterval = setInterval(() => {
                  progressPct = Math.min(progressPct + 1.5, 88);
                  setContextPercent(sessionId, progressPct);
                  while (phaseIdx < todoPhases.length && progressPct >= todoPhases[phaseIdx].at) {
                    const phase = todoPhases[phaseIdx];
                    const todos: Array<{ label: string; status: 'pending' | 'active' | 'done' | 'error' }> =
                      todoLabels.map((label, i) => ({ label, status: 'pending' as const }));
                    todos[0].status = 'done';
                    for (let i = 1; i <= phase.idx; i++) todos[i].status = i < phase.idx ? 'done' : 'active';
                    setTodos(sessionId, todos);
                    addStep(sessionId, { type: 'analyzing', label: phase.label });
                    phaseIdx++;
                  }
                }, 2500);

                const backendId = (project.metadata as any)?.backendProjectId || project.id;
                const savedProjectId = selectedProjectId;
                const report = await projectGeneration.review(
                  backendId,
                  project.name,
                  filesMap,
                  (event) => {
                    if (event.type === 'step') {
                      addStep(sessionId, { type: event.action === 'complete' ? 'complete' : 'analyzing', label: event.label || '' });
                    }
                  },
                  undefined,
                );

                clearInterval(progressInterval);

                setTodos(sessionId, todoLabels.map((label, i) => ({
                  label,
                  status: (i < todoLabels.length - 1 ? 'done' : 'active') as 'done' | 'active',
                })));
                setContextPercent(sessionId, 92);
                addStep(sessionId, { type: 'writing', label: 'Finalisation du rapport d\'audit' });

                updateStreamingContent(report || 'Aucun rapport généré.');
                finalizeStreamingMessage();
                updateConversationMessage(aiMessageId, {
                  content: report || 'Aucun rapport généré.',
                  activitySessionId: sessionId,
                });

                setTodos(sessionId, todoLabels.map((label) => ({
                  label,
                  status: 'done' as const,
                })));
                setContextPercent(sessionId, 100);
                addStep(sessionId, { type: 'complete', label: 'Audit terminé' });
                endSession(sessionId, 'done');

                if (!selectedProjectId && savedProjectId) {
                  setSelectedProjectId(savedProjectId);
                }

                return true;
              } catch (auditErr: any) {
                if (progressInterval) clearInterval(progressInterval);
                const errMsg = `Erreur lors de l'audit: ${auditErr.message || auditErr}`;
                finalizeStreamingMessage();
                updateConversationMessage(aiMessageId, {
                  content: errMsg,
                  isError: true,
                  activitySessionId: sessionId,
                });
                addStep(sessionId, { type: 'error', label: errMsg.slice(0, 100) });
                endSession(sessionId, 'error');
                return true;
              }
            }
          } catch (e) {
            console.warn('[ANZAR] Audit intent detected but failed to read files:', e);
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // INTENT DETECTION: demande visuelle → routage vers Kimi
    // ══════════════════════════════════════════════════════════════
    const isVisualRequest = detectVisualIntent(content);

    // ══════════════════════════════════════════════════════════════
    // DEFAULT: Chat normal avec tool calling
    // ══════════════════════════════════════════════════════════════

    const understandStepId = addStep(sessionId, {
      type: 'understanding',
      label: isVisualRequest
        ? 'Détection de demande visuelle'
        : selectedProjectId
          ? 'Lecture du projet et compréhension de la demande'
          : 'Compréhension de la demande',
    });

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

    // ── Injection du contexte projet dans le chat normal ──
    let projectContextPrompt = '';
    let projectFilesCount = 0;
    if (selectedProjectId) {
      const project = useProjectStore.getState().projects.find((p) => p.id === selectedProjectId);
      if (project) {
        const readProjectStepId = addStep(sessionId, {
          type: 'analyzing',
          label: `Lecture du projet "${project.name}"`,
        });
        const MAX_PROJECT_CONTEXT_CHARS = 100_000;
        let usedChars = 0;
        const fileContents: string[] = [];
        let localPath = (project.metadata as any)?.localPath as string | undefined;

        if (!localPath) {
          try {
            const docsDir = await documentDir();
            const candidatePath = `${docsDir}ANZAR/Projects/${project.name}`;
            const pathExists = await fileSystemService.exists(candidatePath);
            if (pathExists) {
              localPath = candidatePath;
              updateProject(project.id, { metadata: { ...project.metadata, localPath } });
              console.log('[ANZAR] Auto-detected localPath:', localPath);
            }
          } catch {
            // documentDir not available (web mode)
          }
        }

        const TEXT_EXTS = /\.(html?|css|jsx?|tsx?|json|md|txt|py|yml|yaml|toml|xml|svg|sh|env|gitignore|rs|go|java|php|rb|c|cpp|h|sql|lock)$/i;

        if (localPath) {
          try {
            console.log('[ANZAR] Reading FRESH project files from disk:', localPath);
            const diskFiles = await fileSystemService.readProjectFiles(localPath);
            console.log('[ANZAR] Fresh disk files found:', diskFiles.length);
            const textFiles = diskFiles
              .filter((f) => TEXT_EXTS.test(f.path) && f.content && f.content.trim().length > 0)
              .sort((a, b) => (a.content?.length || 0) - (b.content?.length || 0));
            for (const file of textFiles) {
              const entry = `\n--- ${file.path} ---\n${file.content}`;
              if (usedChars + entry.length > MAX_PROJECT_CONTEXT_CHARS) break;
              fileContents.push(entry);
              usedChars += entry.length;
            }
          } catch (e) {
            console.warn('[ANZAR] Failed to read project files from disk:', e);
          }
        }

        // Fallback: fichiers du store
        if (fileContents.length === 0) {
          const storeFiles = (project.files || []).filter((f) => f.content && f.content.trim().length > 0);
          if (storeFiles.length > 0) {
            const sortedFiles = [...storeFiles].sort((a, b) => (a.content?.length || 0) - (b.content?.length || 0));
            for (const file of sortedFiles) {
              const entry = `\n--- ${file.path} ---\n${file.content}`;
              if (usedChars + entry.length > MAX_PROJECT_CONTEXT_CHARS) break;
              fileContents.push(entry);
              usedChars += entry.length;
            }
          }
        }

        if (fileContents.length > 0) {
          projectFilesCount = fileContents.length;
          projectContextPrompt = `\n\n⚠️ IMPORTANT: Tu as DÉJÀ accès à TOUS les fichiers du projet. Ils sont inclus ci-dessous dans ce message. NE DIS JAMAIS que tu n'as pas accès aux fichiers ou que tu ne peux pas les lire. Tu les as DÉJÀ.

═══ PROJET OUVERT: ${project.name} (${projectFilesCount} fichiers chargés) ═══

RÈGLES ABSOLUES:
1. Tu as accès aux ${projectFilesCount} fichiers du projet ci-dessous. LIS-LES TOUS attentivement.
2. NE DEMANDE JAMAIS à l'utilisateur de coller du code — tu as déjà tous les fichiers.
3. NE DIS JAMAIS que tu n'as pas accès aux fichiers — ils sont TOUS ci-dessous.
4. Quand tu proposes des modifications, montre le code complet du fichier modifié avec le chemin.

SI L'UTILISATEUR DEMANDE UN AUDIT / REVUE / ANALYSE DU PROJET:
- Identifie le STACK EXACT (langages, frameworks, versions depuis package.json/requirements.txt/etc.)
- Analyse l'ARCHITECTURE (patterns, structure dossiers, flux de données)
- Cite TOUJOURS les fichiers et numéros de lignes quand tu signales un problème
- Sois PRÉCIS et CONCRET — pas de conseils génériques
- Structure ton rapport: Résumé → Architecture → Points forts → Bugs → Qualité → Sécurité → Performance → Recommandations
- Donne un score global /10

SI L'UTILISATEUR SIGNALE UNE ERREUR / UN BUG / "ÇA MARCHE PAS" / "L'APP REFUSE DE SE LANCER":
Tu es un expert en debugging. Tu as TOUS les fichiers du projet. Voici ta méthode:

1. DEMANDE LE MESSAGE D'ERREUR EXACT: dis "Colle-moi le message d'erreur du terminal (le texte en rouge ou après 'Error:')."
2. EN ATTENDANT, ANALYSE TOI-MÊME le code pour trouver les causes probables:
   a) Vérifie package.json / requirements.txt : dépendances manquantes, versions incompatibles
   b) Vérifie les imports : fichiers qui importent des modules inexistants ou mal nommés
   c) Vérifie les variables d'environnement : .env manquant, clés API non définies
   d) Vérifie la config : vite.config, tsconfig.json, tailwind.config — erreurs de chemins
   e) Vérifie les types : erreurs TypeScript évidentes, props manquantes
   f) Vérifie les ports : conflit de port (3000, 5173, 8080 déjà utilisé)
   g) Vérifie la base de données : URL de connexion, migrations non exécutées
3. DONNE DES COMMANDES EXACTES pour corriger, avec le chemin complet du projet. Par exemple:
   - "Tape dans ton terminal: cd /chemin/du/projet && npm install nom-du-package"
   - "Remplace le contenu de fichier X par: [code complet]"
4. Si tu identifies le bug dans le code, montre le FICHIER CORRIGÉ EN ENTIER (pas juste la ligne).

ERREURS COURANTES À VÉRIFIER EN PRIORITÉ:
- "Module not found" → import incorrect ou dépendance non installée → npm install <package>
- "EADDRINUSE" → port déjà utilisé → changer le port ou tuer le processus
- "Cannot find module" → chemin d'import relatif incorrect (./composants vs ./components)
- "SyntaxError" → erreur de syntaxe dans le code → montrer la correction
- "TypeError: X is not a function" → mauvais export/import (default vs named)
- "ENOENT" → fichier ou dossier manquant → créer le fichier manquant
- "ERR_MODULE_NOT_FOUND" → package.json type:"module" vs require()
- Écran blanc React → erreur dans un composant (vérifie les imports et le JSX)
- "digital envelope routines" → version Node trop récente → export NODE_OPTIONS=--openssl-legacy-provider
- CORS error → backend n'autorise pas le frontend → ajouter CORS middleware

${fileContents.join('\n')}

═══ FIN DES FICHIERS DU PROJET (${projectFilesCount} fichiers) ═══`;
          completeStep(sessionId, readProjectStepId);
          addStep(sessionId, {
            type: 'complete',
            label: `${projectFilesCount} fichiers chargés — analyse de l'architecture`,
          });
        } else if (localPath) {
          projectContextPrompt = `\n\nProjet sélectionné: "${project.name}" (dossier: ${localPath}). Les fichiers n'ont pas pu être lus. Demande à l'utilisateur de vérifier que le dossier existe.`;
          completeStep(sessionId, readProjectStepId);
        } else {
          completeStep(sessionId, readProjectStepId);
        }
      }
    }

    const rawMessages = [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      ...history.map((m) => ({ role: m.role as any, content: m.content })),
    ];
    const apiMessages = aiRouter.prepareMessages(rawMessages);

    if (projectContextPrompt && apiMessages.length > 0 && apiMessages[0].role === 'system') {
      apiMessages[0] = {
        ...apiMessages[0],
        content: apiMessages[0].content + projectContextPrompt,
      };
      console.log('[ANZAR] Project context injected — system prompt length:', String(apiMessages[0].content || '').length, 'chars');
    }

    completeStep(sessionId, understandStepId);

    // Create placeholder AI message for streaming
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
    startStreamingMessage(aiMessageId);
    updateStreamingContent('');

    let routingProvider = isVisualRequest ? 'kimi' : 'deepseek';
    let routingTaskType = isVisualRequest ? 'visual' : 'chat';
    let routingReason = isVisualRequest ? 'visual-intent-detected' : '';
    let routingWasFallback = false;

    try {
      let fullContent = '';
      let reasoningContent = '';

      const routingStepId = addStep(sessionId, {
        type: 'analyzing',
        label: isVisualRequest ? 'Routage vers Kimi (visuel)' : 'Classification de la tache',
      });

      completeStep(sessionId, routingStepId);
      const processingLabel = isVisualRequest
        ? 'Génération du contenu visuel'
        : selectedProjectId && projectFilesCount > 0
          ? 'Analyse du code et rédaction de la réponse'
          : selectedProjectId
            ? 'Analyse du projet et rédaction'
            : 'Réflexion et rédaction';
      addStep(sessionId, { type: 'planning', label: processingLabel });

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
      }

      // Guard: empty response
      if (!fullContent.trim()) {
        fullContent = "Désolé, je n'ai pas pu générer de réponse. Le serveur a renvoyé une réponse vide. Réessaie ou reformule ta demande.";
        addStep(sessionId, { type: 'error', label: 'Réponse vide du serveur' });
        endSession(sessionId, 'error');
      } else {
        addStep(sessionId, { type: 'complete', label: `Terminé (${((Date.now() - startTime) / 1000).toFixed(1)}s)` });
        endSession(sessionId, 'done');
      }

      // Stream the final content progressively
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      if (fullContent.length <= 420) {
        updateStreamingContent(fullContent);
      } else {
        const chunkSize = 80;
        for (let i = 0; i < fullContent.length; i += chunkSize) {
          if (!useChatStore.getState().isGenerating) break;
          appendStreamingContent(fullContent.slice(i, i + chunkSize));
          if (i % (chunkSize * 6) === 0) await sleep(0);
        }
      }

      finalizeStreamingMessage();
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

      if (useChatStore.getState().pendingRetry?.userMessageId === userMessageId) {
        setPendingRetry(null);
      }
      return true;

    } catch (error: any) {
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

      useChatStore.getState().stopGeneration();
      updateConversationMessage(aiMessageId, {
        content: errorContent,
        isStreaming: false,
        isError: true,
        activitySessionId: sessionId,
      });

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
    onProjectGeneration,
    ensureActiveConversation,
    addConversationMessage,
    updateConversationMessage,
    selectedProjectId,
    settings,
    setIsGenerating,
    startStreamingMessage,
    updateStreamingContent,
    appendStreamingContent,
    finalizeStreamingMessage,
    isEffectivelyOnline,
    setPendingRetry,
    setGenerationPanelSessionId,
    setSelectedProjectId,
    studioActions,
    forceProjectGenerationOnceRef,
    wizardMetaRef,
    setTodos,
    updateTodo,
    addContextFile,
    setContextPercent,
    incrementStat,
    updateProject,
  ]);

  // ── Regenerate (retry from assistant message) ──
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
    setPendingRetry(null);
    await handleSendMessage(prevUser.content, false, { skipUserMessage: true, userMessageId: prevUser.id });
  }, [handleSendMessage, setPendingRetry]);

  // ── Auto-retry on reconnection ──
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

  // ── Stop generation ──
  const handleStopGeneration = useCallback(() => {
    aiRouter.stopStream();
    projectGeneration.abort();
    useChatStore.getState().stopGeneration();
    setIsGenerating(false);
    useChatStore.getState().setIsProjectGenerating(false);
  }, [setIsGenerating]);

  // ── Quick start (always triggers project generation) ──
  const handleQuickStart = useCallback((prompt: string) => {
    forceProjectGenerationOnceRef.current = true;
    handleSendMessage(prompt);
  }, [handleSendMessage, forceProjectGenerationOnceRef]);

  return {
    sendMessage: handleSendMessage,
    regenerateMessage: handleRegenerateMessage,
    stopGeneration: handleStopGeneration,
    quickStart: handleQuickStart,
    ensureActiveConversation,
  };
}
