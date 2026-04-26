/**
 * ChatInput - Barre de saisie unifiée ANZAR
 * Sélecteur de projet intégré + textarea + modèle + envoi
 * Inspiré TRAE SOLO mais design original ANZAR
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  Paperclip, Square, Zap, Brain, ArrowUp,
  FolderOpen, ChevronDown, Plus, Check,
} from 'lucide-react';
import { cn, isTauri } from '@/lib/utils';
import { AIModel, Project } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { isAllowedProjectRoot, showPathNotAllowedMessage } from '@/lib/allowedProjectRoots';
import { readTextFile } from '@tauri-apps/api/fs';

interface ChatInputProps {
  onSendMessage: (message: string) => Promise<void> | void;
  onStopGeneration?: () => void;
  isLoading?: boolean;
  selectedModel?: AIModel;
  onModelChange?: (model: AIModel) => void;
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  placeholder?: string;
  maxHeight?: number;
}

const MAX_HEIGHT = 200;
const MIN_HEIGHT = 48;

/* ===== Project Selector Dropdown ===== */
function ProjectSelector({
  selectedProjectId,
  onSelectProject,
  projects,
  onOpenFolder,
}: {
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  projects: Project[];
  onOpenFolder: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
          'border',
          selectedProject
            ? 'bg-accent-primary/8 border-accent-primary/20 text-accent-primary'
            : 'bg-bg-tertiary/50 border-border-subtle text-text-muted hover:text-text-secondary hover:bg-bg-tertiary'
        )}
      >
        <FolderOpen size={13} />
        <span className="max-w-[120px] truncate">
          {selectedProject ? selectedProject.name : 'Projet'}
        </span>
        <ChevronDown size={12} className={cn('transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute bottom-full mb-2 left-0 w-56 bg-bg-secondary/95 backdrop-blur-xl border border-border-medium rounded-xl shadow-2xl z-50 overflow-hidden py-1">
            {/* No project option */}
            <button
              onClick={() => { onSelectProject(null); setIsOpen(false); }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left',
                !selectedProjectId
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              )}
            >
              {!selectedProjectId && <Check size={12} className="flex-shrink-0" />}
              {selectedProjectId && <div className="w-3" />}
              <span>Aucun projet</span>
            </button>

            {projects.length > 0 && (
              <div className="h-px bg-border-subtle mx-2 my-1" />
            )}

            {/* Project list */}
            <div className="max-h-48 overflow-y-auto">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => { onSelectProject(project.id); setIsOpen(false); }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left',
                    selectedProjectId === project.id
                      ? 'bg-accent-primary/10 text-accent-primary'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  )}
                >
                  {selectedProjectId === project.id ? <Check size={12} className="flex-shrink-0" /> : <div className="w-3" />}
                  <FolderOpen size={12} className="text-accent-secondary flex-shrink-0" />
                  <span className="truncate flex-1">{project.name}</span>
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full flex-shrink-0',
                    project.status === 'complete' ? 'bg-accent-success' :
                    project.status === 'generating' ? 'bg-accent-info' :
                    'bg-accent-warning'
                  )} />
                </button>
              ))}
            </div>

            <div className="h-px bg-border-subtle mx-2 my-1" />

            {/* Add folder */}
            <button
              onClick={() => { onOpenFolder(); setIsOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors text-left"
            >
              <div className="w-3" />
              <Plus size={12} />
              <span>Ajouter un dossier...</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ===== Model Toggle (visible pill) ===== */
function ModelToggle({
  selectedModel,
  onModelChange,
}: {
  selectedModel: AIModel;
  onModelChange: (model: AIModel) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg-tertiary/80 border border-border-subtle">
      <button
        onClick={() => onModelChange('fast')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200',
          selectedModel === 'fast'
            ? 'bg-accent-primary text-white shadow-sm'
            : 'text-text-muted hover:text-text-secondary'
        )}
      >
        <Zap size={13} />
        Rapide
      </button>
      <button
        onClick={() => onModelChange('thinking')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200',
          selectedModel === 'thinking'
            ? 'bg-accent-secondary text-white shadow-sm'
            : 'text-text-muted hover:text-text-secondary'
        )}
      >
        <Brain size={13} />
        Réflexion
      </button>
    </div>
  );
}

/* ===== Main ChatInput ===== */
export default function ChatInput({
  onSendMessage,
  onStopGeneration,
  isLoading = false,
  selectedModel = 'fast',
  onModelChange,
  selectedProjectId = null,
  onSelectProject,
  placeholder = 'Décris ta tâche, ANZAR s\'en occupe...',
  maxHeight = MAX_HEIGHT,
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const projects = useProjectStore((s) => s.projects);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.min(Math.max(scrollHeight, MIN_HEIGHT), maxHeight);
      textarea.style.height = `${newHeight}px`;
    }
  }, [message, maxHeight]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (message.trim() && !isLoading) {
      await onSendMessage(message.trim());
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleOpenFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Ajouter un projet',
      });
      if (selected && typeof selected === 'string') {
        const allowed = await isAllowedProjectRoot(selected);
        if (!allowed) {
          await showPathNotAllowedMessage();
          return;
        }
        const folderName = selected.split(/[/\\]/).pop() || 'Projet';
        const { createProject, updateProject } = useProjectStore.getState();
        const project = createProject(folderName, `Projet: ${selected}`, 'fast');
        updateProject(project.id, {
          status: 'complete',
          metadata: { localPath: selected, imported: true },
        });
        onSelectProject?.(project.id);
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  };

  const hasMessage = message.trim().length > 0;

  return (
    <div className="relative z-40 bg-bg-primary">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-4 pt-2">
        {/* Input container */}
        <div className={cn(
          'rounded-2xl border transition-all duration-300 overflow-hidden',
          'bg-surface-default/80 backdrop-blur-md',
          isFocused
            ? 'glow-border-active shadow-lg'
            : 'border-border-subtle hover:border-border-medium'
        )}>
          {/* Textarea area */}
          <div className="flex items-end gap-2 px-4 pt-4 pb-2">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={placeholder}
              disabled={isLoading}
              rows={1}
              className={cn(
                'flex-1 bg-transparent border-none outline-none resize-none',
                'text-text-primary placeholder-text-muted',
                'text-sm leading-relaxed',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              )}
              style={{
                minHeight: `${MIN_HEIGHT}px`,
                maxHeight: `${maxHeight}px`,
                scrollbarWidth: 'thin',
              }}
            />
          </div>

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle/50">
            {/* Left side: Project selector + attachment */}
            <div className="flex items-center gap-2">
              <ProjectSelector
                selectedProjectId={selectedProjectId}
                onSelectProject={onSelectProject || (() => {})}
                projects={projects}
                onOpenFolder={handleOpenFolder}
              />

              <div className="w-px h-4 bg-border-subtle" />

              <button
                disabled={isLoading}
                onClick={async () => {
                  try {
                    // Essayer Tauri dialog en premier
                    if (isTauri()) {
                      const { open: openDialog } = await import('@tauri-apps/api/dialog');
                      const selected = await openDialog({
                        multiple: true,
                        title: 'Joindre des fichiers',
                        filters: [
                          { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'yaml', 'md', 'txt', 'sql'] },
                          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
                          { name: 'Tous', extensions: ['*'] },
                        ],
                      });
                      if (selected) {
                        const files = Array.isArray(selected) ? selected : [selected];
                        for (const filePath of files) {
                          try {
                            const content = await readTextFile(filePath);
                            const name = (filePath as string).split(/[/\\]/).pop() || 'fichier';
                            // Insérer le contenu du fichier dans le message
                            setMessage((prev) => `${prev}\n\n--- ${name} ---\n${content.slice(0, 8000)}\n---\n`);
                          } catch {
                            // Fichier binaire (image) — insérer juste le chemin
                            const name = (filePath as string).split(/[/\\]/).pop() || 'fichier';
                            setMessage((prev) => `${prev}\n[Fichier joint: ${name}]`);
                          }
                        }
                      }
                    } else {
                      // Fallback web: input file caché
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.multiple = true;
                      input.accept = '.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.html,.css,.json,.md,.txt,.png,.jpg,.jpeg,.svg';
                      input.onchange = async () => {
                        if (input.files) {
                          for (const file of Array.from(input.files)) {
                            if (file.type.startsWith('text/') || file.name.match(/\.(ts|tsx|js|jsx|py|rs|go|java|html|css|json|yaml|md|txt|sql)$/)) {
                              const content = await file.text();
                              setMessage((prev) => `${prev}\n\n--- ${file.name} ---\n${content.slice(0, 8000)}\n---\n`);
                            } else {
                              setMessage((prev) => `${prev}\n[Fichier joint: ${file.name}]`);
                            }
                          }
                        }
                      };
                      input.click();
                    }
                  } catch (err) {
                    console.error('Failed to attach file:', err);
                  }
                }}
                className={cn(
                  'p-1.5 rounded-lg transition-all duration-200',
                  isLoading
                    ? 'text-text-muted cursor-not-allowed'
                    : 'text-text-muted hover:bg-bg-tertiary hover:text-text-secondary'
                )}
                title="Joindre un fichier"
              >
                <Paperclip size={15} />
              </button>
            </div>

            {/* Right side: Model selector + send */}
            <div className="flex items-center gap-2">
              {onModelChange && (
                <ModelToggle
                  selectedModel={selectedModel}
                  onModelChange={onModelChange}
                />
              )}

              {/* Send / Stop */}
              {isLoading ? (
                <button
                  onClick={onStopGeneration}
                  className={cn(
                    'p-2 rounded-xl transition-all duration-200',
                    'bg-accent-error/15 text-accent-error',
                    'hover:bg-accent-error/25'
                  )}
                  title="Arrêter"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={() => handleSubmit()}
                  disabled={!hasMessage}
                  className={cn(
                    'p-2 rounded-xl transition-all duration-200',
                    hasMessage
                      ? 'gradient-bg text-white shadow-md hover:opacity-90 active:scale-95'
                      : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                  )}
                  title="Envoyer"
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
