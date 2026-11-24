export interface LignePanier {
  nom: string;
  prix: number;
  quantite: number;
}

export function totalPanier(lignes: LignePanier[]): number {
  return lignes.reduce((n, l) => n + l.prix * l.quantite, 0);
}
