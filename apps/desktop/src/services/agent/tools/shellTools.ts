/**
 * Outils de commandes : run_command (pré-contrôle) et install_tool.
 */
import { terminalService } from '@/services/runtime/terminal';
import { toolsCatalog, toolInstall, confirmToolInstall } from '@/services/runtime/toolsRuntime';
import { isKnownProgram, isValidProgramName, parseExecutable, programBase, ruleRefusal, validateCommand } from '../policy/commandPolicy';
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT_CHARS, resolvePath, truncate } from './shared';
import { ToolExecutionContext, ToolResult } from './types';

const READ_INSTEAD: Record<string, string> = {
  grep: 'search_files', rg: 'search_files', find: 'search_files ou list_dir', ls: 'list_dir', tree: 'list_dir',
  cat: 'read_file', head: 'read_file', tail: 'read_file', less: 'read_file', wc: 'read_file',
};

/**
 * Refuse tôt, avec une consigne utile, ce que le terminal bloquerait de toute façon :
 * l'agent comprend quoi faire à la place au lieu de réessayer la même erreur.
 */
export function precheckCommand(command: string): string | null {
  const cmd = String(command || '').trim();
  const validation = validateCommand(cmd);
  if (!validation.safe) return validation.reason || 'Commande refusée.';
  const exe = programBase(cmd.split(/\s+/)[0] || '');
  const alt = READ_INSTEAD[exe];
  if (alt && !isKnownProgram(exe)) return `Refusé : « ${exe} » n'est pas disponible. Utilise l'outil ${alt}.`;
  const parsed = parseExecutable(cmd);
  if (!parsed) {
    return ruleRefusal(exe, [])
      || (isValidProgramName(exe) ? 'Refusé : trop d\'arguments.' : `Refusé : « ${exe} » n'est pas un nom de programme valide.`);
  }
  // Sous-commande refusée, lanceur vers un programme interdit (mêmes règles que Rust).
  // Un programme hors liste n'est PAS refusé ici : l'utilisateur donne son accord sur la carte.
  return ruleRefusal(exe, parsed.args);
}

export async function execRunCommand(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const refused = precheckCommand(args.command);
  if (refused) {
    // Refus : la commande n'a pas tourné. Le texte doit dire quoi faire à la place,
    // sinon le modèle réessaie une variante au lieu de changer d'approche.
    return { output: `La commande n'a pas été exécutée.\n${refused}`, isError: true };
  }
  const cwd = await resolvePath(ctx.projectRoot, args.cwd);
  const result = await terminalService.exec(args.command, {
    cwd,
    timeout: COMMAND_TIMEOUT_MS,
    silent: false,
    signal: ctx.signal,
  });

  // Refus de politique, outil introuvable, isolation ou lancement impossible : l'action
  // n'a pas eu lieu. C'est une erreur d'outil, pas un échec de la commande.
  if (result.ran === false) {
    return {
      output: `La commande n'a pas été exécutée (refus ou lancement impossible).\n${result.stderr || '(sans détail)'}`,
      isError: true,
    };
  }

  const parts = [
    `exit_code: ${result.exitCode} (${result.durationMs}ms)`,
    result.timedOut ? `[délai dépassé] la commande a été arrêtée après ${Math.round(COMMAND_TIMEOUT_MS / 1000)} s ; découpe-la ou utilise bash avec un timeout plus long.` : '',
    result.stdout ? `stdout:\n${truncate(result.stdout, MAX_COMMAND_OUTPUT_CHARS, 'stdout')}` : '',
    result.stderr ? `[stderr]\n${truncate(result.stderr, MAX_COMMAND_OUTPUT_CHARS, 'stderr')}` : '',
  ].filter(Boolean);

  // Un code non nul est un fait à lire, pas une panne d'outil : le modèle décide s'il
  // corrige, relance ou explique. Seul un refus de l'isolation reste une erreur d'action.
  return { output: parts.join('\n\n'), isError: result.denied === true };
}

export async function execInstallTool(args: Record<string, any>): Promise<ToolResult> {
  const catalog = await toolsCatalog();
  const info = catalog.find((t) => t.name === String(args.tool || ''));
  if (!info) {
    return { output: `Outil inconnu. Catalogue : ${catalog.map((t) => t.name).join(', ') || 'vide'}.`, isError: true };
  }
  if (info.installed) return { output: `${info.name} ${info.version} est déjà installé : utilisable directement dans run_command.` };
  if (!info.available) return { output: `${info.name} n'est pas disponible sur cette plateforme.`, isError: true };

  // Accord explicite de l'utilisateur — jamais d'installation silencieuse
  const ok = await confirmToolInstall(info);
  if (!ok) {
    return { output: "L'utilisateur a refusé l'installation. Ne réessaie pas dans cette tâche ; propose une alternative sans cet outil." };
  }
  const r = await toolInstall(info.name);
  if (!r.ok) return { output: `Échec de l'installation de ${info.name} : ${r.error}`, isError: true };
  return { output: `${info.name} ${r.version} installé et vérifié. La commande est maintenant disponible dans run_command (le PATH de l'app est à jour).` };
}
