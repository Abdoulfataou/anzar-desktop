/**
 * Adaptateur Tauri 2 pour le système de fichiers.
 *
 * Le code ANZAR utilise l'API Tauri 1 (`readDir` avec `children`, `createDir`,
 * `removeFile`, `readBinaryFile`…). Tauri 2 renomme plusieurs commandes et
 * change la forme de `readDir`. On centralise ici la traduction pour que les
 * services métier n'aient pas à connaître la version du runtime.
 */
import {
  copyFile as fsCopyFile,
  exists as fsExists,
  mkdir,
  readDir as fsReadDir,
  readFile as fsReadFile,
  readTextFile as fsReadTextFile,
  remove,
  rename,
  writeFile as fsWriteFile,
  writeTextFile as fsWriteTextFile,
} from '@tauri-apps/plugin-fs';

/** Entrée compatible avec l'ancien `FileEntry` de Tauri 1. */
export interface FileEntry {
  name: string;
  path: string;
  /** Présent uniquement pour un dossier (même vide), comme en Tauri 1. */
  children?: FileEntry[];
}

const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}/${name}`;

export async function readDir(
  dir: string,
  options: { recursive?: boolean } = {},
): Promise<FileEntry[]> {
  const entries = await fsReadDir(dir);
  const result: FileEntry[] = entries.map((entry) => ({
    name: entry.name,
    path: joinPath(dir, entry.name),
    ...(entry.isDirectory ? { children: [] } : {}),
  }));

  if (options.recursive) {
    for (const entry of result) {
      if (entry.children) entry.children = await readDir(entry.path, { recursive: true });
    }
  }
  return result;
}

export const readTextFile = fsReadTextFile;
export const readBinaryFile = fsReadFile;
export const exists = fsExists;

export async function writeTextFile(
  path: string,
  data: string,
  options?: Parameters<typeof fsWriteTextFile>[2],
): Promise<void> {
  await fsWriteTextFile(path, data, options);
}

export async function writeBinaryFile(
  path: string,
  data: Uint8Array | number[],
  options?: Parameters<typeof fsWriteFile>[2],
): Promise<void> {
  await fsWriteFile(path, data instanceof Uint8Array ? data : new Uint8Array(data), options);
}

export async function createDir(
  path: string,
  options: { recursive?: boolean } = {},
): Promise<void> {
  await mkdir(path, { recursive: options.recursive });
}

export async function removeFile(path: string): Promise<void> {
  await remove(path);
}

export async function removeDir(
  path: string,
  options: { recursive?: boolean } = {},
): Promise<void> {
  await remove(path, { recursive: options.recursive ?? true });
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath);
}

export async function copyFile(fromPath: string, toPath: string): Promise<void> {
  await fsCopyFile(fromPath, toPath);
}
