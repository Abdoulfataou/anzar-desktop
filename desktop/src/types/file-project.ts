export interface FileNode {
  id: string;
  name: string;
  path: string; // Chemin relatif dans le projet
  type: 'file' | 'directory';
  extension?: string; // Pour les fichiers seulement
  size?: number; // Taille en octets
  lastModified?: string; // Date ISO
  children?: FileNode[]; // Pour les répertoires
  content?: string; // Contenu du fichier (optionnel, chargé à la demande)
}

export interface FileProject {
  id: string;
  name: string;
  description?: string;
  rootPath: string; // Chemin original sur le système (si uploadé depuis le système)
  uploadedAt: string;
  updatedAt: string;
  fileCount: number;
  totalSize: number;
  fileTree: FileNode[]; // Arborescence des fichiers
  // Pour les projets hébergés (non liés au système de fichiers local)
  isLocal?: boolean;
  localPath?: string; // Chemin sur le système si c'est un projet local
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string; // MIME type
  uploadedAt: string;
  content?: string | ArrayBuffer; // Contenu pour les fichiers texte, null pour binaires
  previewUrl?: string; // URL de prévisualisation pour les images
}

export interface AIAnalysisResult {
  id: string;
  fileId: string;
  analysis: string;
  createdAt: string;
  model: string;
  confidence?: number;
  tags?: string[];
}

export type NewFileProject = Omit<FileProject, 'id' | 'uploadedAt' | 'updatedAt' | 'fileCount' | 'totalSize' | 'fileTree'>;

// Memory and Conversation types
export interface FileProjectConversation {
  id: string;
  title: string;
  messages: FileProjectMessage[];
  createdAt: string;
  updatedAt: string;
  tags: string[];
  starred: boolean;
  tokenCount: number;
}

export interface FileProjectMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  tokens?: number;
}

/** @deprecated Utiliser FileProjectConversation */
export type Conversation = FileProjectConversation;
/** @deprecated Utiliser FileProjectMessage */
export type Message = FileProjectMessage;

export type NewConversation = Omit<FileProjectConversation, 'id' | 'createdAt' | 'updatedAt'>;

// Agent types
export type AgentType = 'orchestrator' | 'planner' | 'coder' | 'tester' | 'executor';

export interface AgentStatus {
  agent: AgentType;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  startTime?: string;
  endTime?: string;
  error?: string;
}

export interface ProjectExecution {
  id: string;
  projectId: string;
  agentStatuses: AgentStatus[];
  overallProgress: number;
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'failed';
}
