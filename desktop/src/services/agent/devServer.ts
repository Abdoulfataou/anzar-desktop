/**
 * Serveur de développement du projet, lancé en arrière-plan par l'agent pour vérifier
 * son travail dans le navigateur. Visible dans l'onglet Terminal ; l'adresse détectée
 * ouvre aussi l'onglet Aperçu. Un serveur par projet.
 */
import { terminalService } from '@/services/terminal';
import { fileSystemService } from '@/services/filesystem/fileSystem';

interface DevServer {
  processId: string;
  command: string;
  url?: string;
  lines: string[];
  exitCode?: number | null;
  unsubscribe: () => void;
}

const servers = new Map<string, DevServer>();
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d+[^\s'"]*/;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const MAX_LINES = 300;

/** Remplaçable pour les tests. */
export const hooks = {
  terminal: terminalService as Pick<typeof terminalService, 'runCommand' | 'onEvent' | 'killProcess'>,
  readFile: (p: string) => fileSystemService.readFile(p),
  exists: (p: string) => fileSystemService.exists(p),
  waitMs: 60_000,
};

/** Commande de lancement devinée à partir du projet (package.json, Django…). */
export async function detectDevCommand(root: string): Promise<string | null> {
  const base = root.replace(/[\\/]+$/, '');
  const pkgText = await hooks.readFile(`${base}/package.json`).catch(() => null);
  if (pkgText) {
    try {
      const scripts = JSON.parse(pkgText).scripts || {};
      for (const name of ['dev', 'start', 'serve', 'preview']) {
        if (typeof scripts[name] === 'string') return name === 'start' ? 'npm start' : `npm run ${name}`;
      }
    } catch { /* package.json illisible */ }
  }
  if (await hooks.exists(`${base}/manage.py`).catch(() => false)) return 'python manage.py runserver';
  return null;
}

function tail(s: DevServer, n: number): string {
  return s.lines.slice(-n).join('\n') || '(aucune sortie)';
}

function running(s: DevServer | undefined): boolean {
  return !!s && s.exitCode === undefined;
}

/** Lance le serveur (ou rend celui qui tourne déjà) et attend son adresse. */
export async function startDevServer(root: string, command?: string): Promise<{ output: string; isError: boolean; url?: string }> {
  const existing = servers.get(root);
  if (existing && running(existing) && (!command || command === existing.command)) {
    return { output: `Serveur déjà lancé (${existing.command})${existing.url ? ` : ${existing.url}` : ''}.\nDernières lignes :\n${tail(existing, 10)}`, isError: false, url: existing.url };
  }
  if (running(existing)) await stopDevServer(root);

  const cmd = (command || (await detectDevCommand(root)) || '').trim();
  if (!cmd) {
    return { output: "Impossible de deviner la commande de lancement (pas de script dev/start dans package.json). Indique-la dans command, par exemple « npm run dev ».", isError: true };
  }

  const server: DevServer = { processId: '', command: cmd, lines: [], unsubscribe: () => {} };
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => { resolveReady = r; });

  server.unsubscribe = hooks.terminal.onEvent((e) => {
    if (!server.processId) return;
    if (e.type === 'output' && e.processId === server.processId) {
      const line = e.data.content.replace(ANSI_RE, '');
      server.lines.push(line);
      if (server.lines.length > MAX_LINES) server.lines.splice(0, server.lines.length - MAX_LINES);
      const m = !server.url && URL_RE.exec(line);
      if (m) { server.url = m[0].replace('0.0.0.0', 'localhost').replace(/[).,;]+$/, ''); resolveReady(); }
    } else if ((e.type === 'process-end' || e.type === 'process-error') && e.processId === server.processId) {
      server.exitCode = e.type === 'process-end' ? e.exitCode : 1;
      if (e.type === 'process-error') server.lines.push(e.error);
      resolveReady();
    }
  });
  servers.set(root, server);
  await hooks.terminal.runCommand(cmd, { cwd: root, onProcessId: (id) => { server.processId = id; } });

  await Promise.race([ready, new Promise((r) => setTimeout(r, hooks.waitMs))]);

  if (server.exitCode !== undefined) {
    server.unsubscribe();
    return { output: `Le serveur s'est arrêté (code ${server.exitCode}) au démarrage. Sortie :\n${tail(server, 40)}`, isError: true };
  }
  if (!server.url) {
    return { output: `Serveur lancé (${cmd}), mais aucune adresse http://localhost:… détectée en ${Math.round(hooks.waitMs / 1000)} s. Sortie :\n${tail(server, 25)}\nSi tu connais le port, utilise check_page avec l'adresse complète.`, isError: false };
  }
  return { output: `Serveur lancé (${cmd}) : ${server.url}\nVérifie maintenant la page avec check_page.\nDernières lignes :\n${tail(server, 8)}`, isError: false, url: server.url };
}

export function devServerUrl(root: string): string | undefined {
  const s = servers.get(root);
  return s && running(s) ? s.url : undefined;
}

/** Dernières lignes du serveur : erreurs de compilation, requêtes reçues… */
export function devServerLogs(root: string, lines = 60): { output: string; isError: boolean } {
  const s = servers.get(root);
  if (!s) return { output: "Aucun serveur lancé par l'agent pour ce projet. Utilise start_dev_server.", isError: true };
  const state = running(s) ? `en marche${s.url ? ` sur ${s.url}` : ''}` : `arrêté (code ${s.exitCode})`;
  return { output: `Serveur ${state} — ${s.command}\n${tail(s, Math.min(Math.max(lines, 10), 200))}`, isError: false };
}

export async function stopDevServer(root: string): Promise<{ output: string; isError: boolean }> {
  const s = servers.get(root);
  servers.delete(root);
  if (!s) return { output: 'Aucun serveur à arrêter.', isError: false };
  s.unsubscribe();
  if (running(s) && s.processId) await hooks.terminal.killProcess(s.processId).catch(() => false);
  return { output: `Serveur arrêté (${s.command}).`, isError: false };
}
