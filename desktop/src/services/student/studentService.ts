/**
 * Student Service - API client for backend student assistant endpoints
 * Handles all student project operations: writing, correction, research, plagiarism checking,
 * flashcards generation, translation, and exercises.
 * Pattern follows aiService.ts — backend proxy with JWT auth.
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

export interface StudentProject {
  id: string;
  project_type: string;
  title: string;
  subject: string;
  level: string;
  status: string;
  outline?: Record<string, any>;
  sections?: string[];
  content?: string;
  metadata?: Record<string, any>;
  tokens_used: number;
  created_at: string;
  updated_at: string;
}

export interface WriteRequest {
  document_type: 'memoire' | 'rapport' | 'expose' | 'plan';
  user_prompt: string;
  project_id?: string;
  context?: Record<string, any>;
  messages?: Array<{ role: string; content: string }>;
}

export interface WriteResult {
  status: string;
  step: string;
  content: string;
  outline: Record<string, any>;
  sections: string[];
  tokens_used: number;
  metadata: Record<string, any>;
  project_id: string;
}

export interface CorrectRequest {
  text: string;
  correction_type: 'langue' | 'reformulation' | 'academique' | 'tout';
  level?: string;
}

export interface CorrectResult {
  status: string;
  corrected_text: string;
  analysis: {
    error_count: number;
    error_categories: Record<string, number>;
    score: number;
    level_detected: string;
  };
  suggestions: string[];
  tokens_used: number;
}

export interface ResearchRequest {
  query: string;
  depth?: 'basic' | 'detailed' | 'exhaustive';
  citation_style?: 'apa' | 'mla' | 'chicago' | 'harvard';
  language?: string;
}

export interface ResearchResult {
  status: string;
  synthesis: string;
  sources: Array<Record<string, any>>;
  bibliography: string;
  key_findings: string[];
  tokens_used: number;
}

export interface PlagiarismRequest {
  text: string;
  sensitivity?: 'low' | 'medium' | 'high';
}

export interface PlagiarismResult {
  originality_score: number;
  flagged_passages: Array<{
    text: string;
    reason: string;
    severity: string;
    suggestion: string;
  }>;
  summary: string;
  recommendations: string[];
}

export interface FlashcardsRequest {
  content?: string;
  topic?: string;
  level?: string;
  count?: number;
  difficulty?: string;
}

export interface FlashcardsResult {
  cards: Array<{
    id: number;
    recto: string;
    verso: string;
    theme: string;
    difficulty: string;
  }>;
  themes: string[];
  study_plan: string;
}

export interface TranslateRequest {
  text: string;
  source_lang: 'fr' | 'en' | 'ar';
  target_lang: 'fr' | 'en' | 'ar';
  domain?: string;
}

export interface TranslateResult {
  translated_text: string;
  glossary: Array<{
    original: string;
    translated: string;
    context: string;
  }>;
  notes: string[];
}

export interface ExercisesRequest {
  subject?: string;
  content?: string;
  level?: string;
  exercise_types?: string[];
  count?: number;
  difficulty?: string;
}

export interface ExercisesResult {
  exercises: Array<{
    id: number;
    type: string;
    question: string;
    options: string[] | null;
    answer: string;
    explanation: string;
    difficulty: string;
    points: number;
  }>;
  total_points: number;
  answer_key: string;
  difficulty_distribution: Record<string, number>;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

class StudentService {
  private async fetchJson<T>(
    path: string,
    method: string = 'GET',
    body?: Record<string, any>
  ): Promise<T> {
    const url = `${getBackendUrl()}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: { message: response.statusText },
        }));
        const msg = error.error?.message || `Erreur serveur (${response.status})`;
        throw new Error(msg);
      }

      return response.json();
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Delai d\'attente depasse (90s). Reessaie.');
      }
      throw err;
    }
  }

  async listProjects(): Promise<StudentProject[]> {
    return this.fetchJson<StudentProject[]>('/api/student/projects');
  }

  async getProject(id: string): Promise<StudentProject | null> {
    try {
      return await this.fetchJson<StudentProject>(`/api/student/projects/${id}`);
    } catch (err) {
      return null;
    }
  }

  async deleteProject(id: string): Promise<void> {
    await this.fetchJson<void>(`/api/student/projects/${id}`, 'DELETE');
  }

  async write(req: WriteRequest): Promise<WriteResult> {
    return this.fetchJson<WriteResult>('/api/student/write', 'POST', req);
  }

  async correct(req: CorrectRequest): Promise<CorrectResult> {
    return this.fetchJson<CorrectResult>('/api/student/correct', 'POST', req);
  }

  async research(req: ResearchRequest): Promise<ResearchResult> {
    return this.fetchJson<ResearchResult>('/api/student/research', 'POST', req);
  }

  async checkPlagiarism(req: PlagiarismRequest): Promise<PlagiarismResult> {
    return this.fetchJson<PlagiarismResult>('/api/student/plagiarism', 'POST', req);
  }

  async generateFlashcards(req: FlashcardsRequest): Promise<FlashcardsResult> {
    return this.fetchJson<FlashcardsResult>('/api/student/flashcards', 'POST', req);
  }

  async translate(req: TranslateRequest): Promise<TranslateResult> {
    return this.fetchJson<TranslateResult>('/api/student/translate', 'POST', req);
  }

  async generateExercises(req: ExercisesRequest): Promise<ExercisesResult> {
    return this.fetchJson<ExercisesResult>('/api/student/exercises', 'POST', req);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const studentService = new StudentService();
