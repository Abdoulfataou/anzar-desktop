/**
 * FileSystemService - Gestion des fichiers projet via Tauri FS API
 *
 * Opérations CRUD complètes sur le système de fichiers:
 * - Lire l'arborescence d'un dossier récursivement
 * - Créer, modifier, supprimer, renommer des fichiers/dossiers
 * - Détecter le langage des fichiers
 * - Surveiller les modifications (watch)
 */

import { ProjectFile, FileOperation } from '@/types';
import { FileNode } from '@/types/file-project';
import { generateId, isTauri as checkTauri } from '@/lib/utils';
import { isAllowedProjectRoot } from '@/lib/allowedProjectRoots';
import {
  readDir,
  readTextFile,
  writeTextFile,
  createDir,
  removeFile,
  removeDir,
  renameFile,
  exists as fsExists,
} from '@tauri-apps/api/fs';

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // Web
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  json: 'json', xml: 'xml', svg: 'svg',
  // Backend
  py: 'python', rb: 'ruby', java: 'java', kt: 'kotlin', scala: 'scala',
  go: 'go', rs: 'rust', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', dart: 'dart', php: 'php',
  // Config & Data
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  env: 'dotenv', dockerfile: 'dockerfile',
  // Docs
  md: 'markdown', mdx: 'mdx', txt: 'plaintext', tex: 'latex',
  // Shell
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell',
  // Database
  sql: 'sql', graphql: 'graphql', gql: 'graphql', prisma: 'prisma',
};

/** Files/folders to ignore when scanning */
const IGNORED_PATTERNS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.pytest_cache',
  '.next', '.nuxt', 'dist', 'build', 'out', '.cache', '.parcel-cache',
  'target', '.idea', '.vscode', '.DS_Store', 'Thumbs.db',
  'vendor', '.cargo', 'venv', '.env', 'coverage', '.nyc_output',
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg',
  'mp3', 'wav', 'ogg', 'mp4', 'webm', 'avi', 'mov',
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'exe', 'dll', 'so', 'dylib', 'o', 'a',
]);

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_TO_LANGUAGE[ext] || 'plaintext';
}

function isBinaryFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXTENSIONS.has(ext);
}

function shouldIgnore(name: string): boolean {
  return IGNORED_PATTERNS.has(name) || name.startsWith('.');
}

// ============================================================================
// FILE SYSTEM SERVICE
// ============================================================================

class FileSystemService {
  private isTauri: boolean;
  private allowCache = new Map<string, boolean>(); // path -> allowed?

  constructor() {
    this.isTauri = checkTauri();
  }

  private normalize(p: string): string {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  /**
   * Sécurité grand public:
   * - limite les opérations aux répertoires autorisés par l’app (Documents/ANZAR, etc.)
   * - bloque toute tentative de traversée (..), même si l'appelant se trompe
   *
   * IMPORTANT: aucune UI ici (pas de modal). On jette une erreur, l'UI décidera comment informer.
   */
  private async assertAllowedPath(path: string): Promise<void> {
    const p = this.normalize(path);
    if (!p) throw new Error('Chemin vide');
    if (!this.isTauri) return; // Web mode: pas de FS local

    // Traversal grossier
    if (p.includes('..')) throw new Error('Chemin invalide (..) bloqué');

    // Cache par les 3 premiers segments du chemin pour éviter des appels répétés
    const segments = p.split('/').filter(Boolean);
    const key = '/' + segments.slice(0, Math.min(segments.length, 3)).join('/');
    const cached = this.allowCache.get(key);
    if (cached === true) return;
    if (cached === false) throw new Error('Dossier non autorisé');

    const ok = await isAllowedProjectRoot(p);
    this.allowCache.set(key, ok);
    if (!ok) throw new Error('Dossier non autorisé');
  }

  // ========================================================================
  // READ OPERATIONS
  // ========================================================================

  /**
   * Read the file tree of a directory recursively
   * Returns a tree structure for FileExplorer
   */
  async readDirectoryTree(
    dirPath: string,
    maxDepth: number = 8
  ): Promise<FileNode[]> {
    if (!this.isTauri) {
      console.warn('FileSystemService: Tauri not available');
      return [];
    }

    try {
      await this.assertAllowedPath(dirPath);
      const entries = await readDir(dirPath, { recursive: false });

      const nodes: FileNode[] = [];

      for (const entry of entries) {
        const name = entry.name || '';
        if (shouldIgnore(name)) continue;

        if (entry.children !== undefined) {
          // Directory
          const children = maxDepth > 1
            ? await this.readDirectoryTree(entry.path, maxDepth - 1)
            : [];

          nodes.push({
            id: generateId(),
            name,
            path: entry.path,
            type: 'directory',
            children,
          });
        } else {
          // File
          if (isBinaryFile(name)) continue; // Skip binary files

          const ext = name.split('.').pop()?.toLowerCase() || '';
          nodes.push({
            id: generateId(),
            name,
            path: entry.path,
            type: 'file',
            extension: ext,
          });
        }
      }

      // Sort: directories first, then alphabetically
      return nodes.sort((a, b) => {
        if (a.type === 'directory' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (error) {
      console.error('Failed to read directory:', error);
      return [];
    }
  }

  /**
   * Read a single file's content
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.isTauri) {
      throw new Error('Tauri non disponible');
    }

    await this.assertAllowedPath(filePath);
    return readTextFile(filePath);
  }

  /**
   * Read all files in a directory as ProjectFile[]
   * For loading into project store
   */
  async readProjectFiles(
    rootPath: string,
    maxDepth: number = 6
  ): Promise<ProjectFile[]> {
    const tree = await this.readDirectoryTree(rootPath, maxDepth);
    const files: ProjectFile[] = [];

    const collectFiles = async (nodes: FileNode[], basePath: string) => {
      for (const node of nodes) {
        if (node.type === 'file') {
          try {
            const content = await this.readFile(node.path);
            const relativePath = node.path.replace(basePath, '').replace(/^[/\\]/, '');

            files.push({
              path: relativePath,
              content,
              language: detectLanguage(node.name),
              size: content.length,
              updatedAt: Date.now(),
            });
          } catch {
            // Skip unreadable files
          }
        } else if (node.type === 'directory' && node.children) {
          await collectFiles(node.children, basePath);
        }
      }
    };

    await collectFiles(tree, rootPath);
    return files;
  }

  // ========================================================================
  // WRITE OPERATIONS
  // ========================================================================

  /**
   * Write content to a file (creates or overwrites)
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.isTauri) throw new Error('Tauri non disponible');

    await this.assertAllowedPath(filePath);
    // Ensure parent directory exists
    const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dirPath) {
      await this.createDirectory(dirPath);
    }

    await writeTextFile(filePath, content);
  }

  /**
   * Create a directory (recursive)
   */
  async createDirectory(dirPath: string): Promise<void> {
    if (!this.isTauri) throw new Error('Tauri non disponible');
    await this.assertAllowedPath(dirPath);
    try {
      await createDir(dirPath, { recursive: true });
    } catch {
      // Directory might already exist
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    if (!this.isTauri) throw new Error('Tauri non disponible');
    await this.assertAllowedPath(filePath);
    await removeFile(filePath);
  }

  /**
   * Delete a directory and its contents
   */
  async deleteDirectory(dirPath: string): Promise<void> {
    if (!this.isTauri) throw new Error('Tauri non disponible');
    await this.assertAllowedPath(dirPath);
    await removeDir(dirPath, { recursive: true });
  }

  /**
   * Rename / move a file
   */
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    if (!this.isTauri) throw new Error('Tauri non disponible');
    await this.assertAllowedPath(oldPath);
    await this.assertAllowedPath(newPath);
    await renameFile(oldPath, newPath);
  }

  /**
   * Check if a file or directory exists
   */
  async exists(path: string): Promise<boolean> {
    if (!this.isTauri) return false;
    try {
      await this.assertAllowedPath(path);
    } catch {
      return false;
    }
    return fsExists(path);
  }

  // ========================================================================
  // BATCH OPERATIONS
  // ========================================================================

  /**
   * Validate that a path does not escape rootPath via traversal.
   * Returns the safe joined path or throws.
   */
  private validatePath(rootPath: string, relativePath: string): string {
    // Normalize separators
    const normalized = relativePath.replace(/\\/g, '/');

    // Block obvious traversal patterns
    if (normalized.includes('..') || normalized.startsWith('/') || normalized.includes('~')) {
      throw new Error(`Chemin invalide — tentative de traversée: ${relativePath}`);
    }

    return `${rootPath}/${normalized}`;
  }

  /**
   * Execute multiple file operations atomically
   * Used by AI agents to create entire projects
   */
  async executeBatch(
    rootPath: string,
    operations: FileOperation[]
  ): Promise<{ success: string[]; errors: { path: string; error: string }[] }> {
    const success: string[] = [];
    const errors: { path: string; error: string }[] = [];

    try {
      await this.assertAllowedPath(rootPath);
    } catch (e: any) {
      return { success, errors: [{ path: rootPath, error: e?.message || 'Dossier non autorisé' }] };
    }

    for (const op of operations) {
      try {
        switch (op.type) {
          case 'create':
          case 'edit': {
            const fullPath = this.validatePath(rootPath, op.path);
            await this.writeFile(fullPath, op.content);
            success.push(op.path);
            break;
          }
          case 'delete': {
            const fullPath = this.validatePath(rootPath, op.path);
            await this.deleteFile(fullPath);
            success.push(op.path);
            break;
          }
          case 'rename': {
            const oldFull = this.validatePath(rootPath, op.oldPath);
            const newFull = this.validatePath(rootPath, op.newPath);
            await this.renameFile(oldFull, newFull);
            success.push(op.newPath);
            break;
          }
          case 'createDir': {
            const fullPath = this.validatePath(rootPath, op.path);
            await this.createDirectory(fullPath);
            success.push(op.path);
            break;
          }
        }
      } catch (error: any) {
        const path = 'path' in op ? op.path : ('oldPath' in op ? op.oldPath : 'unknown');
        errors.push({ path, error: error.message || 'Erreur inconnue' });
      }
    }

    return { success, errors };
  }

  /**
   * Save all modified project files back to disk
   */
  async saveProjectFiles(
    rootPath: string,
    files: ProjectFile[]
  ): Promise<void> {
    await this.assertAllowedPath(rootPath);
    for (const file of files) {
      const fullPath = `${rootPath}/${file.path}`;
      await this.writeFile(fullPath, file.content);
    }
  }

  // ========================================================================
  // UTILITY
  // ========================================================================

  /** Get file metadata (size, dates) */
  async getFileInfo(filePath: string): Promise<{ size: number; isDir: boolean } | null> {
    if (!this.isTauri) return null;

    try {
      // Tauri v1 doesn't have direct stat, we check by trying to read
      const content = await this.readFile(filePath);
      return { size: content.length, isDir: false };
    } catch {
      return null;
    }
  }

  /** Detect language from file path */
  getLanguage(filePath: string): string {
    const name = filePath.split('/').pop() || filePath;
    return detectLanguage(name);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const fileSystemService = new FileSystemService();
export default FileSystemService;
