/** Pièces jointes envoyées au modèle : contenu borné pour maîtriser le coût. */
import type { ChatAttachment } from '@/types';

export const MAX_ATTACHMENT_CHARS = 40_000;
export const MAX_ATTACHMENTS_TOTAL_CHARS = 100_000;

/** Ajoute le contenu des pièces jointes au message envoyé au modèle. */
export function withAttachments(content: string, attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return content;
  let budget = MAX_ATTACHMENTS_TOTAL_CHARS;
  const blocks = attachments.map((a) => {
    const label = `[${a.ref}] ${a.name} (${a.kind})` + (a.projectCopy
      ? `\nCopie du fichier dans ton dossier de travail : \`${a.projectCopy}\`. Pour le transformer (découper, fusionner, `
        + `convertir, extraire des pages, redimensionner…), écris un script python ou node qui lit ce fichier et `
        + `écris les résultats dans le même dossier, sans jamais écraser l'original. Préfère Node.js, toujours disponible `
        + `avec ANZAR : installe avec npm dans le dossier de travail pdf-lib (PDF), exceljs (Excel), docx (Word) ou sharp (images), `
        + `puis lance un script .mjs avec node. Python seulement s'il est déjà installé. Donne à la fin le chemin des fichiers produits.`
      : '');
    if (a.kind === 'image') {
      return a.dataUrl
        ? `${label}\n(Image jointe : elle t'est montrée à la suite de ce message.)`
        : `${label}\n(Image jointe illisible : dis-le à l'utilisateur si sa demande en dépend.)`;
    }
    const full = (a.excerpt || '').trim();
    if (!full) return `${label}\n(Contenu illisible ou vide.)`;
    const take = Math.max(0, Math.min(full.length, MAX_ATTACHMENT_CHARS, budget));
    budget -= take;
    if (take === 0) return `${label}\n(Non inclus : limite de taille des pièces jointes atteinte.)`;
    const cut = take < full.length;
    return `${label}\n\`\`\`\n${full.slice(0, take)}\n\`\`\`${cut ? `\n(Tronqué : ${take.toLocaleString('fr-FR')} caractères sur ${full.length.toLocaleString('fr-FR')}. Préviens l'utilisateur si la suite est nécessaire.)` : ''}`;
  });
  return `${content}\n\n# Pièces jointes\n\n${blocks.join('\n\n')}`;
}
