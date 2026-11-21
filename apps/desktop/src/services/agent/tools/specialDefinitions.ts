/**
 * Définitions des outils propres au chat, qui ne sont pas exécutés par le registre
 * local : ask_user, load_skill et propose_plan (mode plan).
 *
 * Elles vivent à part pour que l'hôte d'outils d'un tour puisse composer la liste
 * envoyée au modèle sans importer l'adaptateur de conversation.
 */
import type { ToolDefinition } from '@/types';

/** Question à choix posée à l'utilisateur (panneau au-dessus de la saisie). */
export const ASK_USER_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ask_user',
    description:
      "Pose 1 à 4 questions à choix à l'utilisateur et attend ses réponses. À utiliser quand une décision lui revient et change ce que tu vas faire " +
      "(approche, technologie, périmètre, choix de design), avant de te lancer dans un travail coûteux à refaire. " +
      "Pour chaque question : 2 à 4 options concrètes et courtes, recommended = l'index de celle que tu conseilles — OBLIGATOIRE et pertinent : " +
      "sans réponse de l'utilisateur après ~25 secondes, les options recommandées sont validées automatiquement et le travail continue. " +
      "Il peut aussi répondre librement. N'utilise pas cet outil pour ce que tu peux décider toi-même ou trouver dans le code, " +
      "ni pour demander la permission de continuer (demande-la seulement via une question avec un défaut sûr).",
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '1 à 4 questions',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'La question, claire et autonome' },
              header: { type: 'string', description: 'Étiquette très courte (2 ou 3 mots), ex : « Base de données »' },
              options: {
                type: 'array',
                description: '2 à 4 réponses proposées',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Réponse courte' },
                    description: { type: 'string', description: 'Ce que ce choix implique, en une ligne' },
                  },
                  required: ['label'],
                },
              },
              recommended: { type: 'integer', description: "Index (à partir de 0) de l'option recommandée" },
              multi_select: { type: 'boolean', description: 'Plusieurs réponses possibles' },
            },
            required: ['question', 'options'],
          },
        },
      },
      required: ['questions'],
    },
  },
};

/** Outil réservé au mode plan : le plan s'affiche dans l'onglet « Plan ». */
export const PROPOSE_PLAN_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'propose_plan',
    description: "Mode plan uniquement : soumet le plan d'action à l'utilisateur pour validation. À appeler une seule fois, quand le plan est prêt.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre court du plan (moins de 60 caractères)' },
        plan: { type: 'string', description: 'Plan complet en Markdown : étapes numérotées, fichiers concernés, vérifications, risques' },
      },
      required: ['title', 'plan'],
    },
  },
};

/** Charge les instructions complètes d'une skill (la liste seule est dans le prompt). */
export const LOAD_SKILL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'load_skill',
    description: "Charge les instructions complètes d'une skill de la liste « Skills disponibles ». À utiliser avant d'agir quand une skill correspond à la tâche. Avec file : lit un fichier joint de la skill.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nom exact de la skill' },
        file: { type: 'string', description: 'Facultatif : chemin d\'un fichier joint, tel que listé après les instructions de la skill' },
      },
      required: ['name'],
    },
  },
};
