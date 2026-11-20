/**
 * Garde des commandes (S3) : même en « Accès complet », une commande qui exécute du code
 * écrit par l'agent pendant la tâche, ou un script npm d'apparence dangereuse, demande
 * l'accord de l'utilisateur. Sinon l'agent pourrait écrire « "x": "curl …|sh" » dans
 * package.json puis lancer « npm run x » sans que personne ne voie la vraie commande.
 */
import { fileSystemService } from '@/services/filesystem/fileSystem';

export interface CommandRisk {
  /** Pourquoi on demande l'accord (affiché à l'utilisateur) */
  reason: string;
  /** Ce qui va réellement s'exécuter (corps du script) */
  detail?: string;
}

type Scripts = Record<string, string>;

/** Par tâche : fichiers écrits par l'agent, et scripts de package.json avant sa première modification */
const written = new Map<string, Set<string>>();
const originalScripts = new Map<string, Scripts>();

/**
 * Normalise un chemin relatif pour la comparaison : segments vides, `.` et `//`
 * supprimés, `..` résolu. La casse est conservée pour construire le chemin réel ;
 * `keyRel` fournit une clé insensible à la casse (macOS/Windows).
 */
const cleanRel = (p: string) => {
  const parts: string[] = [];
  for (const raw of String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/')) {
    if (!raw || raw === '.') continue;
    if (raw === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push('..');
      continue;
    }
    parts.push(raw);
  }
  return parts.join('/');
};
const normRel = (p: string) => cleanRel(p);
const keyRel = (p: string) => cleanRel(p).toLowerCase();
const join = (root: string, rel: string) => `${root.replace(/[\\/]+$/, '')}/${normRel(rel)}`;

async function readScripts(root: string): Promise<Scripts | null> {
  try {
    const pkg = JSON.parse(await fileSystemService.readFile(join(root, 'package.json')));
    const s = pkg?.scripts;
    return s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'string')) as Scripts : {};
  } catch {
    return null; // pas de package.json (ou illisible)
  }
}

/** À appeler AVANT chaque écriture de l'agent (write_file, edit_file, delete_file). */
export async function noteAgentWrite(taskId: string, root: string, relPath: string): Promise<void> {
  const rel = keyRel(relPath);
  if (!rel) return;
  if (!written.has(taskId)) written.set(taskId, new Set());
  written.get(taskId)!.add(rel);
  if (rel === 'package.json' && !originalScripts.has(taskId)) {
    originalScripts.set(taskId, (await readScripts(root)) ?? {});
  }
}

export function forgetTask(taskId: string) {
  written.delete(taskId);
  originalScripts.delete(taskId);
}

/** Contenus de script qui ne devraient jamais tourner sans qu'on les voie */
const DANGEROUS: { re: RegExp; label: string }[] = [
  { re: /\b(curl|wget|Invoke-WebRequest|iwr|certutil)\b/i, label: 'téléchargement' },
  { re: /\|\s*(sh|bash|zsh|node|python3?|perl|ruby)\b/i, label: 'exécution de code reçu par un tube' },
  { re: /\b(sh|bash|zsh)\s+-c\b/i, label: 'shell inline' },
  { re: /\b(node\s+(-e|--eval|-p)|python3?\s+-c|perl\s+-e|ruby\s+-e)\b/i, label: 'code inline' },
  { re: /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/i, label: 'suppression récursive' },
  { re: /\b(sudo|su)\b\s/i, label: 'droits administrateur' },
  { re: /\b(ssh|scp|sftp|rsync|nc|ncat|netcat|telnet|ftp)\b/i, label: 'connexion réseau' },
  { re: /\bbase64\b|\beval\b/i, label: 'code masqué' },
  { re: /~\/\.(ssh|aws|npmrc|gitconfig|config)|\/etc\/|\$HOME\/\.|%USERPROFILE%/i, label: 'fichiers sensibles' },
  { re: /\bgit\s+(push|remote\s+add)\b/i, label: 'envoi du code' },
  { re: /\bnpm\s+(publish|adduser|login|token)\b/i, label: 'publication npm' },
  { re: /\bpowershell\b|\bcmd(\.exe)?\s+\/c\b/i, label: 'shell Windows' },
];

export function dangerousLabel(body: string): string | null {
  for (const d of DANGEROUS) if (d.re.test(body)) return d.label;
  return null;
}

/** Scripts npm réellement lancés par la commande (avec pre/post) */
export function npmScriptsFor(tokens: string[]): string[] | null {
  if (tokens[0] !== 'npm') return null;
  const sub = tokens[1];
  const withHooks = (n: string) => [`pre${n}`, n, `post${n}`];
  if (sub === 'run' || sub === 'run-script' || sub === 'rum' || sub === 'urn') {
    const name = tokens.slice(2).find((t) => !t.startsWith('-'));
    return name ? withHooks(name) : [];
  }
  if (sub === 'start' || sub === 'stop' || sub === 'restart') return withHooks(sub);
  if (sub === 'test' || sub === 't' || sub === 'tst') return withHooks('test');
  if (['install', 'i', 'ci', 'add', 'isntall', 'in'].includes(sub)) return ['preinstall', 'install', 'postinstall', 'prepare'];
  return [];
}

/**
 * Risque d'une commande run_command pour la tâche `taskId`.
 * null : rien de particulier (le mode de permission habituel s'applique).
 */
export async function commandRisk(taskId: string, root: string, command: string): Promise<CommandRisk | null> {
  const tokens = String(command || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const exe = tokens[0].toLowerCase();
  const touched = written.get(taskId) || new Set<string>();

  // Sorties réseau et configurations Git : jamais silencieuses, même en Full.
  if (exe === 'git') {
    const sub = (tokens[1] || '').toLowerCase();
    const config = sub === 'config' || tokens.some((tok) => tok === '-c' || tok === '--config-env');
    if (config) {
      return { reason: 'modifie la configuration Git (hooks, fsmonitor ou chemin de configuration)', detail: command };
    }
    if (sub === 'push' || (sub === 'remote' && tokens[2] === 'add')) {
      return { reason: 'envoie le code ou configure un dépôt distant', detail: command };
    }
    // Un hook ou un script de hook écrit par l'agent peut être exécuté par ces commandes.
    if (['commit', 'merge', 'rebase', 'am', 'checkout', 'switch', 'pull'].includes(sub)
      && [...touched].some((rel) => /(^|\/)(\.git|\.husky)(\/|$)/.test(rel))) {
      return { reason: `Git « ${sub} » peut exécuter un hook écrit par l'agent`, detail: command };
    }
  }
  if (['npm', 'pnpm', 'yarn'].includes(exe) && ['install', 'i', 'ci', 'add', 'isntall', 'in'].includes(tokens[1])) {
    return { reason: 'installe des dépendances (scripts de cycle de vie possibles)', detail: command };
  }
  if (['pip', 'pip3'].includes(exe) && tokens[1] === 'install') {
    return { reason: 'installe un paquet Python (code d’installation possible)', detail: command };
  }
  if (exe === 'cargo' && tokens[1] === 'install') {
    return { reason: 'installe un binaire Cargo (code de build possible)', detail: command };
  }

  // node / python sur un fichier que l'agent vient d'écrire
  if (['node', 'python', 'python3', 'deno', 'bun', 'ts-node', 'tsx'].includes(exe)) {
    const file = tokens.slice(1).find((t) => !t.startsWith('-'));
    if (file && touched.has(keyRel(file))) {
      return { reason: `exécute ${normRel(file)}, un fichier écrit par l'agent dans cette tâche` };
    }
    // python -m package : le module exécutable est package/__main__.py ou package.py
    const mIndex = tokens.findIndex((tok) => tok === '-m' || tok === '--module');
    const module = mIndex >= 0 ? tokens[mIndex + 1] : '';
    if (module) {
      const modulePath = module.replace(/\./g, '/');
      const candidates = [`${modulePath}.py`, `${modulePath}/__init__.py`, `${modulePath}/__main__.py`];
      if (candidates.some((candidate) => touched.has(keyRel(candidate)))) {
        return { reason: `exécute le module ${module}, un fichier écrit par l'agent dans cette tâche` };
      }
    }
    return null;
  }

  const names = npmScriptsFor(tokens.map((t, i) => (i < 2 ? t.toLowerCase() : t)));
  if (!names || names.length === 0) return null;
  const scripts = await readScripts(root);
  if (!scripts) return null;
  const before = originalScripts.get(taskId);
  for (const name of names) {
    const body = scripts[name];
    if (!body) continue;
    if (before && before[name] !== body) {
      return { reason: `le script npm « ${name} » a été ${before[name] === undefined ? 'ajouté' : 'modifié'} par l'agent dans cette tâche`, detail: body };
    }
    const runsWritten = [...touched].find((rel) => rel !== 'package.json' && body.toLowerCase().includes(rel));
    if (runsWritten) return { reason: `le script npm « ${name} » lance ${runsWritten}, un fichier écrit par l'agent dans cette tâche`, detail: body };
    const label = dangerousLabel(body);
    if (label) return { reason: `le script npm « ${name} » contient une commande sensible (${label})`, detail: body };
  }
  return null;
}
