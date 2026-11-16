/**
 * Copie des pièces jointes dans le projet ouvert.
 *
 * Joindre un fichier dans le chat en donne le TEXTE au modèle. Pour qu'ANZAR puisse aussi
 * travailler sur le fichier lui-même (découper ou fusionner un PDF, convertir un Excel,
 * redimensionner une image…), une copie est placée dans `.anzar/fichiers/` : l'agent la
 * traite ensuite avec un script python ou node. L'original de l'utilisateur n'est jamais touché.
 *
 * Le dossier contient son propre .gitignore (« * ») : ces copies ne partent jamais dans un commit.
 */
import { copyFile, createDir, exists, writeTextFile } from '@tauri-apps/api/fs';
import type { ChatAttachment } from '@/types';

export const ATTACH_DIR = '.anzar/fichiers';

const sep = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
const join = (a: string, b: string) => `${a.replace(/[/\\]+$/, '')}${sep(a)}${b}`;
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

/** Nom sûr : pas de séparateur, pas de chemin relatif, longueur bornée. */
export function safeFileName(name: string): string {
  const base = (name.split(/[/\\]/).pop() || 'fichier').replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  const cleaned = base.replace(/^\.+/, '') || 'fichier';
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, 120 - ext.length) + ext;
}

/** « rapport.pdf » → « rapport-2.pdf » si le nom est pris. */
export function withSuffix(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

/** Chemin relatif si `file` est déjà dans le projet, sinon null. */
export function insideWorkspace(workspace: string, file: string): string | null {
  const ws = norm(workspace);
  const f = norm(file);
  return f.startsWith(ws + '/') ? f.slice(ws.length + 1) : null;
}

export async function copyAttachmentsToWorkspace(
  workspace: string,
  attachments: ChatAttachment[],
): Promise<ChatAttachment[]> {
  if (!attachments.some((a) => a.sourcePath)) return attachments;
  const dir = join(workspace, ATTACH_DIR);
  let ready = false;
  const out: ChatAttachment[] = [];
  for (const a of attachments) {
    if (!a.sourcePath) { out.push(a); continue; }
    const already = insideWorkspace(workspace, a.sourcePath);
    if (already) { out.push({ ...a, projectCopy: already }); continue; }
    try {
      if (!ready) {
        if (!(await exists(dir))) await createDir(dir, { recursive: true });
        const ignore = join(dir, '.gitignore');
        if (!(await exists(ignore))) await writeTextFile(ignore, '*\n');
        ready = true;
      }
      const base = safeFileName(a.name);
      let n = 1;
      while (n < 100 && (await exists(join(dir, withSuffix(base, n))))) n++;
      const finalName = withSuffix(base, n);
      await copyFile(a.sourcePath, join(dir, finalName));
      out.push({ ...a, projectCopy: `${ATTACH_DIR}/${finalName}` });
    } catch {
      out.push(a); // copie impossible : le texte extrait reste disponible
    }
  }
  return out;
}
