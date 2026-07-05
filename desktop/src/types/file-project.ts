/**
 * FileNode — Représentation d'un fichier/dossier dans l'arbre du projet.
 * Utilisé par fileSystemService pour la navigation et l'affichage.
 */
export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  extension?: string;
  size?: number;
  lastModified?: string;
  children?: FileNode[];
  content?: string;
}
