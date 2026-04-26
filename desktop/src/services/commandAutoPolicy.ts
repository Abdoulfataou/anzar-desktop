import { assessCommandRisk } from '@/services/commandRisk'
import type { Settings } from '@/stores/settingsStore'

/**
 * Règles grand public pour auto-run.
 * - En mode auto_run: on autorise automatiquement une allowlist stricte (install + verify)
 * - Toujours refuser les commandes dangereuses, même si elles matchent par erreur.
 */
export function shouldAutoRunCommand(command: string, settings: Settings): { ok: boolean; reason: string } {
  const mode = settings.commandExecutionMode || 'manual'
  if (mode !== 'auto_run') return { ok: false, reason: 'mode' }

  const cmd = (command || '').trim()
  if (!cmd) return { ok: false, reason: 'empty' }

  const risk = assessCommandRisk(cmd)
  if (risk.level === 'danger') return { ok: false, reason: 'danger' }

  // Allowlist stricte (projet): install + verify
  if (!isAllowlistedForAutoRun(cmd)) {
    return { ok: false, reason: 'not_allowlisted' }
  }

  // For warning-level commands, allow if in allowlist; safe always ok.
  return { ok: true, reason: 'allowlisted' }
}

export function isAllowlistedForAutoRun(command: string): boolean {
  const cmd = (command || '').trim()
  if (!cmd) return false
  const allow: RegExp[] = [
    // Node installs
    /^npm\s+(ci|install)\b/i,
    /^pnpm\s+install\b/i,
    /^yarn\s+install\b/i,

    // Node verify
    /^npm\s+test\b/i,
    /^npm\s+run\s+build\b/i,
    /^npm\s+run\s+lint\b/i,
    /^pnpm\s+test\b/i,
    /^pnpm\s+run\s+build\b/i,
    /^pnpm\s+run\s+lint\b/i,
    /^yarn\s+test\b/i,
    /^yarn\s+build\b/i,
    /^yarn\s+lint\b/i,

    // Python
    /^python3?\s+-m\s+pip\s+install\b/i,
    /^pip3?\s+install\s+-r\s+requirements\.txt\b/i,
    /^pytest\b/i,

    // Rust
    /^cargo\s+build\b/i,
    /^cargo\s+test\b/i,

    // Git read-only
    /^git\s+status\b/i,
    /^git\s+diff\b/i,
  ]
  return allow.some((re) => re.test(cmd))
}
