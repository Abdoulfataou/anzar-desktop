/**
 * Contenance de chemins PAR SEGMENTS (et non par préfixe de chaîne).
 *
 * startsWith('/Users/x/pro') acceptait '/Users/x/pro-evil' — un dossier
 * voisin partageant le préfixe. On compare segment par segment.
 */
export function isPathWithin(child: string, parent: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const c = norm(child).split('/');
  const p = norm(parent).split('/');
  if (p.length > c.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== c[i]) return false;
  }
  return true;
}
