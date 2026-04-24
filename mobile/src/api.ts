import axios from 'axios';

let apiBaseUrl = (process.env as any)?.API_URL || 'http://localhost:8000';

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
  baseURL: apiBaseUrl,
  timeout: 60_000,
});

export const setApiBaseUrl = (url: string) => {
  apiBaseUrl = url;
  api.defaults.baseURL = url;
};

export const getApiBaseUrl = () => apiBaseUrl;

export const getModels = async (): Promise<ModelInfo[]> => {
  const { data } = await api.get<ModelInfo[]>('/api/models');
  return data;
};

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

