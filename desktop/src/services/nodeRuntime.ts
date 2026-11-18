/**
 * Node.js pour les outils de l'agent (navigateur intégré, captures, vidéos, vérification du code,
 * connecteurs, commandes npm / npx / node).
 *
 * Si Node manque ou est trop ancien, ANZAR propose de le télécharger UNE fois (version LTS
 * officielle, empreinte vérifiée, rangée dans les fichiers d'ANZAR : rien d'installé sur le
 * système, aucun mot de passe). Si l'utilisateur refuse ou si le téléchargement échoue, le
 * message d'erreur explique quoi faire, avec la commande à copier pour son système.
 */
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';

export interface NodeStatus { active: string | null; source: 'system' | 'managed' | 'none'; system: string | null; managed: string | null; min_major: number }

const NODE_PROGRAMS = new Set(['node', 'npm', 'npx']);
export const needsNode = (program: string) => NODE_PROGRAMS.has(program.trim().split(/[\s/\\]+/).pop()!.toLowerCase().replace(/\.(cmd|exe)$/, ''));

let declinedThisSession = false;
let installing: Promise<{ ok: boolean; version?: string; error?: string }> | null = null;

export async function nodeStatus(): Promise<NodeStatus | null> {
  try { return await invoke<NodeStatus>('node_status'); } catch { return null; }
}

function platform(): 'mac' | 'windows' | 'linux' {
  const p = navigator.platform.toLowerCase();
  return p.includes('win') ? 'windows' : p.includes('mac') ? 'mac' : 'linux';
}

/** Explication + commande prête à copier, pour l'utilisateur (relayée par l'agent). */
export function manualNodeHelp(reason?: string): string {
  const intro = `Node.js est nécessaire${reason ? ` pour ${reason}` : ''}, et il n'est pas disponible sur cet ordinateur.`;
  const how = {
    mac: "Sur Mac : télécharge l'installeur sur https://nodejs.org (bouton « LTS »), ouvre-le et suis les étapes. "
      + "Si Homebrew est installé, cette commande dans le Terminal fait la même chose :\n```\nbrew install node\n```",
    windows: "Sur Windows : télécharge l'installeur sur https://nodejs.org (bouton « LTS »), ou tape cette commande dans PowerShell :\n```\nwinget install OpenJS.NodeJS.LTS\n```",
    linux: "Sous Linux : installe la version LTS avec le gestionnaire de paquets de ta distribution, ou avec nvm (https://github.com/nvm-sh/nvm).",
  }[platform()];
  return `${intro} ANZAR peut le télécharger lui-même (environ 60 Mo, une seule fois) : relance la demande et accepte. `
    + `Sinon, installe-le toi-même. ${how}\nEnsuite, ferme et rouvre ANZAR.\n`
    + "(Pour l'agent : explique cela simplement à l'utilisateur, avec la commande ci-dessus, sans jargon.)";
}

async function confirmDownload(reason?: string): Promise<boolean> {
  try {
    const { ask } = await import('@/lib/tauriDialog');
    return await ask(
      `ANZAR a besoin de Node.js${reason ? ` pour ${reason}` : ''}.\n\n`
      + "Il va le télécharger depuis le site officiel (environ 60 Mo, une seule fois) et le ranger dans ses propres fichiers. "
      + "Rien n'est installé sur le système et aucun mot de passe n'est demandé.\n\nTélécharger maintenant ?",
      { title: 'Installer Node.js', kind: 'info' },
    );
  } catch {
    return false;
  }
}

export async function installNodeNow(): Promise<{ ok: boolean; version?: string; error?: string }> {
  return install();
}

async function install(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const { listen } = await import('@tauri-apps/api/event');
  const id = toast.loading('Téléchargement de Node.js…');
  const stop = await listen<{ received: number; total: number | null; step: string }>('node://progress', (e) => {
    const { received, total, step } = e.payload;
    const mo = (n: number) => `${Math.round(n / 1048576)} Mo`;
    const text = step === 'download' || step === 'verify'
      ? `Téléchargement de Node.js… ${mo(received)}${total ? ` / ${mo(total)}` : ''}`
      : step === 'extract' ? 'Installation de Node.js…' : 'Préparation de Node.js…';
    toast.loading(text, { id });
  });
  try {
    const version = await invoke<string>('node_install');
    toast.success(`Node.js ${version} est prêt.`, { id });
    return { ok: true, version };
  } catch (e: any) {
    toast.error(`Node.js n'a pas pu être téléchargé : ${String(e?.message || e)}`, { id, duration: 8000 });
    return { ok: false, error: String(e?.message || e) };
  } finally {
    stop();
  }
}

/**
 * S'assure que Node est disponible. `interactive` : on peut demander à l'utilisateur
 * (faux pour les automatisations et les tickets, sans personne devant l'écran).
 */
export async function ensureNode(opts: { reason?: string; interactive?: boolean } = {}): Promise<{ ok: boolean; message?: string }> {
  const st = await nodeStatus();
  if (!st || st.active) return { ok: true }; // statut inconnu (hors app) : on laisse la commande essayer
  if (installing) {
    const r = await installing;
    return r.ok ? { ok: true } : { ok: false, message: manualNodeHelp(opts.reason) };
  }
  if (opts.interactive === false || declinedThisSession) return { ok: false, message: manualNodeHelp(opts.reason) };
  if (!(await confirmDownload(opts.reason))) {
    declinedThisSession = true;
    return { ok: false, message: manualNodeHelp(opts.reason) };
  }
  installing = install().finally(() => { installing = null; });
  const r = await installing;
  return r.ok ? { ok: true } : { ok: false, message: `${manualNodeHelp(opts.reason)}\n(Détail : ${r.error})` };
}
