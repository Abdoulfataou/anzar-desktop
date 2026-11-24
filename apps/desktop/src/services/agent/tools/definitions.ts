/**
 * Définitions des outils envoyées au modèle (format function-calling).
 */
import { ToolDefinition } from '@/types';
import { SUBAGENT_ROLES } from '../profiles';

// ============================================================================
// DÉFINITIONS (envoyées au modèle)
// ============================================================================

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        "Lit le contenu d'un fichier du projet. Utilise offset/limit pour les gros fichiers (lignes).",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif au projet (ex: src/App.tsx)' },
          offset: { type: 'number', description: 'Ligne de départ (1-indexée, optionnel)' },
          limit: { type: 'number', description: 'Nombre max de lignes (optionnel)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Crée ou remplace ENTIÈREMENT un fichier. Pour modifier un fichier existant, préfère edit_file (plus sûr et moins coûteux).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif au projet' },
          content: { type: 'string', description: 'Contenu complet du fichier' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        "Modifie un fichier par remplacement exact de texte. old_text doit apparaître EXACTEMENT une fois dans le fichier (inclut l'indentation). Échoue si introuvable ou ambigu.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif au projet' },
          old_text: { type: 'string', description: 'Texte exact à remplacer (unique dans le fichier)' },
          new_text: { type: 'string', description: 'Nouveau texte' },
          replace_all: { type: 'boolean', description: 'Remplacer toutes les occurrences (défaut: false)' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Supprime un fichier du projet.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif au projet' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: "Liste le contenu d'un dossier (fichiers + sous-dossiers, non récursif au-delà de depth).",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: "Chemin relatif au projet ('' ou '.' = racine)" },
          depth: { type: 'number', description: 'Profondeur (défaut: 2, max: 4)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_dev_server',
      description:
        "Lance en arrière-plan le serveur de développement du projet (npm run dev, npm start…) et renvoie son adresse locale. " +
        "Sans command, la commande est devinée depuis package.json. Un seul serveur par projet : s'il tourne déjà, son adresse est renvoyée. " +
        "À utiliser avant check_page pour vérifier une app web que tu as modifiée.",
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Commande de lancement (facultative), ex : npm run dev' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dev_server_logs',
      description: "Dernières lignes du serveur de développement lancé par start_dev_server : erreurs de compilation, requêtes reçues, plantages côté serveur.",
      parameters: { type: 'object', properties: { lines: { type: 'number', description: 'Nombre de lignes (60 par défaut)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_dev_server',
      description: 'Arrête le serveur de développement lancé par start_dev_server.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_page',
      description:
        "Ouvre une page dans un vrai navigateur (sans fenêtre) et rapporte : titre, erreurs et avertissements de la console, requêtes en échec, " +
        "et le contenu de la page sous forme d'arbre avec des repères ref=… (pour page_action). Sans url : l'adresse du serveur lancé par start_dev_server. " +
        "Utilise-le pour VÉRIFIER une app web après tes modifications, comme le ferait l'utilisateur.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Adresse complète, ex : http://localhost:5173/connexion (facultative)' },
          wait_for_text: { type: 'string', description: 'Texte à attendre avant de lire la page (facultatif)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'capture_page',
      description:
        "Prend des captures d'écran d'une page et te les MONTRE, pour juger le rendu visuel comme un designer : mise en page, typographie, " +
        "couleurs, contraste, débordements, version téléphone. Pour une animation, donne frames (instants en millisecondes, ex [0, 150, 400, 1000]) : " +
        "toutes les animations (CSS, GSAP, canvas, three.js, JavaScript) sont figées à chaque instant exact grâce à une horloge virtuelle. " +
        "Pour un fichier HTML du projet, donne file (aucun serveur nécessaire). Sans url ni file : le serveur lancé par start_dev_server, sinon la page ouverte par check_page. " +
        "À utiliser après TOUTE création ou modification visuelle (interface, page, affiche, animation), puis corriger ce que tu vois.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Adresse complète, ex : http://localhost:5173/ (facultative)' },
          file: { type: 'string', description: 'Fichier HTML du projet à capturer, ex : pub/index.html (facultatif, remplace url)' },
          viewports: { type: 'array', items: { type: 'string', enum: ['desktop', 'mobile'] }, description: 'Formats : desktop (1280×800) et/ou mobile (390×844). Par défaut les deux.' },
          frames: { type: 'array', items: { type: 'number' }, description: 'Animation : instants à capturer, en ms (6 au plus)' },
          full_page: { type: 'boolean', description: 'Capturer toute la hauteur de la page (sans frames)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_animation',
      description:
        "Exporte une page animée en VIDÉO MP4 (ou GIF) : la page est enregistrée image par image au rythme exact (fps) avec une horloge " +
        "virtuelle (CSS, GSAP, canvas, three.js, JavaScript : tout est déterministe), puis assemblée en vidéo dans l'app (rien à installer). Pas de son. " +
        "RÈGLE ABSOLUE : l'export est la DERNIÈRE étape. Après toute modification de la page (même minime), réexporte avant de conclure : " +
        "la vidéo livrée doit correspondre à la dernière version. Ne demande JAMAIS à l'utilisateur de dire « réexporte »." +
        " Formats : story (1080×1920, Reels, TikTok, statut WhatsApp), carre (1080×1080), portrait (1080×1350), paysage (1920×1080), " +
        "ou width/height. Musique de fond possible (music : fichier MP3, M4A ou WAV fourni par l'utilisateur ; découpée à la durée, en boucle si trop courte, avec fondus). " +
        "Tu reçois ensuite 4 images clés de la vidéo pour la vérifier. Pour un fichier HTML du projet, donne file (aucun serveur nécessaire).",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Page à enregistrer, ex : http://localhost:4321/pub.html (facultative)' },
          file: { type: 'string', description: 'Fichier HTML du projet à enregistrer, ex : pub/index.html (remplace url)' },
          format: { type: 'string', enum: ['mp4', 'gif', 'png'], description: 'mp4 (défaut), gif (court, léger) ou png (une seule image : visuel fixe, affiche, publication)' },
          size: { type: 'string', enum: ['story', 'carre', 'portrait', 'paysage', 'a4'], description: 'Format (défaut : story ; a4 = affiche 2480×3508)' },
          width: { type: 'number', description: 'Largeur en px (remplace size)' },
          height: { type: 'number', description: 'Hauteur en px (remplace size)' },
          duration_ms: { type: 'number', description: 'Durée en ms (défaut 4000 ; 60000 au plus en mp4, 20000 en gif). En png : instant capturé (défaut 1500)' },
          fps: { type: 'number', description: 'Images par seconde (défaut 30 en mp4, 15 en gif ; 60 au plus)' },
          output: { type: 'string', description: 'Fichier à créer dans le projet, ex : export/pub-boutique.mp4 (défaut : export/animation.mp4)' },
          music: { type: 'string', description: "Musique de fond (MP3, M4A ou WAV) : chemin d'un fichier du projet, ex : .anzar/fichiers/musique.mp3 (mp4 seulement)" },
          music_start_ms: { type: 'number', description: 'Où commencer dans la musique, en ms (défaut 0)' },
          music_volume: { type: 'number', description: 'Volume de la musique, de 0 à 1 (défaut 1)' },
          fade_out_ms: { type: 'number', description: 'Fondu de sortie de la musique, en ms (défaut 800)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_action',
      description:
        "Agit sur la page ouverte par check_page, puis rapporte son nouvel état (console, requêtes, contenu). " +
        "click : cliquer ; type : saisir du texte (submit:true appuie sur Entrée) ; select : choisir une option ; press : touche (key) ; wait : attendre un texte ou quelques secondes. " +
        "target est le repère ref=… de l'élément, tel qu'il apparaît dans le contenu de la page.",
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['click', 'type', 'select', 'press', 'wait'] },
          target: { type: 'string', description: 'Repère de l\'élément, ex : e12' },
          element: { type: 'string', description: "Description lisible de l'élément, ex : bouton « Se connecter »" },
          text: { type: 'string', description: 'Texte à saisir (type), option (select) ou texte attendu (wait)' },
          submit: { type: 'boolean', description: 'type : appuyer sur Entrée après la saisie' },
          values: { type: 'array', items: { type: 'string' }, description: 'select : options à choisir' },
          key: { type: 'string', description: 'press : touche, ex : Enter, Escape, ArrowDown' },
          seconds: { type: 'number', description: 'wait : durée maximale en secondes (30 au plus)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explore',
      description:
        "Lance 1 à 8 explorateurs rapides EN PARALLÈLE, en lecture seule : chacun répond à une question précise sur le code du projet et ne te rend qu'un résumé court avec les fichiers et lignes clés. " +
        "Utilise-le pour comprendre un projet moyen ou gros sans remplir ton contexte (où est géré X, comment Y est branché, quels fichiers utilisent Z). " +
        "Pose des questions indépendantes et précises. Inutile pour lire un ou deux fichiers que tu connais déjà : fais-le toi-même.",
      parameters: {
        type: 'object',
        properties: {
          questions: { type: 'array', items: { type: 'string' }, description: 'Questions indépendantes, une par explorateur (8 au plus)' },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_diagnostics',
      description:
        "Erreurs de code (types, noms inconnus, imports) de fichiers TypeScript/JavaScript ou Python, sans lancer de build. " +
        "Les fichiers que tu écris sont déjà vérifiés automatiquement : utilise cet outil pour contrôler d'autres fichiers touchés par ton changement (ceux qui importent ce que tu as modifié).",
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'Chemins relatifs des fichiers à vérifier (8 au plus)' },
        },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Recherche un motif (regex) dans les fichiers texte du projet. Renvoie fichier:ligne: extrait.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Expression régulière (JavaScript)' },
          path: { type: 'string', description: 'Sous-dossier à chercher (optionnel, défaut: racine)' },
          file_glob: { type: 'string', description: "Filtre d'extension simple, ex: '.ts' ou '.py' (optionnel)" },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        "Exécute UNE commande dans le projet. Programmes autorisés : npm, node, git, python, pip, cargo, ffmpeg (après install_tool), rg — rien d'autre (pas de grep, ls, cat, find, head, echo). " +
        "Jamais node -e ni python -c (refusés) : pour un traitement, écris un fichier script (.mjs/.py) avec write_file puis lance-le. Interdits : |, ;, &&, ||, >, <, $(…) et chemins absolus. Pour chercher dans le code utilise search_files, pour lister list_dir, pour lire read_file. " +
        "Sert à installer des dépendances, lancer build/lint/tests et VÉRIFIER ton travail. Renvoie stdout/stderr + code de sortie.",
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: "Une seule commande, ex: 'npm run build' ou 'git log --oneline -5'" },
          cwd: { type: 'string', description: 'Sous-dossier relatif (optionnel, défaut: racine du projet)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_subagents',
      description:
        "Lance 2 à 3 sous-agents pour des sous-tâches INDÉPENDANTES (fichiers différents, aucun chevauchement). Hors Accès complet, ils sont en lecture seule ; en Accès complet, ils peuvent écrire mais sont exécutés séquentiellement pour éviter les conflits. Chaque sous-agent a un budget réduit et pas de vérification finale — c'est TOI qui vérifies après consolidation. " +
        "Précise le rôle de chacun : chaque rôle est un profil d'agent (services/agent/profiles) qui définit ses outils, son modèle et ses skills — 'motion-designer' (visuels/animations/vidéos), 'redaction' (textes), 'dev' (code, défaut). Idéal pour plusieurs variantes de visuels.",
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string', description: 'La sous-tâche complète et autonome (fichiers cibles inclus)' },
                role: { type: 'string', enum: SUBAGENT_ROLES, description: 'Spécialisation déclarée par un profil (défaut : déduite de la tâche)' },
              },
              required: ['task'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'install_tool',
      description:
        "Installe un outil binaire du catalogue vérifié d'ANZAR (avec l'accord de l'utilisateur, une seule fois) : " +
        "'ffmpeg' (encodage vidéo rapide, conversion GIF/MP4, compression pour WhatsApp — utile pour livrer des vidéos légères) " +
        "'ripgrep' (recherche instantanée rg). Rangé dans les fichiers d'ANZAR, empreinte vérifiée, rien sur le système. " +
        "Après installation, la commande est directement utilisable dans run_command. Vérifie d'abord l'état renvoyé (installed).",
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: ['ffmpeg', 'ripgrep'], description: "L'outil à installer" },
        },
        required: ['tool'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vendor_lib',
      description:
        "Copie des bibliothèques d'animation VENDÉES dans ANZAR (hors ligne, version figée) dans libs/ du projet : " +
        "'gsap' (core), 'split-text' (typo par lignes/mots/lettres), 'draw-svg' (SVG tracé), 'morph-svg' (morphing), " +
        "'scramble-text' (texte brouillé), 'flip' (transitions layout), 'custom-ease', ou 'all' pour tout GSAP 3.13. " +
        "Renvoie les balises <script> exactes et le gsap.registerPlugin à insérer. Utilise-le pour toute page animée " +
        "au lieu d'un CDN (capture reproductible, jamais coupée par le réseau).",
      parameters: {
        type: 'object',
        properties: {
          libs: {
            type: 'array',
            items: { type: 'string' },
            description: "Libs à copier, ex : ['gsap','split-text','draw-svg'] ou ['all']",
          },
        },
        required: ['libs'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description:
        "Enregistre une information durable dans la mémoire du projet (ANZAR.md) : convention de code, décision d'architecture, piège découvert, commande de build particulière. Sera relue dans les prochaines sessions. N'enregistre PAS de banalités ni le détail de la tâche en cours.",
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: "Catégorie courte: 'convention', 'architecture', 'piège', 'build', 'dépendance'…",
          },
          note: { type: 'string', description: "L'information à retenir (1-4 phrases, précise et actionnable)" },
        },
        required: ['category', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_done',
      description:
        "Signale que la tâche est TERMINÉE et vérifiée. À appeler UNIQUEMENT après avoir vérifié ton travail (build/lint/tests via run_command quand c'est possible).",
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: "Résumé de ce qui a été fait, dans la langue de tes réponses à l'utilisateur" },
          verification: { type: 'string', description: 'Comment le travail a été vérifié (commande + résultat)' },
        },
        required: ['summary'],
      },
    },
  },
];
