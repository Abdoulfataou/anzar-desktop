import { resumeCommande } from './commandes';
import type { LignePanier } from './panier';

const lignes: LignePanier[] = [
  { nom: 'Cahier', prix: 500, quantite: 2 },
  { nom: 'Stylo', prix: 250, quantite: 1 },
];

console.log(resumeCommande(lignes));
