/**
 * Skills Hub Service — API client for community skills endpoints.
 * Browse, install, publish, and rate community skills.
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

export type HubSkillCategory = 'ui' | 'perf' | 'quality' | 'feature' | 'fix' | 'test' | 'custom';
export type HubSkillMode = 'iterate' | 'refactor' | 'patch' | 'debug' | 'test' | 'review';
export type HubSortBy = 'downloads' | 'rating' | 'newest';

export interface CommunitySkill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  mode: HubSkillMode;
  category: HubSkillCategory;
  icon: string;
  author_email: string;
  downloads: number;
  rating: number;
  rating_count: number;
  created_at: string;
}

export interface PublishSkillRequest {
  name: string;
  description: string;
  prompt: string;
  mode: HubSkillMode;
  category: HubSkillCategory;
  icon: string;
}

// ============================================================================
// SERVICE
// ============================================================================

class SkillsHubService {
  /** Browse the community hub with optional filters. */
  async browse(opts?: {
    category?: HubSkillCategory;
    search?: string;
    sort?: HubSortBy;
    limit?: number;
    offset?: number;
  }): Promise<CommunitySkill[]> {
    const url = new URL(`${getBackendUrl()}/api/skills/hub`);
    if (opts?.category) url.searchParams.set('category', opts.category);
    if (opts?.search) url.searchParams.set('search', opts.search);
    if (opts?.sort) url.searchParams.set('sort', opts.sort);
    if (opts?.limit) url.searchParams.set('limit', String(opts.limit));
    if (opts?.offset) url.searchParams.set('offset', String(opts.offset));

    const res = await fetch(url.toString(), { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.skills ?? [];
  }

  /** Get my installed skills. */
  async getInstalled(): Promise<CommunitySkill[]> {
    const res = await fetch(`${getBackendUrl()}/api/skills/installed`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.skills ?? [];
  }

  /** Get my published skills. */
  async getPublished(): Promise<CommunitySkill[]> {
    const res = await fetch(`${getBackendUrl()}/api/skills/published`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.skills ?? [];
  }

  /** Publish a new community skill. */
  async publish(skill: PublishSkillRequest): Promise<CommunitySkill> {
    const res = await fetch(`${getBackendUrl()}/api/skills/publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(skill),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.skill;
  }

  /** Install a community skill by ID. */
  async install(skillId: string): Promise<boolean> {
    const res = await fetch(`${getBackendUrl()}/api/skills/${skillId}/install`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.newly_installed;
  }

  /** Uninstall a community skill by ID. */
  async uninstall(skillId: string): Promise<void> {
    const res = await fetch(`${getBackendUrl()}/api/skills/${skillId}/uninstall`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
  }

  /** Rate a community skill (0-5). */
  async rate(skillId: string, rating: number): Promise<void> {
    const res = await fetch(`${getBackendUrl()}/api/skills/${skillId}/rate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ rating }),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
  }

  /** Delete a skill I published. */
  async deleteSkill(skillId: string): Promise<void> {
    const res = await fetch(`${getBackendUrl()}/api/skills/${skillId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}: ${res.statusText}`);
  }
}

export const skillsHubService = new SkillsHubService();
