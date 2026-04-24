'use client';

import { useState } from 'react';
import { 
  Folder, FolderOpen, File, FileText, Image, Code, Archive, 
  ChevronRight, ChevronDown, Plus, Trash2, Eye, Download, 
  MoreVertical, Search, Filter, Calendar, HardDrive, Clock,
  ExternalLink, FolderPlus
} from 'lucide-react';
import { useFileProjectStore } from '@/stores/fileProjectStore';
import FileTree from './FileTree';
import ProjectUploader from './ProjectUploader';
import FileEditor from './FileEditor';
import { FileNode, FileProject } from '@/types/file-project';

export default function ProjectExplorer() {
  const [selectedProject, setSelectedProject] = useState<FileProject | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [editingFile, setEditingFile] = useState<{
    projectId: string;
    filePath: string;
    name: string;
    extension?: string;
  } | null>(null);
  const [creatingItem, setCreatingItem] = useState<{type: 'file' | 'folder', parentPath?: string} | null>(null);
  const [newItemName, setNewItemName] = useState('');

  const {
    fileProjects,
    currentFileProject,
    deleteFileProject,
    setCurrentFileProject,
    searchInProjects,
    getProjectStats,
    addFileToProject,
    deleteFileFromProject
  } = useFileProjectStore();

  // Formater la taille
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Formater la date
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Gérer la sélection d'un projet
  const handleSelectProject = (project: FileProject) => {
    setSelectedProject(project);
    setCurrentFileProject(project);
    // Réinitialiser la sélection de fichier
    setSelectedFilePath(null);
  };

  // Gérer la suppression d'un projet
  const handleDeleteProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Êtes-vous sûr de vouloir supprimer ce projet ? Cette action est irréversible.')) {
      deleteFileProject(projectId);
      if (selectedProject?.id === projectId) {
        setSelectedProject(null);
        setCurrentFileProject(null);
      }
    }
  };

  // Gérer le clic sur un fichier dans l'arborescence
  const handleFileClick = (file: FileNode) => {
    setSelectedFilePath(file.path);
    // Fichier sélectionné — le chemin est maintenant dans selectedFilePath
  };

  // Gérer le double-clic sur un fichier (ouvrir l'éditeur)
  const handleFileDoubleClick = (file: FileNode) => {
    if (file.type === 'directory') {
      // Basculer l'expansion
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(file.path)) {
        newExpanded.delete(file.path);
      } else {
        newExpanded.add(file.path);
      }
      setExpandedPaths(newExpanded);
    } else {
      // Ouvrir l'éditeur
      if (!selectedProject) return;
      setEditingFile({
        projectId: selectedProject.id,
        filePath: file.path,
        name: file.name,
        extension: file.extension
      });
    }
  };

  // Gérer l'expansion/collapse dans l'arborescence
  const handleToggleExpand = (path: string) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  // Rechercher dans les projets
  const searchResults = searchQuery ? searchInProjects(searchQuery) : [];

  return (
    <div className="h-full flex flex-col">
      {/* En-tête avec actions */}
      <div className="px-8 pt-6 pb-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-medium text-[var(--anzar-text)]">Projets Uploadés</h1>
            <p className="text-[var(--anzar-text-secondary)] mt-2">
              Gérez vos projets entiers comme dans Claude Cowork
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Recherche */}
            <div className="relative">
              <Search size={18} className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[var(--anzar-text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher dans les projets..."
                className="pl-12 pr-4 py-3 bg-[var(--anzar-surface)] border border-[var(--anzar-border)] rounded-xl text-[var(--anzar-text)] placeholder-[var(--anzar-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--anzar-accent)] focus:border-transparent w-64"
              />
            </div>
            
            {/* Bouton upload */}
            <button
              onClick={() => setShowUploader(true)}
              className="px-4 py-3 rounded-xl bg-gradient-to-r from-[var(--anzar-accent)] to-[var(--anzar-accent-light)] text-white hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <FolderPlus size={18} />
              <span className="text-sm font-medium">Nouveau projet</span>
            </button>
          </div>
        </div>
      </div>

      {/* Contenu principal */}
      <div className="flex-1 overflow-hidden px-8 pb-8">
        {fileProjects.length === 0 ? (
          // État vide
          <div className="h-full flex flex-col items-center justify-center text-center py-16">
            <div className="p-6 rounded-2xl bg-gradient-to-br from-[var(--anzar-accent)]/10 to-[var(--anzar-accent-light)]/10 border border-[var(--anzar-accent)]/20 mb-6">
              <FolderOpen size={64} className="text-[var(--anzar-accent)]" />
            </div>
            <h3 className="text-xl font-medium text-[var(--anzar-text)] mb-3">Aucun projet uploadé</h3>
            <p className="text-[var(--anzar-text-secondary)] max-w-md mb-8">
              Uploader un dossier entier pour travailler dessus comme dans Claude Cowork. Vous pourrez lire, modifier, créer et supprimer des fichiers.
            </p>
            <button
              onClick={() => setShowUploader(true)}
              className="px-6 py-4 rounded-xl bg-gradient-to-r from-[var(--anzar-accent)] to-[var(--anzar-accent-light)] text-white hover:opacity-90 transition-opacity flex items-center gap-3"
            >
              <FolderPlus size={20} />
              <span className="font-medium">Uploader votre premier projet</span>
            </button>
          </div>
        ) : (
          <div className="h-full flex gap-8">
            {/* Liste des projets */}
            <div className={`${selectedProject ? 'w-96' : 'w-full'} flex-shrink-0`}>
              <div className="mb-4">
                <h2 className="text-lg font-medium text-[var(--anzar-text)] mb-4">Vos projets ({fileProjects.length})</h2>
                
                {/* Résultats de recherche */}
                {searchQuery && searchResults.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-[var(--anzar-text-secondary)] mb-3">
                      Résultats de recherche ({searchResults.length})
                    </h3>
                    <div className="space-y-3">
                      {searchResults.map((result, index) => (
                        <div
                          key={`${result.project.id}-${index}`}
                          className="p-4 rounded-xl border border-[var(--anzar-border)] bg-[var(--anzar-surface)] hover:border-[var(--anzar-accent)]/30 hover:bg-[var(--anzar-elevated)] transition-colors cursor-pointer"
                          onClick={() => handleSelectProject(result.project)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                              <File size={16} className="text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[var(--anzar-text)] truncate">{result.file.name}</p>
                              <p className="text-xs text-[var(--anzar-text-muted)] truncate">Dans {result.project.name}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Liste des projets */}
                <div className="space-y-4">
                  {fileProjects.map((project) => {
                    const stats = getProjectStats(project.id);
                    const isSelected = selectedProject?.id === project.id;
                    
                    return (
                      <div
                        key={project.id}
                        className={`p-5 rounded-2xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[var(--anzar-accent)] bg-[var(--anzar-accent)]/5'
                            : 'border-[var(--anzar-border)] bg-[var(--anzar-surface)] hover:border-[var(--anzar-accent)]/30 hover:bg-[var(--anzar-elevated)]'
                        }`}
                        onClick={() => handleSelectProject(project)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-xl ${
                              isSelected
                                ? 'bg-[var(--anzar-accent)]/10 border border-[var(--anzar-accent)]/20'
                                : 'bg-[var(--anzar-elevated)] border border-[var(--anzar-border)]'
                            }`}>
                              <Folder size={20} className={isSelected ? 'text-[var(--anzar-accent)]' : 'text-blue-400'} />
                            </div>
                            <div>
                              <h3 className="font-medium text-[var(--anzar-text)]">{project.name}</h3>
                              {project.description && (
                                <p className="text-sm text-[var(--anzar-text-secondary)] mt-1">{project.description}</p>
                              )}
                              <div className="flex items-center gap-4 mt-3 text-xs text-[var(--anzar-text-muted)]">
                                <span className="flex items-center gap-1">
                                  <File size={12} />
                                  {project.fileCount} fichiers
                                </span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <HardDrive size={12} />
                                  {formatSize(project.totalSize)}
                                </span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Calendar size={12} />
                                  {formatDate(project.uploadedAt)}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            {project.isLocal && (
                              <span className="px-2 py-1 rounded-md text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                                Local
                              </span>
                            )}
                            <button
                              onClick={(e) => handleDeleteProject(project.id, e)}
                              className="p-2 rounded-lg text-[var(--anzar-text-secondary)] hover:text-red-400 hover:bg-red-500/5 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        
                        {/* Chemin racine */}
                        <div className="mt-4 pt-4 border-t border-[var(--anzar-border)]/30">
                          <p className="text-xs text-[var(--anzar-text-muted)] flex items-center gap-2">
                            <ExternalLink size={12} />
                            {project.rootPath}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            
            {/* Détails du projet sélectionné */}
            {selectedProject && (
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-medium text-[var(--anzar-text)]">{selectedProject.name}</h2>
                      <p className="text-[var(--anzar-text-secondary)] mt-2">
                        {selectedProject.fileCount} fichiers • {formatSize(selectedProject.totalSize)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button className="px-4 py-2 rounded-xl border border-[var(--anzar-border)] text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] transition-colors text-sm">
                        <Eye size={16} className="inline mr-2" />
                        Prévisualiser
                      </button>
                      <button className="px-4 py-2 rounded-xl border border-[var(--anzar-border)] text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] transition-colors text-sm">
                        <Download size={16} className="inline mr-2" />
                        Exporter
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Arborescence des fichiers */}
                <div className="flex-1 overflow-hidden border border-[var(--anzar-border)] rounded-2xl bg-[var(--anzar-surface)]">
                  <div className="p-6 border-b border-[var(--anzar-border)]">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-[var(--anzar-text)]">Arborescence des fichiers</h3>
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--anzar-text-muted)]" />
                          <input
                            type="text"
                            placeholder="Rechercher dans le projet..."
                            className="pl-10 pr-4 py-2 bg-[var(--anzar-elevated)] border border-[var(--anzar-border)] rounded-lg text-[var(--anzar-text)] placeholder-[var(--anzar-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--anzar-accent)] focus:border-transparent text-sm w-64"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 overflow-y-auto max-h-[calc(100vh-400px)]">
                    {selectedProject.fileTree.length > 0 ? (
                      <FileTree
                        nodes={selectedProject.fileTree}
                        onFileClick={handleFileClick}
                        onFileDoubleClick={handleFileDoubleClick}
                        selectedPath={selectedFilePath}
                        expandedPaths={expandedPaths}
                        onToggleExpand={handleToggleExpand}
                      />
                    ) : (
                      <div className="text-center py-12">
                        <div className="p-4 rounded-full bg-[var(--anzar-elevated)] border border-[var(--anzar-border)] inline-block mb-4">
                          <File size={32} className="text-[var(--anzar-text-muted)]" />
                        </div>
                        <h4 className="text-lg font-medium text-[var(--anzar-text)] mb-2">Aucun fichier</h4>
                        <p className="text-[var(--anzar-text-secondary)] max-w-sm mx-auto">
                          Ce projet ne contient aucun fichier. Essayez d'uploader un dossier avec des fichiers.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal d'upload de projet */}
      {showUploader && (
        <ProjectUploader
          onUploadComplete={(projectId) => {
            setShowUploader(false);
            // Sélectionner le projet nouvellement uploadé
            const newProject = fileProjects.find(p => p.id === projectId);
            if (newProject) {
              setSelectedProject(newProject);
              setCurrentFileProject(newProject);
            }
          }}
          onClose={() => setShowUploader(false)}
        />
      )}

      {/* Éditeur de fichier */}
      {editingFile && (
        <FileEditor
          mode="project"
          projectId={editingFile.projectId}
          filePath={editingFile.filePath}
          name={editingFile.name}
          extension={editingFile.extension}
          onClose={() => setEditingFile(null)}
          onSaved={(path) => {
            // Rafraîchir l'arborescence si nécessaire
          }}
        />
      )}
    </div>
  );
}