/**
 * Isolation des commandes du banc réel — portage TypeScript du profil Seatbelt de Rust
 * (`src-tauri/src/sandbox.rs`), pour lancer les commandes de l'agent **exactement comme
 * l'app le fait**, sans la webview.
 *
 * Deux variantes, fidèles chacune à son commit :
 * - `avant`  (e058e56) : hooks et config git protégés (sauf `git init` simple), secrets
 *   illisibles, réseau coupé dans le profil quand la commande n'y a pas droit ;
 * - `apres`  (refonte-agent) : dossier `.git` autorisé en écriture, réseau libre (le relais
 *   a été retiré), ports des connecteurs et tube Audacity bloqués.
 *
 * Le texte des profils est recopié tel quel : la moindre différence de règle changerait
 * ce que l'agent peut faire, donc ce que le banc mesure.
 */
import { existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';

export type BenchVariant = 'avant' | 'apres';

/** Écritures limitées au projet, aux dossiers temporaires et aux caches d'outils (commun). */
const PROFILE = `(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  (subpath (param "ROOT"))
  (subpath (param "GITDIR"))
  (subpath (param "TMP"))
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath (param "CACHES"))
  (subpath (param "NPM"))
  (subpath (param "DOTCACHE"))
  (subpath (param "CARGO"))
  (subpath (param "RUSTUP"))
  (subpath (param "PUB"))
  (subpath (param "DART_TOOL"))
  (subpath (param "DART_SERVER"))
  (subpath (param "FLUTTER_HOME"))
  (subpath (param "FLUTTER_SDK_CACHE"))
  (subpath (param "FLUTTER_TOOLS_CACHE"))
  (subpath (param "GRADLE"))
  (subpath (param "M2"))
  (subpath (param "ANDROID"))
  (subpath (param "GOPATH"))
  (subpath (param "COCOAPODS"))
  (subpath (param "XCODE"))
  (subpath (param "GEM"))
  (subpath (param "BUNDLE"))
  (subpath (param "COMPOSER"))
  (subpath (param "NUGET"))
  (subpath (param "DOTNET"))
  (subpath (param "BUN"))
  (subpath (param "YARN"))
  (subpath (param "PNPM"))
  (literal "/dev/null")
  (literal "/dev/zero")
  (literal "/dev/dtracehelper")
  (regex #"^/dev/tty")
  (regex #"^/dev/fd/"))
`;

/** Avant : secrets du compte jamais lisibles par une commande de l'agent. */
const SECRETS_READ_DENY = `(deny file-read* file-write*
  (subpath (param "SSH"))
  (subpath (param "AWS"))
  (subpath (param "GNUPG"))
  (subpath (param "KUBE"))
  (literal (param "NETRC"))
  (literal (param "GITCRED")))
`;

/** Avant : hooks et configuration git du dépôt en lecture seule. */
const GIT_PROTECT = `
(deny file-write*
  (subpath (param "ROOT_HOOKS"))
  (literal (param "ROOT_GITCONFIG"))
  (subpath (param "GIT_HOOKS"))
  (literal (param "GIT_CONFIG")))
`;

/** Avant : connexions sortantes coupées (sauf localhost) pour les commandes sans réseau. */
const NETWORK_RULES = `
(deny network-outbound (remote ip "*:*"))
(allow network-outbound (remote ip "localhost:*"))
`;

/** Ports des connecteurs + tube Audacity (avant : tout dans un bloc). */
const BLOCKED_LOCAL_PORTS_AVANT = `
(deny network-outbound (remote ip "*:9876"))
(deny network-outbound (remote ip "localhost:9876"))
(deny network-outbound (remote ip "*:9877"))
(deny network-outbound (remote ip "localhost:9877"))
(deny network-outbound (remote ip "*:4455"))
(deny network-outbound (remote ip "localhost:4455"))
(deny file-read* file-write* (regex #"^/(private/)?tmp/audacity_script_pipe\\."))
`;

const BLOCKED_LOCAL_PORTS_APRES = `
(deny network-outbound (remote ip "*:9876"))
(deny network-outbound (remote ip "localhost:9876"))
(deny network-outbound (remote ip "*:9877"))
(deny network-outbound (remote ip "localhost:9877"))
(deny network-outbound (remote ip "*:4455"))
(deny network-outbound (remote ip "localhost:4455"))
`;

const AUDACITY_PIPE = `
(deny file-read* file-write* (regex #"^/(private/)?tmp/audacity_script_pipe\\."))
`;

export const sandboxAvailable = (): boolean =>
  process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');

/**
 * `git init` simple (branche initiale, silencieux), à la racine d'un projet sans dépôt :
 * seule exception à la protection des hooks (e058e56, sandbox.rs::git_init_allowed).
 */
export function gitInitAllowed(program: string, args: string[], root: string, cwd: string): boolean {
  if (program !== 'git' || args[0] !== 'init' || cwd !== root) return false;
  if (existsSync(join(root, '.git'))) return false;
  const rest = args.slice(1)[Symbol.iterator]();
  for (let a = rest.next(); !a.done; a = rest.next()) {
    const s = a.value as string;
    if (s === '-q' || s === '--quiet' || s === '.') continue;
    if (s === '-b' || s === '--initial-branch') {
      if (rest.next().done) return false;
      continue;
    }
    if (s.startsWith('--initial-branch=')) continue;
    return false;
  }
  return true;
}

/** Dossier git commun du dépôt (remonte depuis un fichier `.git` de worktree). */
export function gitCommonDir(root: string): string {
  const dot = join(root, '.git');
  try {
    const text = readFileSync(dot, 'utf8');
    const rest = text.trim().replace(/^gitdir:/, '').trim();
    if (rest !== text.trim()) {
      const raw = rest.startsWith('/') ? rest : join(root, rest);
      const g = realpathSync(raw);
      if (dirname(g).endsWith('/worktrees')) return dirname(dirname(g));
      return g;
    }
  } catch { /* pas de dépôt, ou `.git` est un vrai dossier */ }
  return dot;
}

// readFileSync local : importé ici pour garder le module autonome (voir import en bas).
import { readFileSync } from 'node:fs';

/** SDK Flutter installé : `bin/cache` doit rester inscriptible (verrou de Flutter). */
function flutterSdk(): string | null {
  const path = process.env.PATH || '';
  for (const dir of path.split(':')) {
    if (!dir) continue;
    try {
      const bin = join(dir, 'flutter');
      if (existsSync(bin)) return dirname(dirname(realpathSync(bin)));
    } catch { /* entrée inutilisable */ }
  }
  return null;
}

/** Paramètres `-D CLÉ=valeur` du profil, chemins réels (portage de profile_params). */
export function profileParams(root: string, home: string, tmp: string, variant: BenchVariant): [string, string][] {
  const git = gitCommonDir(root);
  const flutter = flutterSdk() || '/nonexistent/flutter-sdk';
  const base: [string, string][] = [
    ['ROOT', root],
    ['GITDIR', git],
    ['TMP', tmp],
    ['CACHES', join(home, 'Library/Caches')],
    ['NPM', join(home, '.npm')],
    ['DOTCACHE', join(home, '.cache')],
    ['CARGO', join(home, '.cargo')],
    ['RUSTUP', join(home, '.rustup')],
    ['PUB', join(home, '.pub-cache')],
    ['DART_TOOL', join(home, '.dart-tool')],
    ['DART_SERVER', join(home, '.dartServer')],
    ['FLUTTER_HOME', join(home, '.flutter')],
    ['FLUTTER_SDK_CACHE', join(flutter, 'bin/cache')],
    ['FLUTTER_TOOLS_CACHE', join(flutter, 'packages/flutter_tools/.dart_tool')],
    ['GRADLE', join(home, '.gradle')],
    ['M2', join(home, '.m2')],
    ['ANDROID', join(home, '.android')],
    ['GOPATH', join(home, 'go')],
    ['COCOAPODS', join(home, '.cocoapods')],
    ['XCODE', join(home, 'Library/Developer')],
    ['GEM', join(home, '.gem')],
    ['BUNDLE', join(home, '.bundle')],
    ['COMPOSER', join(home, '.composer')],
    ['NUGET', join(home, '.nuget')],
    ['DOTNET', join(home, '.dotnet')],
    ['BUN', join(home, '.bun')],
    ['YARN', join(home, '.yarn')],
    ['PNPM', join(home, 'Library/pnpm')],
  ];
  if (variant === 'avant') {
    base.push(
      ['ROOT_HOOKS', join(root, '.git/hooks')],
      ['ROOT_GITCONFIG', join(root, '.git/config')],
      ['GIT_HOOKS', join(git, 'hooks')],
      ['GIT_CONFIG', join(git, 'config')],
      ['SSH', join(home, '.ssh')],
      ['AWS', join(home, '.aws')],
      ['GNUPG', join(home, '.gnupg')],
      ['KUBE', join(home, '.kube')],
      ['NETRC', join(home, '.netrc')],
      ['GITCRED', join(home, '.git-credentials')],
    );
  }
  return base;
}

export interface Wrapped { program: string; args: string[] }

/** Enveloppe une commande dans sandbox-exec. `root` doit être canonicalisé. */
export function wrap(
  program: string, args: string[], root: string,
  variant: BenchVariant, opts: { allowNetwork?: boolean; gitInit?: boolean } = {},
): Wrapped {
  if (!sandboxAvailable()) return { program, args: [...args] };
  const home = realpathSync(process.env.HOME || '/var/empty');
  const tmp = realpathSync(process.env.TMPDIR || '/private/tmp');
  const allowNetwork = opts.allowNetwork ?? true;
  if (variant === 'avant') {
    const protect = opts.gitInit ? '' : GIT_PROTECT;
    const net = allowNetwork ? '' : NETWORK_RULES;
    const profile = `${PROFILE}${SECRETS_READ_DENY}${protect}${net}${BLOCKED_LOCAL_PORTS_AVANT}`;
    return build(program, args, root, home, tmp, profile, 'avant');
  }
  const profile = `${PROFILE}${BLOCKED_LOCAL_PORTS_APRES}${AUDACITY_PIPE}`;
  return build(program, args, root, home, tmp, profile, 'apres');
}

function build(
  program: string, args: string[], root: string, home: string, tmp: string,
  profile: string, variant: BenchVariant,
): Wrapped {
  const out = ['-p', profile];
  for (const [k, v] of profileParams(root, home, tmp, variant)) out.push('-D', `${k}=${v}`);
  out.push(program, ...args);
  return { program: '/usr/bin/sandbox-exec', args: out };
}
