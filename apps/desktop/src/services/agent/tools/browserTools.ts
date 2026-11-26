/**
 * Outils web locaux : serveur de développement, vérification et capture de pages, actions.
 */
import { resolvePath } from './shared';
import { ToolExecutionContext, ToolResult } from './types';
import { unconfinedCommandRefusal } from '../policy/isolation';

// ── Vérification web : serveur de développement et navigateur intégré ──
export async function execStartDevServer(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const unconfined = unconfinedCommandRefusal(ctx.permissionMode, false, 'start_dev_server');
  if (unconfined) return { output: unconfined, isError: true };
  const { startDevServer } = await import('./devServer');
  const command = typeof args.command === 'string' && args.command.trim() ? args.command.trim() : undefined;
  const r = await startDevServer(ctx.projectRoot, command);
  return { output: r.output, isError: r.isError };
}

export async function execDevServerLogs(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const { devServerLogs } = await import('./devServer');
  return devServerLogs(ctx.projectRoot, Number(args.lines) || 60);
}

export async function execStopDevServer(_args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const { stopDevServer } = await import('./devServer');
  return stopDevServer(ctx.projectRoot);
}

export async function execCheckPage(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const [{ checkPage }, { devServerUrl }] = await Promise.all([import('./browserCheck'), import('./devServer')]);
  const url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : devServerUrl(ctx.projectRoot);
  if (!url) return { output: "Indique url, ou lance d'abord le serveur du projet avec start_dev_server.", isError: true };
  return checkPage(url, { waitForText: args.wait_for_text, signal: ctx.signal });
}

export async function execCapturePage(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const [{ capturePage }, { devServerUrl }, { captureWithRenderer }] = await Promise.all([
    import('./browserCheck'), import('./devServer'), import('@/services/motion/captures'),
  ]);
  const file = typeof args.file === 'string' && args.file.trim() ? await resolvePath(ctx.projectRoot, args.file) : undefined;
  const url = file ? undefined : typeof args.url === 'string' && args.url.trim() ? args.url.trim() : devServerUrl(ctx.projectRoot) || undefined;
  if (file || url) {
    const viaRenderer = await captureWithRenderer({
      url, file, root: ctx.projectRoot,
      viewports: Array.isArray(args.viewports) ? args.viewports : undefined,
      frames: Array.isArray(args.frames) ? args.frames.map(Number) : undefined,
      fullPage: !!args.full_page,
      signal: ctx.signal,
    });
    if (viaRenderer) return viaRenderer;
  }
  return capturePage({
    url,
    viewports: Array.isArray(args.viewports) ? args.viewports : undefined,
    frames: Array.isArray(args.frames) ? args.frames.map(Number) : undefined,
    fullPage: !!args.full_page,
    signal: ctx.signal,
  });
}

export async function execPageAction(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const { pageAction } = await import('./browserCheck');
  return pageAction(args, ctx.signal);
}
