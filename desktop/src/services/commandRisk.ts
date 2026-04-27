export type CommandRiskLevel = 'safe' | 'warning' | 'danger'

export type CommandRisk = {
  level: CommandRiskLevel
  reason: string
}

/**
 * Heuristique simple (grand public) — ne remplace pas un sandbox.
 * Objectif: avertir / demander confirmation avant exécution.
 */
export function assessCommandRisk(command: string): CommandRisk {
  const cmd = (command || '').trim().toLowerCase()
  if (!cmd) return { level: 'safe', reason: 'Commande vide' }

  // Very dangerous patterns
  const dangerPatterns: Array<[RegExp, string]> = [
    // Destructif (suppression)
    [/\brm\s+-rf\b/, 'Suppression récursive forcée (rm -rf)'],
    [/\bmkfs\b|\bformat\b/, 'Formatage disque'],
    [/\bdd\s+if=|\bdd\s+of=/, 'Écriture brute (dd)'],
    [/\bshutdown\b|\breboot\b|\bpoweroff\b/, 'Arrêt / redémarrage machine'],
    [/\b(useradd|usermod|groupadd|passwd)\b/, 'Modification des comptes système'],
    [/\bsudo\b/, 'Exécution en privilèges élevés (sudo)'],
    [/\bcurl\b.*\|\s*(sh|bash)\b/, 'Téléchargement + exécution (curl | bash)'],
    [/\bwget\b.*\|\s*(sh|bash)\b/, 'Téléchargement + exécution (wget | bash)'],
    [/\bpowershell\b.*(iex|invoke-expression)\b/, 'Téléchargement + exécution (PowerShell IEX)'],
    [/:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'Fork bomb'],
    [/\bchmod\s+777\b/, 'Permissions très permissives (chmod 777)'],
    // Git destructif
    [/\bgit\s+reset\s+--hard\b/, 'Reset Git destructif (reset --hard)'],
    [/\bgit\s+clean\s+-fd\b/, 'Nettoyage Git destructif (clean -fd)'],
  ]
  for (const [re, reason] of dangerPatterns) {
    if (re.test(cmd)) return { level: 'danger', reason }
  }

  // Potentially risky patterns
  const warnPatterns: Array<[RegExp, string]> = [
    [/\bnpm\s+install\s+-g\b|\byarn\s+global\b|\bpnpm\s+add\s+-g\b/, 'Installation globale'],
    [/\bpip\s+install\s+--user\b|\bpip\s+install\b/, 'Installation de packages'],
    [/\bnpm\s+run\s+build\b|\bnpm\s+run\s+test\b|\bpytest\b|\bcargo\s+test\b/, 'Commande de build/test (peut être longue)'],
  ]
  for (const [re, reason] of warnPatterns) {
    if (re.test(cmd)) return { level: 'warning', reason }
  }

  return { level: 'safe', reason: 'Commande considérée comme sûre' }
}
