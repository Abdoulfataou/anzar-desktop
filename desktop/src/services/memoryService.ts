/**
 * Memory Service — API client for developer memory endpoints.
 * Manages persistent developer preferences learned from projects.
 * Hermes-inspired: auto-learn + manual edit hybrid system.
 */

import { useSettingsStore } from '@/stores/settingsStore';

// ============================================================================
// CONFIGURATION
// ============================================================================

function getBackendUrl(): string {
  return useSettingsStore.getState().getBackendUrl() || 'https://anzar-desktop-production.up.railway.app';
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = useSettingsStore.getState().getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ============================================================================
// TYPES
// ============================================================================

export type MemoryCategory = 'stack' | 'conventions' | 'patterns' | 'errors' | 'preferences' | 'style';

export interface MemoryEntry {
  id: number;
  category: MemoryCategory;
  key: string;
  value: string;
  confidence: number;
  source: 'auto' | 'manual';
  created_at: string;
  updated_at: string;
}

export interface MemoryProfile {
  [category: string]: { [key: string]: string };
}

export interface UpsertMemoryRequest {
  category: MemoryCategory;
  key: string;
  value: string;
}

// ============================================================================
// MEMORY SERVICE
// ============================================================================

class MemoryService {
  /**
   * Get all memory entries, optionally filtered by category.
   */
  async getEntries(category?: MemoryCategory): Promise<MemoryEntry[]> {
    const url = new URL(`${getBackendUrl()}/api/user/memory`);
    if (category) url.searchParams.set('category', category);

    const res = await fetch(url.toString(), { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.entries ?? [];
  }

  /**
   * Get the organized memory profile (category → key → value).
   */
  async getProfile(): Promise<MemoryProfile> {
    const res = await fetch(`${getBackendUrl()}/api/user/memory/profile`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.profile ?? {};
  }

  /**
   * Manually upsert a single memory entry.
   */
  async upsert(entry: UpsertMemoryRequest): Promise<number> {
    const res = await fetch(`${getBackendUrl()}/api/user/memory`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.id;
  }

  /**
   * Auto-learn entries from project files (via MemoryAgent).
   */
  async learn(entries: Array<{ category: MemoryCategory; key: string; value: string; confidence: number }>): Promise<number> {
    const res = await fetch(`${getBackendUrl()}/api/user/memory/learn`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.count;
  }

  /**
   * Delete a specific memory entry by category + key.
   */
  async deleteEntry(category: MemoryCategory, key: string): Promise<boolean> {
    const res = await fetch(`${getBackendUrl()}/api/user/memory`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ category, key }),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.deleted;
  }

  /**
   * Clear all memory entries, optionally for a specific category.
   */
  async clearAll(category?: MemoryCategory): Promise<number> {
    const url = new URL(`${getBackendUrl()}/api/user/memory/all`);
    if (category) url.searchParams.set('category', category);

    const res = await fetch(url.toString(), {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.deleted;
  }
}

export const memoryService = new MemoryService();
