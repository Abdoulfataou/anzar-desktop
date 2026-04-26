import axios from 'axios';
import { useAuthStore } from './stores/authStore'
import { useSettingsStore } from './stores/settingsStore'

// NOTE: sur mobile, "localhost" = téléphone. En dev, mets l'IP de ton PC (ex: http://192.168.x.x:8000)
let apiBaseUrl = 'http://localhost:8000';

export type ModelInfo = {
  name: string;
  description: string;
  icon: string;
  context_length: number;
  supports_streaming: boolean;
  reasoning_mode: boolean;
};

export type ProjectPlanResponse = {
  project_id: string;
  project_name: string;
  description: string;
  tasks: Array<Record<string, any>>;
  architecture: Record<string, any>;
  estimated_duration: string;
  dependencies: string[];
  risks: string[];
  status: 'planned' | string;
};

export type ProjectStatusResponse = {
  project_id: string;
  status: 'planned' | 'executing' | 'completed' | 'failed' | string;
  progress: number;
  message: string;
  results?: Array<Record<string, any>> | Record<string, any> | null;
  start_url?: string | null;
};

const api = axios.create({
  timeout: 60_000,
});

api.interceptors.request.use((config) => {
  const baseURL = useSettingsStore.getState().backendUrl || apiBaseUrl
  config.baseURL = baseURL
  const token = useAuthStore.getState().token
  if (token) {
    config.headers = config.headers || {}
    ;(config.headers as any).Authorization = `Bearer ${token}`
  }
  return config
})

export const setApiBaseUrl = (url: string) => {
  apiBaseUrl = url;
  api.defaults.baseURL = url;
};

export const getApiBaseUrl = () => apiBaseUrl;

// ─────────────────────────────────────────────────────────────────────────────
// AUTH (OTP)
// ─────────────────────────────────────────────────────────────────────────────

export const sendOtpCode = async (email: string) => {
  const { data } = await api.post('/api/auth/send-code', { email })
  return data as { status: string; message: string; email: string; expires_in_minutes: number; is_new_user: boolean }
}

export const verifyOtpCode = async (email: string, code: string) => {
  const { data } = await api.post('/api/auth/verify-code', { email, code })
  return data as {
    token: string
    user: { email: string; name: string }
    credits: { balance_fcfa: number; total_recharged: number; total_used: number }
    is_new_user: boolean
  }
}

export const getProfile = async () => {
  const { data } = await api.get('/api/user/profile')
  return data as { email: string; name: string; credits: { balance_fcfa: number } }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT
// ─────────────────────────────────────────────────────────────────────────────

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export const chat = async (messages: ChatMessage[], provider: 'deepseek' | 'kimi' = 'deepseek') => {
  const { data } = await api.post(`/api/${provider}/chat/completions`, {
    model: provider === 'kimi' ? 'kimi' : 'deepseek-chat',
    messages,
    stream: false,
  })
  return data as any
}

export const planProject = async (payload: {
  description: string;
  project_name?: string | null;
  tech_stack?: string[];
  requirements?: string[];
  auto_execute?: boolean;
}): Promise<ProjectPlanResponse> => {
  const { data } = await api.post<ProjectPlanResponse>('/api/projects/plan', payload);
  return data;
};

export const executeProject = async (
  projectId: string,
  payload: { project_id: string; confirm_execution: boolean }
): Promise<ProjectStatusResponse> => {
  const { data } = await api.post<ProjectStatusResponse>(
    `/api/projects/${projectId}/execute`,
    payload
  );
  return data;
};

export const getProjectStatus = async (projectId: string): Promise<ProjectStatusResponse> => {
  const { data } = await api.get<ProjectStatusResponse>(`/api/projects/${projectId}/status`);
  return data;
};
