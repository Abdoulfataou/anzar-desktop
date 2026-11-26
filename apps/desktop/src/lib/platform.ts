/** Plateforme de l'app, lue dans le navigateur de Tauri (testable en simulant navigator). */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Win/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`);
}
