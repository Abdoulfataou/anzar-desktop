/**
 * Types partagés du workspace (extraits de VibeCodingStudio avant suppression).
 */
export interface StudioFile {
  path: string;
  content: string;
  language: string;
  status: 'pending' | 'generating' | 'done' | 'modified';
  /** Contenu avant la dernière itération (pour la vue diff) */
  previousContent?: string;
  /** Contenu lu depuis le disque (la liste est chargée sans les contenus) */
  loaded?: boolean;
}
