/**
 * Programmes utilisés par ANZAR : état, installation, et explications à copier.
 *
 * - Node.js : téléchargé par ANZAR (voir nodeRuntime.ts).
 * - Git : sur Windows, ANZAR télécharge MinGit (Git portable officiel) ; sur Mac, macOS propose
 *   les outils développeur d'Apple. Contrôlé avant chaque commande git.
 * - Python : jamais installé par ANZAR. S'il manque, l'agent fait la tâche avec Node.js
 *   (pdf-lib, exceljs, docx, sharp), toujours disponible.
 * - Rust, Docker, Bun, Deno, uv : commande d'installation officielle à copier.
 */
import { invoke } from '@tauri-apps/api/tauri';
import toast from 'react-hot-toast';

export interface ProgramInfo {
  id: 'node' | 'git' | 'python' | 'chrome' | 'uv' | 'cargo' | 'docker' | 'bun' | 'deno' | string;
  name: string;
  status: 'ok' | 'missing';
  version: string | null;
  path: string | null;
  /** auto : ANZAR l'installe ; apple : outils développeur d'Apple ; manual : à installer soi-même */
  install: 'auto' | 'apple' | 'manual';
  note: string | null;
}

export type Platform = 'mac' | 'windows' | 'linux';
export function platform(): Platform {
  const p = navigator.platform.toLowerCase();
  return p.includes('win') ? 'windows' : p.includes('mac') ? 'mac' : 'linux';
}

let cache: { at: number; list: ProgramInfo[] } | null = null;

/** État des programmes (relu au plus toutes les 20 s, sauf `fresh`). */
export async function programsStatus(fresh = false): Promise<ProgramInfo[]> {
  if (!fresh && cache && Date.now() - cache.at < 20_000) return cache.list;
  try {
    const list = await invoke<ProgramInfo[]>('programs_status');
    cache = { at: Date.now(), list };
    return list;
  } catch { return []; }
}

/** Commande officielle d'installation, à copier dans le Terminal (Mac, Linux) ou PowerShell (Windows). */
export function installCommand(id: string, p: Platform = platform()): { command?: string; where: string; link?: string } {
  const term = p === 'windows' ? 'PowerShell' : 'le Terminal';
  const C: Record<string, Partial<Record<Platform, string>>> = {
    node: { mac: 'brew install node', windows: 'winget install OpenJS.NodeJS.LTS', linux: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash' },
    git: { mac: 'xcode-select --install', windows: 'winget install Git.Git', linux: 'sudo apt install git' },
    python: { mac: 'brew install python', windows: 'winget install Python.Python.3.12', linux: 'sudo apt install python3 python3-pip' },
    uv: { mac: 'curl -LsSf https://astral.sh/uv/install.sh | sh', windows: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"', linux: 'curl -LsSf https://astral.sh/uv/install.sh | sh' },
    cargo: { mac: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh", windows: 'winget install Rustlang.Rustup', linux: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" },
    docker: { windows: 'winget install Docker.DockerDesktop' },
    bun: { mac: 'curl -fsSL https://bun.sh/install | bash', windows: 'powershell -c "irm bun.sh/install.ps1 | iex"', linux: 'curl -fsSL https://bun.sh/install | bash' },
    deno: { mac: 'curl -fsSL https://deno.land/install.sh | sh', windows: 'irm https://deno.land/install.ps1 | iex', linux: 'curl -fsSL https://deno.land/install.sh | sh' },
  };
  const LINKS: Record<string, string> = {
    node: 'https://nodejs.org', git: 'https://git-scm.com/downloads', python: 'https://www.python.org/downloads/',
    uv: 'https://docs.astral.sh/uv/', cargo: 'https://rustup.rs', docker: 'https://www.docker.com/products/docker-desktop/',
    bun: 'https://bun.sh', deno: 'https://deno.com', chrome: 'https://www.google.com/chrome/',
  };
  return { command: C[id]?.[p], where: term, link: LINKS[id] };
}

/** Texte d'aide pour l'utilisateur, relayé par l'agent. */
export function programHelp(id: string, name: string, reason?: string): string {
  const { command, where, link } = installCommand(id);
  return `${name} n'est pas installé sur cet ordinateur${reason ? ` (nécessaire pour ${reason})` : ''}. `
    + (command ? `Pour l'installer, tape cette commande dans ${where} :\n\`\`\`\n${command}\n\`\`\`\n` : '')
    + (link ? `${command ? 'Ou t' : 'T'}élécharge-le sur ${link}. ` : '')
    + "Ensuite, ferme et rouvre ANZAR. La page Réglages → Programmes montre ce qui est installé.\n"
    + "(Pour l'agent : explique cela simplement à l'utilisateur, avec la commande, sans jargon.)";
}

// ── Git ──────────────────────────────────────────────────────────────────────

let gitOk = false;
let gitDeclined = false;
let appleLaunched = false;
let gitInstalling: Promise<boolean> | null = null;

async function ask(title: string, message: string): Promise<boolean> {
  try {
    const { ask: dialogAsk } = await import('@tauri-apps/api/dialog');
    return await dialogAsk(message, { title, type: 'info' });
  } catch { return false; }
}

export async function installGitNow(): Promise<boolean> {
  const { listen } = await import('@tauri-apps/api/event');
  const id = toast.loading('Téléchargement de Git…');
  const stop = await listen<{ received: number; total: number | null; step: string }>('git://progress', (e) => {
    const { received, total, step } = e.payload;
    const mo = (n: number) => `${Math.round(n / 1048576)} Mo`;
    toast.loading(step === 'download' ? `Téléchargement de Git… ${mo(received)}${total ? ` / ${mo(total)}` : ''}` : step === 'extract' ? 'Installation de Git…' : 'Préparation de Git…', { id });
  });
  try {
    const v = await invoke<string>('git_install');
    toast.success(`Git ${v.replace(/^v/, '').replace(/\.windows\.\d+$/, '')} est prêt.`, { id });
    gitOk = true;
    return true;
  } catch (e: any) {
    toast.error(`Git n'a pas pu être téléchargé : ${String(e?.message || e)}`, { id, duration: 8000 });
    return false;
  } finally {
    stop();
  }
}

/** Mac : demande à macOS de proposer les outils développeur d'Apple (Git, Python…). */
export async function installAppleDevTools(): Promise<boolean> {
  try {
    await invoke('apple_dev_tools_install');
    toast('macOS va proposer d\'installer les outils développeur d\'Apple. Accepte, puis réessaie dans ANZAR une fois l\'installation finie.', { duration: 10000 });
    return true;
  } catch { return false; }
}

/**
 * S'assure que Git est disponible avant une commande git. `interactive` : peut proposer
 * l'installation (commande demandée par l'utilisateur ou l'agent) ; faux pour les vérifications
 * automatiques de l'app (panneau Git), qui ne doivent jamais ouvrir de fenêtre.
 */
export async function ensureGit(reason?: string, interactive = true): Promise<{ ok: boolean; message?: string }> {
  if (gitOk) return { ok: true };
  const list = await programsStatus();
  const git = list.find((p) => p.id === 'git');
  if (!git || git.status === 'ok') { gitOk = !!git; return { ok: true }; }
  const p = platform();
  if (!interactive) return { ok: false, message: programHelp('git', 'Git', reason) };
  if (appleLaunched) {
    return { ok: false, message: "Git n'est pas encore installé : l'installation des outils développeur d'Apple est en cours ou n'a pas été acceptée. Termine-la, puis réessaie." };
  }
  if (p === 'windows' && !gitDeclined) {
    if (gitInstalling) return (await gitInstalling) ? { ok: true } : { ok: false, message: programHelp('git', 'Git', reason) };
    const yes = await ask('Installer Git',
      `ANZAR a besoin de Git${reason ? ` pour ${reason}` : ''} (historique du projet, panneau Git, tickets).\n\n`
      + "Il va télécharger la version portable officielle (environ 40 Mo, une seule fois) et la ranger dans ses propres fichiers. "
      + "Rien n'est installé sur le système.\n\nTélécharger maintenant ?");
    if (!yes) { gitDeclined = true; return { ok: false, message: programHelp('git', 'Git', reason) }; }
    gitInstalling = installGitNow().finally(() => { gitInstalling = null; });
    return (await gitInstalling) ? { ok: true } : { ok: false, message: programHelp('git', 'Git', reason) };
  }
  if (p === 'mac' && !gitDeclined) {
    const yes = await ask('Installer Git',
      `ANZAR a besoin de Git${reason ? ` pour ${reason}` : ''}. Sur Mac, Git fait partie des « outils développeur » d'Apple (gratuits).\n\n`
      + "macOS va te proposer de les installer : accepte, attends la fin (quelques minutes), puis réessaie.\n\nLancer l'installation ?");
    if (yes) { appleLaunched = await installAppleDevTools(); } else gitDeclined = true;
    return { ok: false, message: `Git n'est pas encore installé. ${yes ? "L'installation des outils développeur d'Apple a été lancée : l'utilisateur doit l'accepter et attendre la fin, puis réessayer." : programHelp('git', 'Git', reason)}` };
  }
  return { ok: false, message: programHelp('git', 'Git', reason) };
}

// ── Python ───────────────────────────────────────────────────────────────────

let pythonChecked: boolean | null = null;

/** Python n'est jamais installé par ANZAR : s'il manque, l'agent passe par Node.js. */
export async function checkPython(program: string): Promise<{ ok: boolean; message?: string }> {
  if (pythonChecked === null) {
    const py = (await programsStatus()).find((p) => p.id === 'python');
    pythonChecked = !py || py.status === 'ok';
  }
  if (pythonChecked) return { ok: true };
  return {
    ok: false,
    message: `« ${program} » : Python n'est pas installé sur cet ordinateur. Pour les fichiers (PDF, Excel, Word, images), `
      + 'fais la même chose avec Node.js, toujours disponible : `npm install pdf-lib` (PDF), `exceljs` (Excel), `docx` (Word), '
      + '`sharp` (images), puis un script .mjs lancé avec node. Ne demande d\'installer Python que si le projet est en Python ; '
      + `dans ce cas : ${programHelp('python', 'Python')}`,
  };
}

const PYTHON_PROGRAMS = new Set(['python', 'python3', 'pip', 'pip3']);
export const isPython = (program: string) => PYTHON_PROGRAMS.has(program.trim().toLowerCase().replace(/\.exe$/, ''));
