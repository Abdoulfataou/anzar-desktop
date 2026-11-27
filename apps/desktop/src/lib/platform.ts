/**
 * Plateforme de l'app, lue dans le navigateur de Tauri (testable en simulant navigator,
 * voir ANZAR_TEST_PLATFORM dans src/test/setup.ts).
 *
 * Point unique pour les différences Mac / Windows (docs/desktop/PARITE-WINDOWS.md) :
 * ajoute ici une capacité plutôt qu'un nouveau test de navigator ailleurs.
 */
function platformText(): string {
  if (typeof navigator === 'undefined') return '';
  return `${navigator.platform || ''} ${navigator.userAgent || ''}`;
}

export function isMacPlatform(): boolean {
  return /Mac|Darwin/i.test(platformText());
}

export function isWindowsPlatform(): boolean {
  return !isMacPlatform() && /Win/i.test(platformText());
}

/**
 * Shell des commandes de l'agent : bash (confiné par Seatbelt) sur macOS, PowerShell
 * sous Windows. null ailleurs (Linux n'est pas distribué) : seul run_command existe.
 */
export function commandShell(): 'bash' | 'powershell' | null {
  if (isMacPlatform()) return 'bash';
  if (isWindowsPlatform()) return 'powershell';
  return null;
}
