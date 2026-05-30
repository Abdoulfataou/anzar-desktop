/**
 * Storage Service
 * Abstraction layer for local storage with support for both Tauri filesystem and browser localStorage
 * Handles JSON serialization and compression for large data
 */

import { invoke } from '@tauri-apps/api/tauri';

/**
 * Compression threshold - files larger than this will be compressed
 */
const COMPRESSION_THRESHOLD = 100 * 1024; // 100KB

/**
 * Storage service with fallback support
 */
class StorageService {
  private isTauriAvailable = false;
  private initialized = false;

  /**
   * Initialize the storage service
   * Checks if Tauri is available
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Test if Tauri is available
      await invoke('plugin:core|app_metadata');
      this.isTauriAvailable = true;
    } catch {
      this.isTauriAvailable = false;
    }

    this.initialized = true;
  }

  /**
   * Save data to storage
   * Uses Tauri filesystem if available, otherwise localStorage
   *
   * @param key - Storage key
   * @param data - Data to save (will be JSON stringified)
   * @throws Error if storage operation fails
   *
   * @example
   * ```typescript
   * await storage.save('my-data', { count: 42 });
   * ```
   */
  async save<T>(key: string, data: T): Promise<void> {
    await this.initialize();

    try {
      const jsonString = JSON.stringify(data);

      if (this.isTauriAvailable) {
        // Use Tauri filesystem
        const shouldCompress = jsonString.length > COMPRESSION_THRESHOLD;

        try {
          await invoke('plugin:fs|write_file', {
            path: `${key}.json`,
            contents: jsonString,
            compress: shouldCompress,
          });
        } catch (error) {
          // Fallback to localStorage if Tauri fails
          this.saveToLocalStorage(key, jsonString);
        }
      } else {
        // Use browser localStorage
        this.saveToLocalStorage(key, jsonString);
      }
    } catch (error) {
      console.error(`Erreur lors de l'enregistrement de ${key}:`, error);
      throw new Error(`Impossible d'enregistrer ${key}`);
    }
  }

  /**
   * Load data from storage
   * Uses Tauri filesystem if available, otherwise localStorage
   *
   * @param key - Storage key
   * @returns Parsed data or null if not found
   *
   * @example
   * ```typescript
   * const data = await storage.load<MyType>('my-data');
   * ```
   */
  async load<T>(key: string): Promise<T | null> {
    await this.initialize();

    try {
      if (this.isTauriAvailable) {
        try {
          const contents = await invoke<string>('plugin:fs|read_file', {
            path: `${key}.json`,
          });

          return JSON.parse(contents) as T;
        } catch (error) {
          // Fallback to localStorage if Tauri fails
          return this.loadFromLocalStorage<T>(key);
        }
      } else {
        // Use browser localStorage
        return this.loadFromLocalStorage<T>(key);
      }
    } catch (error) {
      console.error(`Erreur lors de la lecture de ${key}:`, error);
      return null;
    }
  }

  /**
   * Remove data from storage
   *
   * @param key - Storage key
   * @throws Error if removal fails
   */
  async remove(key: string): Promise<void> {
    await this.initialize();

    try {
      if (this.isTauriAvailable) {
        try {
          await invoke('plugin:fs|remove_file', {
            path: `${key}.json`,
          });
        } catch (error) {
          // Fallback to localStorage
          localStorage.removeItem(key);
        }
      } else {
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.error(`Erreur lors de la suppression de ${key}:`, error);
      throw new Error(`Impossible de supprimer ${key}`);
    }
  }

  /**
   * List all storage keys
   *
   * @returns Array of all storage keys
   */
  async listKeys(): Promise<string[]> {
    await this.initialize();

    try {
      if (this.isTauriAvailable) {
        try {
          const files = await invoke<string[]>('plugin:fs|list_dir', {
            path: './',
          });

          return files
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.replace('.json', ''));
        } catch (error) {
          // Fallback to localStorage
          return this.getLocalStorageKeys();
        }
      } else {
        return this.getLocalStorageKeys();
      }
    } catch (error) {
      console.error('Erreur lors de la listage des clés:', error);
      return [];
    }
  }

  /**
   * Clear all storage
   * WARNING: This is destructive!
   */
  async clearAll(): Promise<void> {
    await this.initialize();

    try {
      const keys = await this.listKeys();

      for (const key of keys) {
        await this.remove(key);
      }
    } catch (error) {
      console.error('Erreur lors du nettoyage du stockage:', error);
      throw new Error('Impossible de nettoyer le stockage');
    }
  }

  /**
   * Get storage size estimate (for quota management)
   */
  async getStorageSize(): Promise<number> {
    await this.initialize();

    if (this.isTauriAvailable) {
      // Tauri filesystem doesn't have size limits like browser storage
      return Infinity;
    }

    // For browser storage, check localStorage size
    let totalSize = 0;
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        totalSize += localStorage[key].length + key.length;
      }
    }

    return totalSize;
  }

  // ========================================================================
  // PRIVATE HELPERS
  // ========================================================================

  /**
   * Save to browser localStorage
   * @private
   */
  private saveToLocalStorage(key: string, jsonString: string): void {
    try {
      localStorage.setItem(key, jsonString);
    } catch (error) {
      // localStorage quota exceeded
      console.error(`Quota de localStorage dépassée pour ${key}`, error);
      throw new Error(`Quota de stockage dépassé pour ${key}`);
    }
  }

  /**
   * Load from browser localStorage
   * @private
   */
  private loadFromLocalStorage<T>(key: string): T | null {
    const item = localStorage.getItem(key);
    if (!item) return null;

    try {
      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`Erreur de parsing pour ${key}:`, error);
      return null;
    }
  }

  /**
   * Get all localStorage keys that match our pattern
   * @private
   */
  private getLocalStorageKeys(): string[] {
    const keys: string[] = [];
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key) && !key.startsWith('zustand')) {
        keys.push(key);
      }
    }
    return keys;
  }
}

// Export singleton instance
export const storageService = new StorageService();

// Export the class for testing
export { StorageService };
