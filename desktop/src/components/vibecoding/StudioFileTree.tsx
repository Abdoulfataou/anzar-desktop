/**
 * StudioFileTree — Arbre de fichiers pour le VibeCoding Studio.
 *
 * Affiche les fichiers du projet avec indicateurs live :
 *  - ⏳ spinner pour le fichier en cours de génération
 *  - ✅ check pour un fichier terminé
 *  - ✏️ point bleu pour un fichier modifié
 *  - Icônes contextuelles par type de fichier
 *
 * Construit un arbre à partir de chemins plats (src/App.tsx → src/  → App.tsx).
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen,
  FileCode, FileText, FileJson, File, Image, Settings,
  Search, Loader2, CheckCircle2, Circle, Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StudioFile } from './VibeCodingStudio';

// ============================================================================
// TYPES
// ============================================================================

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
  file?: StudioFile;
}

interface StudioFileTreeProps {
  files: StudioFile[];
  selectedFile: string | null;
  activeGeneratingFile?: string;
  onSelectFile: (path: string) => void;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Map extension → Lucide icon */
function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts': case 'tsx': case 'js': case 'jsx':
    case 'py': case 'java': case 'go': case 'rs':
    case 'cpp': case 'c': case 'rb': case 'php':
    case 'swift': case 'kt':
      return FileCode;
    case 'json': case 'yaml': case 'yml': case 'toml': case 'xml':
      return FileJson;
    case 'md': case 'txt': case 'csv': case 'log':
      return FileText;
    case 'png': case 'jpg': case 'jpeg': case 'svg': case 'gif': case 'webp':
      return Image;
    case 'env': case 'gitignore': case 'dockerignore':
    case 'eslintrc': case 'prettierrc':
      return Settings;
    default:
      return File;
  }
}

/** Extension → couleur d'accent */
function getExtColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts': case 'tsx': return 'text-blue-400';
    case 'js': case 'jsx': return 'text-yellow-400';
    case 'py': return 'text-green-400';
    case 'html': case 'htm': return 'text-orange-400';
    case 'css': case 'scss': return 'text-pink-400';
    case 'json': return 'text-amber-400';
    case 'md': return 'text-gray-400';
    default: return 'text-text-muted';
  }
}

/** Construit un arbre hiérarchique depuis des chemins plats */
function buildTree(files: StudioFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        // Fichier
        current.push({
          name: part,
          path: file.path,
          type: 'file',
          file,
        });
      } else {
        // Dossier — chercher ou créer
        let dir = current.find(n => n.type === 'directory' && n.name === part);
        if (!dir) {
          dir = {
            name: part,
            path: parts.slice(0, i + 1).join('/'),
            type: 'directory',
            children: [],
          };
          current.push(dir);
        }
        current = dir.children!;
      }
    }
  }

  // Trier : dossiers d'abord, puis fichiers, alphabétiquement
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).map(n => {
      if (n.children) n.children = sortNodes(n.children);
      return n;
    });
  };

  return sortNodes(root);
}

// ============================================================================
// NODE COMPONENT
// ============================================================================

const TreeNodeItem: React.FC<{
  node: TreeNode;
  level: number;
  selectedFile: string | null;
  activeGeneratingFile?: string;
  onSelectFile: (path: string) => void;
  defaultExpanded?: boolean;
}> = ({ node, level, selectedFile, activeGeneratingFile, onSelectFile, defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isSelected = node.type === 'file' && selectedFile === node.path;
  const isGenerating = node.type === 'file' && activeGeneratingFile === node.path;
  const Icon = node.type === 'directory'
    ? (expanded ? FolderOpen : Folder)
    : getFileIcon(node.name);

  return (
    <div>
      <button
        onClick={() => {
          if (node.type === 'directory') {
            setExpanded(!expanded);
          } else {
            onSelectFile(node.path);
          }
        }}
        className={cn(
          'w-full flex items-center gap-1.5 px-2 py-[5px] rounded-md text-[12px] transition-all duration-150 group',
          isSelected
            ? 'bg-accent-primary/15 text-accent-primary'
            : isGenerating
              ? 'bg-accent-primary/5 text-text-primary'
              : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        )}
        style={{ paddingLeft: `${level * 14 + 8}px` }}
      >
        {/* Expand arrow for directories */}
        {node.type === 'directory' ? (
          <span className="w-3.5 flex-shrink-0 text-text-muted">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        {/* Icon */}
        <Icon size={14} className={cn(
          'flex-shrink-0',
          node.type === 'directory' ? 'text-accent-secondary' : getExtColor(node.name),
        )} />

        {/* Name */}
        <span className="flex-1 truncate text-left">{node.name}</span>

        {/* Status indicator */}
        {node.type === 'file' && node.file && (
          <span className="flex-shrink-0 ml-1">
            {node.file.status === 'generating' || isGenerating ? (
              <Loader2 size={12} className="text-accent-primary animate-spin" />
            ) : node.file.status === 'done' ? (
              <CheckCircle2 size={12} className="text-emerald-400 opacity-60" />
            ) : node.file.status === 'modified' ? (
              <Pencil size={12} className="text-blue-400 opacity-60" />
            ) : (
              <Circle size={12} className="text-text-muted/20 opacity-0 group-hover:opacity-100" />
            )}
          </span>
        )}
      </button>

      {/* Children */}
      {node.type === 'directory' && expanded && node.children && (
        <div>
          {node.children.map(child => (
            <TreeNodeItem
              key={child.path}
              node={child}
              level={level + 1}
              selectedFile={selectedFile}
              activeGeneratingFile={activeGeneratingFile}
              onSelectFile={onSelectFile}
              defaultExpanded={level < 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const StudioFileTree: React.FC<StudioFileTreeProps> = ({
  files,
  selectedFile,
  activeGeneratingFile,
  onSelectFile,
}) => {
  const [search, setSearch] = useState('');

  // Filtrer les fichiers si recherche active
  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter(f => f.path.toLowerCase().includes(q));
  }, [files, search]);

  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);

  // Stats
  const doneCount = files.filter(f => f.status === 'done').length;
  const generatingCount = files.filter(f => f.status === 'generating').length;

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-text-primary uppercase tracking-wider">
            Fichiers
          </span>
          <span className="text-[10px] text-text-muted">
            {doneCount}/{files.length}
            {generatingCount > 0 && (
              <span className="text-accent-primary ml-1">
                ({generatingCount} en cours)
              </span>
            )}
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1 bg-bg-tertiary border border-border-subtle rounded-md text-[11px] text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
        {tree.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <Folder size={20} className="mx-auto mb-2 text-text-muted/30" />
            <p className="text-[11px] text-text-muted">
              {search ? 'Aucun fichier trouvé' : 'En attente des fichiers...'}
            </p>
          </div>
        ) : (
          tree.map(node => (
            <TreeNodeItem
              key={node.path}
              node={node}
              level={0}
              selectedFile={selectedFile}
              activeGeneratingFile={activeGeneratingFile}
              onSelectFile={onSelectFile}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default StudioFileTree;
