/**
 * Construction du prompt système d'une session : prompt agent avec projet,
 * ou prompt « aucun projet » + espace ANZAR. Le début du prompt reste stable
 * pour que le cache fournisseur soit réutilisé ; ce qui change (mémoire, skills,
 * instructions) est renvoyé à part dans `systemRefresh`.
 */
import { UNTRUSTED_PROMPT_RULE } from '../policy/untrusted';
import type { APIMessage } from '@/types';
import {
  buildAgentSystemPrompt, memorySection, runtimeFactsSection,
  CONNECTORS_GUIDE, FORMATTING_GUIDE, VISUALS_GUIDE,
} from './agentPrompts';
import { replyLanguageRule } from '@/services/agent/context/replyLanguage';

export const PLAN_MODE_PROMPT = `

# MODE PLAN (actif)
Tu ne peux RIEN modifier ni exécuter : seuls read_file, list_dir, glob, search_files, get_diagnostics et propose_plan sont disponibles.
Explore ce qu'il faut (sans tout lire), puis appelle propose_plan UNE fois avec le plan complet en Markdown :
un titre court, puis des étapes numérotées et concrètes (fichiers concernés, changements prévus, vérifications), et les risques éventuels.
N'écris pas le plan dans ta réponse texte : il s'affiche dans un onglet dédié où l'utilisateur le valide.`;

export interface SessionPromptInput {
  workspacePath: string | null;
  workspaceName?: string;
  freshHistory: boolean;
  planMode: boolean;
  webEnabled: boolean;
  personal: string;
  skillsSection: string;
  memory?: string;
  codeMap?: string;
  taskHints?: string;
  platform: 'windows' | 'macos' | 'linux' | string;
  /** Contexte de l'espace ANZAR (déjà formaté), ou ''. */
  personalSpaceContext?: string;
  /** Mode de permission courant, pour les faits d'exécution envoyés dans la demande. */
  permissionMode?: 'ask' | 'auto' | 'plan' | 'full';
  /** Un shell confiné est proposé sur cette plateforme. */
  shellAvailable?: boolean;
  /** Le réseau des commandes est ouvert (filtré par le proxy). */
  networkOpen?: boolean;
  /** L'isolation des commandes est active. */
  sandboxed?: boolean;
}

export interface SessionPromptBundle {
  system: APIMessage;
  /** Partie stable du prompt, pour détecter un changement de projet/app. */
  systemHead: string;
  /** Partie qui peut changer sans casser le cache (renvoyée dans la demande). */
  systemRefresh: string;
  /** Contexte spécifique à la tâche, ajouté au message utilisateur. */
  turnContext: string;
}

export function buildSessionSystemPrompt(input: SessionPromptInput): SessionPromptBundle {
  let system: APIMessage;
  let systemHead = '';
  let systemRefresh = '';
  let turnContext = '';

  if (input.workspacePath) {
    const promptCtx = {
      projectName: input.workspaceName || input.workspacePath.split('/').pop() || 'projet',
      projectRoot: input.workspacePath,
      memory: input.memory,
      platform: input.platform,
    };
    system = {
      role: 'system',
      content: buildAgentSystemPrompt(promptCtx) + '\n\n' + UNTRUSTED_PROMPT_RULE + input.skillsSection + input.personal,
    };
    systemHead = buildAgentSystemPrompt({ ...promptCtx, memory: undefined });
    systemRefresh = [
      input.memory ? memorySection(input.memory) : '',
      input.skillsSection.trim(),
      input.personal.trim(),
    ].filter(Boolean).join('\n\n');

    const parts: string[] = [];
    if (input.freshHistory && input.codeMap) parts.push(`## Carte du code (fichiers + symboles clés)\n${input.codeMap}`);
    if (input.taskHints) parts.push(`## Fichiers probablement pertinents pour cette demande\n${input.taskHints}\n(Indices heuristiques : vérifie avec read_file.)`);
    if (input.planMode) parts.push(PLAN_MODE_PROMPT.trim());
    if (parts.length) turnContext = `\n\n---\n# Contexte fourni par ANZAR\n${parts.join('\n\n')}`;
  } else {
    system = {
      role: 'system',
      content:
        'Tu es ANZAR, assistant de développement. Sois clair et direct. ' + replyLanguageRule() + '\n\n' +
        (input.webEnabled
          ? "Tu peux chercher sur le web (web_search) et lire une page (read_url) quand la question porte sur une information récente " +
            "ou une documentation ; cite alors tes sources avec leur URL.\n\n"
          : '') +
        "AUCUN PROJET N'EST OUVERT. Tu n'as des outils sur les fichiers que si ANZAR t'ouvre l'« espace ANZAR » : il te " +
        "l'indique alors dans la demande, et ces outils te sont fournis. Sinon, tu ne peux ni lire un fichier, ni lancer " +
        "une commande, ni modifier quoi que ce soit. Ne prétends JAMAIS avoir agi sans outil, même si l'historique de la " +
        "conversation montre que tu le faisais avant : n'invente aucun résultat de commande, de build ou de test. " +
        "Si la demande exige d'agir sur un projet de code, dis-le en une phrase et demande d'ouvrir le dossier " +
        "(bouton « Ouvrir un dossier » en haut de la conversation). Pour transformer un fichier (PDF, Excel…), " +
        "propose de le joindre : ANZAR ouvre alors l'espace ANZAR.\n\n" +
        "CRÉATION DE VISUELS/VIDÉOS SANS PROJET : les blocs ```widget ne sont qu'un APERÇU rapide. Pour une création, " +
        "ANZAR ouvre AUTOMATIQUEMENT l'espace ANZAR (il te l'indique dans la demande) — utilise-le directement : " +
        "crée les fichiers dedans, vérifie avec capture_page, exporte avec export_animation. Ne produis PAS des widgets " +
        "quand la demande porte sur des pubs, animations ou vidéos à livrer. Si l'espace n'est PAS ouvert et que la " +
        "création l'exige, propose UNE fois à l'utilisateur d'ouvrir un dossier.\n\n" +
        FORMATTING_GUIDE + '\n\n' + VISUALS_GUIDE + '\n\n' + CONNECTORS_GUIDE + '\n\n' + UNTRUSTED_PROMPT_RULE + input.personal,
    };
    systemHead = (system.content as string).slice(0, (system.content as string).length - input.personal.length);
    systemRefresh = input.personal.trim();
  }

  if (input.personalSpaceContext) turnContext += input.personalSpaceContext;
  // Faits d'exécution : dans la demande, pas dans le prompt système (cache du préfixe).
  turnContext += runtimeFactsSection({
    projectRoot: input.workspacePath || '',
    platform: input.platform,
    permissionMode: input.permissionMode,
    shellAvailable: input.shellAvailable,
    networkOpen: input.networkOpen,
    sandboxed: input.sandboxed,
  });
  return { system, systemHead, systemRefresh, turnContext };
}
