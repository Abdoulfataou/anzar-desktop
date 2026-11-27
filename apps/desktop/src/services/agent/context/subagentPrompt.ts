/**
 * Prompt système d'un sous-agent.
 *
 * Un sous-agent n'est pas l'agent principal : il reçoit UNE tâche d'un autre agent, ne voit
 * pas la conversation, ne peut poser aucune question ni demander d'accès, et rend un rapport
 * que l'agent principal lit à sa place. Ses consignes le disent, et ne citent que les outils
 * qu'il a réellement : un outil annoncé mais absent lui ferait perdre des étapes.
 *
 * Structure inspirée des sous-agents de DeepSeek Harness (packages/subagent, MIT) : tâche
 * autonome, périmètre strict, rapport final structuré.
 */
import type { PermissionMode } from '../policy/permissions';
import { LEAD_ONLY_SKILLS, type AgentProfile } from '../profiles';
import { BUILTIN_SKILLS } from '@/services/skills/pack';
import type { Skill } from '@/services/skills';
import { projectContextSections, type AgentPromptContext } from './agentPrompts';

export interface SubagentPromptInput {
  /** Projet : nom, racine, mémoire, carte du code. */
  project: AgentPromptContext;
  /** Profil du rôle (consignes, skills obligatoires). */
  profile?: AgentProfile;
  /** Outils réellement proposés à ce sous-agent. */
  tools: Iterable<string>;
  /** Mode de permission hérité du parent. */
  permissionMode?: PermissionMode;
  /** Ordinateur sous Windows (pas d'isolation des commandes). */
  windows: boolean;
  /** Skills disponibles (projet, personnelles, intégrées) : la liste, pas le contenu. */
  skills?: Skill[];
  maxSteps: number;
}

/** Groupes d'outils, dans l'ordre où un sous-agent s'en sert. */
const TOOL_GROUPS: { label: string; tools: string[]; note?: string }[] = [
  { label: 'Lire et chercher', tools: ['read_file', 'list_dir', 'glob', 'search_files', 'get_diagnostics', 'explore'] },
  { label: 'Écrire', tools: ['edit_file', 'write_file', 'apply_patch', 'delete_file'], note: 'edit_file pour modifier, write_file pour créer, apply_patch pour plusieurs fichiers d’un coup' },
  { label: 'Commandes', tools: ['bash', 'powershell', 'run_command', 'job_output', 'job_kill'] },
  { label: 'App web', tools: ['start_dev_server', 'dev_server_logs', 'stop_dev_server', 'check_page', 'capture_page', 'page_action'] },
  { label: 'Médias', tools: ['vendor_lib', 'install_tool', 'export_animation'] },
  { label: 'Skills', tools: ['load_skill'] },
  { label: 'Fin', tools: ['task_done'], note: 'avec ton rapport' },
];

export function toolsSection(available: Iterable<string>): string {
  const set = new Set(available);
  const lines = TOOL_GROUPS
    .map((g) => ({ ...g, present: g.tools.filter((t) => set.has(t)) }))
    .filter((g) => g.present.length > 0)
    .map((g) => `- ${g.label} : ${g.present.join(', ')}${g.note ? ` (${g.note})` : ''}`);
  return `# Tes outils\n${lines.join('\n')}\nN'utilise que ces outils : aucun autre n'existe pour toi.`;
}

/** Ce que les commandes peuvent faire pour ce sous-agent, sans promesse fausse. */
export function commandsFact(tools: Set<string>, mode: PermissionMode | undefined, windows: boolean, writes = true): string {
  const shell = tools.has('bash') || tools.has('powershell') || tools.has('run_command');
  const fallback = tools.has('get_diagnostics') ? 'vérifie avec get_diagnostics et indique' : 'indique';
  if (!shell) {
    return windows && mode !== 'full'
      ? `Sur cet ordinateur (Windows), tes commandes sont refusées hors Accès complet : ${fallback} dans ton rapport les commandes que l'agent principal devra lancer.`
      : `Tu n'as pas de commandes : ${fallback} dans ton rapport les commandes (build, tests) que l'agent principal devra lancer.`;
  }
  if (mode === 'full') {
    return `Accès complet : tes commandes${writes ? ' et écritures' : ''} ne sont pas confinées. Reste quand même dans le projet et dans ta tâche.`;
  }
  return writes
    ? 'Tes commandes et écritures sont confinées au projet (plus les dossiers temporaires et les caches). Tu ne peux pas demander plus : une écriture refusée hors du projet se signale dans ton rapport.'
    : 'Tes commandes sont confinées au projet (plus les dossiers temporaires et les caches). Sers-t’en pour lire et vérifier (tests, lint, build), jamais pour modifier un fichier.';
}

/** Taille maximale d'une skill injectée d'office (une skill de projet peut être longue). */
const MAX_ROLE_SKILL_CHARS = 20_000;

/** Skills : consignes obligatoires du rôle, puis la liste des autres à charger au besoin. */
export function skillsSections(profile: AgentProfile | undefined, skills: Skill[], canLoad: boolean): string[] {
  const out: string[] = [];
  // Skill du projet ou personnelle du même nom d'abord (elle remplace celle d'ANZAR), puis le pack.
  const mandatory = (profile?.skills ?? [])
    .filter((name) => !LEAD_ONLY_SKILLS.has(name))
    .map((name) => {
      const own = skills.find((s) => s.name === name && s.body.trim());
      if (own) return `---\nname: ${own.name}\ndescription: ${own.description}\n---\n\n${own.body.slice(0, MAX_ROLE_SKILL_CHARS)}`;
      return BUILTIN_SKILLS.find((s) => s.name === name)?.markdown;
    })
    .filter((md): md is string => !!md);
  if (mandatory.length) {
    out.push(`# Skills de ton rôle (applique-les à la lettre)\n${mandatory.join('\n\n---\n\n')}`);
  }
  const already = new Set(profile?.skills ?? []);
  const others = skills.filter((s) => !already.has(s.name) && !LEAD_ONLY_SKILLS.has(s.name));
  if (canLoad && others.length) {
    out.push(`# Skills disponibles
Fiches d'instructions éprouvées. Quand l'une correspond à ta tâche, charge-la avec load_skill AVANT d'agir, puis suis-la. N'exécute pas un script fourni par une skill : signale-le dans ton rapport.
${others.map((s) => `- ${s.name} : ${s.description}`).join('\n')}`);
  }
  return out;
}

export function buildSubagentSystemPrompt(input: SubagentPromptInput): string {
  const tools = new Set(input.tools);
  const role = input.profile;
  const writes = ['edit_file', 'write_file', 'apply_patch'].some((t) => tools.has(t));
  const shell = tools.has('bash') || tools.has('powershell') || tools.has('run_command');
  const diagnostics = tools.has('get_diagnostics');

  const method = writes
    ? [
        "Comprends : lis les fichiers concernés avant de modifier. Ne devine jamais le contenu d'un fichier ; suis les conventions du projet (AGENTS.md, mémoire du projet, style du code existant).",
        "Agis dans ton périmètre : ne modifie que les fichiers nécessaires à ta tâche. Pas de refonte, pas d'amélioration non demandée, pas de nouvelle dépendance sans nécessité (signale-la).",
        `Vérifie : corrige les erreurs signalées après tes écritures${shell
          ? ', puis lance le build, le lint ou les tests ciblés sur ce que tu as touché'
          : diagnostics ? ' et contrôle avec get_diagnostics' : ' et relis le résultat'}.`,
      ]
    : [
        "Comprends : lis le code concerné et ce qui l'entoure. Ne devine jamais le contenu d'un fichier.",
        'Tu ne modifies aucun fichier : tu analyses et tu rapportes.',
        `Prouve chaque constat : la ligne lue${diagnostics ? ', get_diagnostics' : ''}${shell ? ' ou une commande (tests, lint, build) et son résultat' : ''}.`,
      ];

  const rules = [
    "Personne ne peut te répondre : ne pose aucune question. Fais le choix raisonnable et note-le dans ton rapport.",
    ...(writes ? ["Si un fichier a été modifié par un autre agent depuis ta lecture, l'écriture est refusée : relis-le, puis réapplique ta modification. N'écrase jamais le travail d'un autre."] : []),
    commandsFact(tools, input.permissionMode, input.windows, writes),
    'Ne contourne jamais un refus par un autre outil ou un script : signale-le, l\'agent principal décidera.',
    ...(shell ? [`Commande longue : ${tools.has('job_output') ? 'en arrière-plan avec job_output, ou bornée' : 'bornée'} (un seul test, délai par test). Un délai dépassé signifie le plus souvent une commande bloquée : cherche pourquoi au lieu d'allonger le délai.`] : []),
    ...(writes ? ["Pas de commit, pas de changement de branche : l'agent principal consolide le travail."] : []),
    `Au plus ${input.maxSteps} étapes : va droit au but, regroupe les lectures${writes ? ' et les modifications' : ''}.`,
    'Écris ton rapport dans la langue de la tâche reçue. Le code, les noms de fichiers et les commandes restent tels quels.',
  ];

  const report = writes
    ? [
        '**Résultat** : ce qui est fait, en une ou deux phrases.',
        '**Fichiers** : chaque fichier créé ou modifié, avec une ligne sur ce qui a changé.',
        '**Vérification** : ce que tu as lancé ou contrôlé, et le résultat exact.',
        '**Choix et points ouverts** : décisions prises seul, ce qui reste à faire ou ce qui a été refusé.',
      ]
    : [
        '**Résultat** : la conclusion, en une ou deux phrases.',
        '**Constats** : chacun avec chemin:ligne, ce qui se passe et dans quel cas, classés du plus grave au moins grave.',
        '**Vérification** : ce que tu as lu, lancé ou contrôlé, et le résultat exact.',
        '**Points ouverts** : ce que tu n\'as pas pu vérifier.',
      ];

  const sections: string[] = [];
  sections.push(`Tu es un sous-agent d'ANZAR${role ? `, rôle « ${role.name} »` : ''}. Un agent principal t'a confié UNE tâche pendant qu'il avance sur le reste ; d'autres sous-agents peuvent travailler en même temps dans le même projet.

# Méthode
${method.map((m, i) => `${i + 1}. ${m}`).join('\n')}
${method.length + 1}. Termine avec task_done et ton rapport, même si tout n'est pas fini : dis ce qui est fait et ce qui bloque.

# Règles
${rules.map((r) => `- ${r}`).join('\n')}

# Rapport final (dans task_done)
${report.join('\n')}
Sois factuel et bref : l'agent principal lit ce rapport, pas ton historique.`);

  sections.push(toolsSection(tools));
  if (role?.prompt) sections.push(`# Ton rôle\n${role.prompt}`);
  sections.push(...skillsSections(role, input.skills ?? [], tools.has('load_skill')));
  sections.push(...projectContextSections(input.project));
  return sections.join('\n\n');
}
