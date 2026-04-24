import React, { useState, useMemo } from 'react';
import { FileNode } from '@/types/file-project';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  File,
  Search,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';

interface FileExplorerProps {
  files: FileNode[];
  onSelectFile?: (file: FileNode) => void;
  selectedFilePath?: string;
}

interface FileTreeNodeProps {
  node: FileNode;
  level: number;
  onSelectFile?: (file: FileNode) => void;
  selectedFilePath?: string;
}

const getFileIcon = (node: FileNode) => {
  if (node.type === 'directory') {
    return null;
  }

  const ext = node.extension?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'py':
    case 'java':
    case 'cpp':
    case 'c':
    case 'go':
    case 'rs':
      return FileCode;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
      return FileJson;
    case 'md':
    case 'txt':
    case 'doc':
    case 'docx':
      return FileText;
    default:
      return File;
  }
};

const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node,
  level,
  onSelectFile,
  selectedFilePath,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isSelected = selectedFilePath === node.path;
  const isDirectory = node.type === 'directory';

  const Icon = isDirectory
    ? isExpanded
      ? FolderOpen
      : Folder
    : getFileIcon(node) || File;

  return (
    <div>
      <button
        onClick={() => {
          if (isDirectory) {
            setIsExpanded(!isExpanded);
          } else {
            onSelectFile?.(node);
          }
        }}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors duration-150',
          isSelected
            ? 'bg-accent-primary/20 text-accent-primary'
            : 'text-text-primary hover:bg-bg-tertiary'
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {isDirectory && (
          <span className="flex-shrink-0 w-4 h-4">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </span>
        )}
        {!isDirectory && <div className="w-4" />}

        <Icon className={cn('w-4 h-4 flex-shrink-0', isDirectory && 'text-accent-secondary')} />

        <span className="flex-1 truncate text-left">{node.name}</span>

        {!isDirectory && node.size && (
          <span className="text-xs text-text-secondary flex-shrink-0">
            {formatBytes(node.size)}
          </span>
        )}
      </button>

      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              onSelectFile={onSelectFile}
              selectedFilePath={selectedFilePath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FileExplorer: React.FC<FileExplorerProps> = ({
  files,
  onSelectFile,
  selectedFilePath,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;

    const query = searchQuery.toLowerCase();
    const filterTree = (nodes: FileNode[]): FileNode[] => {
      return nodes
        .filter((node) => node.name.toLowerCase().includes(query) || node.type === 'directory')
        .map((node) => {
          if (node.type === 'directory' && node.children) {
            return {
              ...node,
              children: filterTree(node.children),
            };
          }
          return node;
        })
        .filter((node) => node.type === 'file' || (node.children && node.children.length > 0));
    };

    return filterTree(files);
  }, [files, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-bg-primary border-r border-border-subtle">
      {/* Header */}
      <div className="p-4 border-b border-border-subtle">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Fichiers</h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <input
            type="text"
            placeholder="Rechercher..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          />
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto">
        {filteredFiles.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-text-secondary">
              {searchQuery ? 'Aucun fichier trouvé' : 'Aucun fichier'}
            </p>
          </div>
        ) : (
          <div className="py-2">
            {filteredFiles.map((node) => (
              <FileTreeNode
                key={node.id}
                node={node}
                level={0}
                onSelectFile={onSelectFile}
                selectedFilePath={selectedFilePath}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileExplorer;
