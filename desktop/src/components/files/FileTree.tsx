'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, File, FileText, FileCode, Image, Archive, Code, FileQuestion } from 'lucide-react';
import { FileNode } from '@/types/file-project';

interface FileTreeProps {
  nodes: FileNode[];
  level?: number;
  onFileClick?: (file: FileNode) => void;
  onFileDoubleClick?: (file: FileNode) => void;
  selectedPath?: string;
  expandedPaths?: Set<string>;
  onToggleExpand?: (path: string) => void;
}

// Obtenir l'icône appropriée pour un nœud
const getFileIcon = (node: FileNode, isExpanded?: boolean) => {
  if (node.type === 'directory') {
    return isExpanded ? (
      <FolderOpen size={16} className="text-yellow-400" />
    ) : (
      <Folder size={16} className="text-yellow-400" />
    );
  }
  
  if (!node.extension) {
    return <File size={16} className="text-gray-400" />;
  }
  
  const ext = node.extension.toLowerCase();
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'php', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs', 'swift', 'kt'];
  const documentExtensions = ['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
  const configExtensions = ['json', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env'];
  
  if (imageExtensions.includes(ext)) return <Image size={16} className="text-pink-400" />;
  if (codeExtensions.includes(ext)) return <FileCode size={16} className="text-blue-400" />;
  if (documentExtensions.includes(ext)) return <FileText size={16} className="text-green-400" />;
  if (configExtensions.includes(ext)) return <Code size={16} className="text-purple-400" />;
  if (ext === 'zip' || ext === 'rar' || ext === 'tar' || ext === 'gz' || ext === '7z') return <Archive size={16} className="text-yellow-500" />;
  
  return <FileQuestion size={16} className="text-gray-400" />;
};

// Formater la taille de fichier
const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

export default function FileTree({
  nodes,
  level = 0,
  onFileClick,
  onFileDoubleClick,
  selectedPath,
  expandedPaths = new Set(),
  onToggleExpand,
}: FileTreeProps) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(new Set());
  
  // Utiliser le gestionnaire externe ou interne
  const isExpanded = (path: string) => expandedPaths.has(path);
  const toggleExpand = (path: string) => {
    if (onToggleExpand) {
      onToggleExpand(path);
    } else {
      setInternalExpanded(prev => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    }
  };
  
  // Trier les nœuds : dossiers d'abord, puis fichiers par nom
  const sortedNodes = [...nodes].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="font-mono text-sm">
      {sortedNodes.map((node) => {
        const isDirectory = node.type === 'directory';
        const hasChildren = node.children && node.children.length > 0;
        const expanded = isExpanded(node.path);
        const selected = selectedPath === node.path;
        
        return (
          <div key={node.id || node.path}>
            {/* Ligne du nœud */}
            <div
              className={`flex items-center py-1.5 px-2 rounded-lg cursor-pointer transition-colors ${
                selected
                  ? 'bg-[var(--anzar-accent)]/20 border border-[var(--anzar-accent)]/30'
                  : 'hover:bg-[var(--anzar-elevated)]'
              }`}
              style={{ paddingLeft: `${level * 20 + 8}px` }}
              onClick={() => onFileClick?.(node)}
              onDoubleClick={() => {
                if (isDirectory) {
                  toggleExpand(node.path);
                } else {
                  onFileDoubleClick?.(node);
                }
              }}
            >
              {/* Chevron pour les dossiers avec enfants */}
              {isDirectory && hasChildren ? (
                <button
                  className="w-5 h-5 flex items-center justify-center mr-1 rounded hover:bg-[var(--anzar-border)] transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(node.path);
                  }}
                >
                  {expanded ? (
                    <ChevronDown size={14} className="text-[var(--anzar-text-secondary)]" />
                  ) : (
                    <ChevronRight size={14} className="text-[var(--anzar-text-secondary)]" />
                  )}
                </button>
              ) : (
                <div className="w-5 mr-1" /> // Espacement pour l'alignement
              )}
              
              {/* Icône */}
              <div className="w-5 h-5 flex items-center justify-center mr-2">
                {getFileIcon(node, expanded)}
              </div>
              
              {/* Nom du fichier/dossier */}
              <span
                className={`flex-1 truncate ${
                  selected
                    ? 'text-[var(--anzar-accent)] font-medium'
                    : isDirectory
                    ? 'text-[var(--anzar-text)]'
                    : 'text-[var(--anzar-text-secondary)]'
                }`}
                title={node.name}
              >
                {node.name}
                {node.extension && !isDirectory && (
                  <span className="text-[var(--anzar-text-muted)]">.{node.extension}</span>
                )}
              </span>
              
              {/* Informations supplémentaires pour les fichiers */}
              {!isDirectory && (
                <div className="flex items-center gap-3 ml-2 text-xs text-[var(--anzar-text-muted)]">
                  <span className="hidden md:inline">{formatFileSize(node.size)}</span>
                  {node.lastModified && (
                    <span className="hidden lg:inline">
                      {new Date(node.lastModified).toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              )}
            </div>
            
            {/* Enfants (si le dossier est développé) */}
            {isDirectory && expanded && node.children && (
              <FileTree
                nodes={node.children}
                level={level + 1}
                onFileClick={onFileClick}
                onFileDoubleClick={onFileDoubleClick}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onToggleExpand={onToggleExpand}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}