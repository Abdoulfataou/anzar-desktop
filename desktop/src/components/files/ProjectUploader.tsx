'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Folder, Upload, File, X, Loader2, FolderOpen, FileText, Image, Archive, Code, Check, AlertCircle } from 'lucide-react';
import { useTauriProjects } from '@/hooks/useTauriProjects';
import { useFileProjectStore } from '@/stores/fileProjectStore';
import { FileNode } from '@/types/file-project';

interface ProjectUploaderProps {
  onUploadComplete?: (projectId: string) => void;
  onClose?: () => void;
}

export default function ProjectUploader({ onUploadComplete, onClose }: ProjectUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  
  const { selectDirectory, readDirectoryRecursive, convertToFileNode, uploadFile } = useTauriProjects();
  const { addFileProject } = useFileProjectStore();

  // Gestion du drag & drop de dossiers (via sélection)
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Pour les dossiers, on utilise la sélection de dossier Tauri
    // Le drag & drop de dossiers natif n'est pas supporté directement
    // Pour l'instant, on utilise seulement la sélection de dossier
    // Les fichiers individuels seront gérés par un autre composant
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true, // On gère le clic manuellement
    noKeyboard: true,
  });

  // Sélectionner un dossier via Tauri
  const handleSelectFolder = async () => {
    setIsUploading(true);
    setError(null);
    
    try {
      const path = await selectDirectory();
      if (path) {
        setSelectedPath(path);
        
        // Générer un nom de projet basé sur le nom du dossier
        const folderName = path.split(/[/\\]/).pop() || 'Nouveau Projet';
        setProjectName(projectName || folderName);
        
        // Lire l'arborescence pour prévisualisation
        // (on ne charge pas tout le contenu des fichiers, seulement la structure)
        // Dossier sélectionné avec succès
      }
    } catch (err: any) {
      setError(`Erreur lors de la sélection du dossier: ${err.toString()}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Uploader le projet
  const handleUploadProject = async () => {
    if (!selectedPath) {
      setError('Veuillez d\'abord sélectionner un dossier');
      return;
    }

    if (!projectName.trim()) {
      setError('Veuillez donner un nom au projet');
      return;
    }

    setIsUploading(true);
    setError(null);
    setUploadProgress(0);

    try {
      // 1. Lire l'arborescence récursive du dossier
      setUploadProgress(10);
      const tree = await readDirectoryRecursive(selectedPath);
      
      // 2. Convertir en FileNode pour le store
      setUploadProgress(30);
      const fileTree = convertToFileNode(tree);
      
      // 3. Compter les fichiers et calculer la taille totale
      let fileCount = 0;
      let totalSize = 0;
      
      const countFiles = (nodes: FileNode[]) => {
        nodes.forEach((node) => {
          if (node.type === 'file') {
            fileCount++;
            totalSize += node.size || 0;
          }
          if (node.children) {
            countFiles(node.children);
          }
        });
      };
      
      countFiles([fileTree]);
      setUploadProgress(60);
      
      // 4. Ajouter le projet au store
      const newProject = {
        name: projectName,
        description: projectDescription,
        rootPath: selectedPath,
        isLocal: true,
        localPath: selectedPath,
      };
      
      addFileProject(newProject, [fileTree], fileCount, totalSize);
      setUploadProgress(100);
      
      // 5. Notifier le parent
      onUploadComplete?.(Date.now().toString()); // ID temporaire
      
    } catch (err: any) {
      setError(`Erreur lors de l'upload du projet: ${err.toString()}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Obtenir l'icône selon l'extension
  const getFileIcon = (extension?: string) => {
    if (!extension) return <File size={16} className="text-gray-400" />;
    
    const ext = extension.toLowerCase();
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'];
    const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'php', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs'];
    const documentExtensions = ['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    
    if (imageExtensions.includes(ext)) return <Image size={16} className="text-pink-400" />;
    if (codeExtensions.includes(ext)) return <Code size={16} className="text-blue-400" />;
    if (documentExtensions.includes(ext)) return <FileText size={16} className="text-green-400" />;
    if (ext === 'zip' || ext === 'rar' || ext === 'tar' || ext === 'gz') return <Archive size={16} className="text-yellow-400" />;
    
    return <File size={16} className="text-gray-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--anzar-surface)] border border-[var(--anzar-border)] rounded-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* En-tête */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-medium text-[var(--anzar-text)]">Uploader un projet</h2>
            <p className="text-[var(--anzar-text-secondary)] mt-2">
              Importez un dossier entier pour travailler dessus comme dans Claude Cowork
            </p>
          </div>
          
          {onClose && (
            <button
              onClick={onClose}
              className="p-3 rounded-xl border border-[var(--anzar-border)] text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:border-red-500/30 hover:bg-red-500/5 transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Zone de drag & drop */}
        <div
          {...getRootProps()}
          className={`flex-1 border-2 border-dashed rounded-2xl p-8 mb-8 transition-all ${
            isDragActive
              ? 'border-[var(--anzar-accent)] bg-[var(--anzar-accent)]/5'
              : 'border-[var(--anzar-border)] hover:border-[var(--anzar-accent)] hover:bg-[var(--anzar-elevated)]'
          }`}
        >
          <input {...getInputProps()} />
          
          <div className="flex flex-col items-center justify-center text-center py-12">
            <div className="p-6 rounded-2xl bg-gradient-to-br from-[var(--anzar-accent)]/10 to-[var(--anzar-accent-light)]/10 border border-[var(--anzar-accent)]/20 mb-6">
              <FolderOpen size={48} className="text-[var(--anzar-accent)]" />
            </div>
            
            <h3 className="text-xl font-medium text-[var(--anzar-text)] mb-3">
              {selectedPath ? 'Dossier sélectionné' : 'Sélectionnez un dossier'}
            </h3>
            
            <p className="text-[var(--anzar-text-secondary)] mb-6 max-w-md">
              {selectedPath
                ? `Prêt à uploader: ${selectedPath.split(/[/\\]/).pop()}`
                : 'Glissez-déposez un dossier ou cliquez pour sélectionner'}
            </p>
            
            <button
              onClick={handleSelectFolder}
              disabled={isUploading}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-[var(--anzar-accent)] to-[var(--anzar-accent-light)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-3"
            >
              {isUploading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Folder size={18} />
              )}
              <span>Sélectionner un dossier</span>
            </button>
            
            <p className="text-sm text-[var(--anzar-text-muted)] mt-4">
              Note: Le drag & drop de dossiers natif n'est pas supporté par tous les navigateurs. 
              Utilisez le bouton de sélection pour plus de fiabilité.
            </p>
          </div>
        </div>

        {/* Informations du projet */}
        {selectedPath && (
          <div className="mb-8">
            <h3 className="text-lg font-medium text-[var(--anzar-text)] mb-4">Configurer le projet</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--anzar-text-secondary)] mb-2">
                  Nom du projet
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--anzar-border)] bg-[var(--anzar-surface)] text-[var(--anzar-text)] placeholder-[var(--anzar-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--anzar-accent)] focus:border-transparent"
                  placeholder="Mon projet incroyable"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-[var(--anzar-text-secondary)] mb-2">
                  Description (optionnelle)
                </label>
                <textarea
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[var(--anzar-border)] bg-[var(--anzar-surface)] text-[var(--anzar-text)] placeholder-[var(--anzar-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--anzar-accent)] focus:border-transparent resize-none"
                  placeholder="Description du projet..."
                  rows={3}
                />
              </div>
              
              <div className="bg-[var(--anzar-elevated)] border border-[var(--anzar-border)] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-[var(--anzar-text)]">Dossier sélectionné</span>
                  <span className="text-sm text-[var(--anzar-text-secondary)] truncate ml-2 max-w-xs">
                    {selectedPath}
                  </span>
                </div>
                <button
                  onClick={handleSelectFolder}
                  className="text-sm text-[var(--anzar-accent)] hover:underline flex items-center gap-1"
                >
                  <Folder size={14} />
                  Changer de dossier
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Barre de progression */}
        {isUploading && uploadProgress > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[var(--anzar-text)]">Upload en cours...</span>
              <span className="text-sm text-[var(--anzar-text-secondary)]">{uploadProgress}%</span>
            </div>
            <div className="h-2 bg-[var(--anzar-border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[var(--anzar-accent)] to-[var(--anzar-accent-light)] transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Message d'erreur */}
        {error && (
          <div className="mb-8 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-3">
              <AlertCircle size={18} className="text-red-400" />
              <span className="text-sm text-red-300">{error}</span>
            </div>
          </div>
        )}

        {/* Boutons d'action */}
        <div className="flex items-center justify-between pt-6 border-t border-[var(--anzar-border)]">
          <div className="text-sm text-[var(--anzar-text-secondary)]">
            {selectedPath
              ? 'Le projet sera importé dans ANZAR pour analyse et édition'
              : 'Sélectionnez un dossier pour continuer'}
          </div>
          
          <div className="flex items-center gap-3">
            {onClose && (
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl border border-[var(--anzar-border)] text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] hover:bg-[var(--anzar-elevated)] transition-colors"
              >
                Annuler
              </button>
            )}
            
            <button
              onClick={handleUploadProject}
              disabled={!selectedPath || isUploading}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-[var(--anzar-accent)] to-[var(--anzar-accent-light)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-3"
            >
              {isUploading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Upload en cours...</span>
                </>
              ) : (
                <>
                  <Upload size={18} />
                  <span>Uploader le projet</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Note informative */}
        <div className="mt-8 pt-6 border-t border-[var(--anzar-border)]">
          <div className="flex items-start gap-3 text-sm text-[var(--anzar-text-muted)]">
            <div className="p-2 rounded-lg bg-[var(--anzar-elevated)]">
              <Check size={16} />
            </div>
            <div>
              <p className="font-medium text-[var(--anzar-text-secondary)] mb-1">Fonctionnalités incluses</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Analyse complète de l'arborescence des fichiers</li>
                <li>Édition de code avec coloration syntaxique</li>
                <li>Recherche et remplacement dans tout le projet</li>
                <li>Analyse d'images avec ANZAR IA</li>
                <li>Création, modification et suppression de fichiers</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}