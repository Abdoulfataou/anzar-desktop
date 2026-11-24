import { LignePanier, totalPanier } from './panier';

export function resumeCommande(lignes: LignePanier[]): string {
  return `${lignes.length} article(s) — ${totalPanier(lignes)} FCFA`;
}
