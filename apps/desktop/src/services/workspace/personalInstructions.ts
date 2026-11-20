/**
 * Instructions personnelles : un texte libre ajouté à chaque tâche (équivalent du
 * AGENTS.md global de ZCode). Stocké dans instructions.md du dossier de données.
 */
import { readText, writeText } from '@/lib/fileStore';

const FILE = 'instructions.md';
const LS_KEY = 'anzar.personalInstructions';
export const MAX_INSTRUCTIONS_CHARS = 4000;

export async function loadPersonalInstructions(): Promise<string> {
  try {
    const text = await readText(FILE);
    if (text != null) return text;
  } catch { /* disque indisponible */ }
  try { return localStorage.getItem(LS_KEY) || ''; } catch { return ''; }
}

export async function savePersonalInstructions(text: string): Promise<void> {
  const value = text.slice(0, MAX_INSTRUCTIONS_CHARS);
  try {
    await writeText(FILE, value);
  } catch {
    localStorage.setItem(LS_KEY, value); // navigateur / disque indisponible
  }
}

/** Section ajoutée au prompt système (vide si aucune instruction). */
export function personalInstructionsSection(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return `\n\n## Instructions personnelles de l'utilisateur\nÀ respecter dans toutes ses tâches, sauf si sa demande dit autre chose :\n${t.slice(0, MAX_INSTRUCTIONS_CHARS)}`;
}
