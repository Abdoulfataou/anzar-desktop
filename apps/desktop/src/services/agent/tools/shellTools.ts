/**
 * Outils de commandes : run_command (pré-contrôle) et install_tool.
 */
import { terminalService } from '@/services/runtime/terminal';
import { toolsCatalog, toolInstall, confirmToolInstall } from '@/services/runtime/toolsRuntime';
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT_CHARS, resolvePath, truncate } from './shared';
import { ToolExecutionContext, ToolResult } from './types';
import { unconfinedCommandRefusal } from '../policy/isolation';

export async function execRunCommand(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  // Windows : pas d'isolation, donc pas de lancement silencieux hors Accès complet.
  const unconfined = unconfinedCommandRefusal(ctx.permissionMode, ctx.escalated === true);
  if (unconfined) return { output: unconfined, isError: true };
  const cwd = await resolvePath(ctx.projectRoot, args.cwd);
  const result = await terminalService.exec(args.command, {
    cwd,
    timeout: COMMAND_TIMEOUT_MS,
    silent: false,
    signal: ctx.signal,
    escalated: ctx.escalated === true,
    escalationReason: String(args.justification || ''),
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
  return {
    output: parts.join('\n\n'),
    isError: result.denied === true,
    failed: result.exitCode !== 0,
  };
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
