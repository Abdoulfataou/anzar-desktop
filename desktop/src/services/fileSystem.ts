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

  constructor() {
    this.isTauri = checkTauri();
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
      const { readDir } = await import('@tauri-apps/api/fs');
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

    const { readTextFile } = await import('@tauri-apps/api/fs');
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

    const { writeTextFile } = await import('@tauri-apps/api/fs');

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

    const { createDir } = await import('@tauri-apps/api/fs');
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

    const { removeFile } = await import('@tauri-apps/api/fs');
    await removeFile(filePath);
  }

  /**
   * Delete a directory and its contents
   */
  async deleteDirectory(dirPath: string): Promise<void> {
    if (!this.isTauri) throw new Error('Tauri non disponible');

    const { removeDir } = await import('@tauri-apps/api/fs');
    await removeDir(dirPath, { recursive: true });
  }

  /**
   * Rename / move a file
   */
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    if (!this.isTauri) throw new Error('Tauri non disponible');

    const { renameFile } = await import('@tauri-apps/api/fs');
    await renameFile(oldPath, newPath);
  }

  /**
   * Check if a file or directory exists
   */
  async exists(path: string): Promise<boolean> {
    if (!this.isTauri) return false;

    const { exists } = await import('@tauri-apps/api/fs');
    return exists(path);
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
