'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Save, AlertCircle, Loader2, FileText, FileCode, File, RefreshCw, Search, Replace, Maximize2, Minimize2 } from 'lucide-react';
import { useTauriFiles, FileContent } from '@/hooks/useTauriFiles';
import { useFileProjectStore } from '@/stores/fileProjectStore';
import SimpleCodeEditor from 'react-simple-code-editor';
import { highlight, languages } from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-graphql';
import 'prismjs/themes/prism-tomorrow.css';

interface BaseFileEditorProps {
  name: string;
  extension?: string;
  onClose: () => void;
  onSaved?: (path: string) => void;
}

interface SystemFileEditorProps extends BaseFileEditorProps {
  mode: 'system';
  path: string;
}

interface ProjectFileEditorProps extends BaseFileEditorProps {
  mode: 'project';
  projectId: string;
  filePath: string; // Chemin relatif dans le projet
  content?: string; // Contenu optionnel (si déjà chargé)
}

type FileEditorProps = SystemFileEditorProps | ProjectFileEditorProps;

// Extensions de fichiers éditables (fichiers texte)
const EDITABLE_EXTENSIONS = [
  'txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'scss', 'sass', 
  'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'zsh',
  'py', 'rb', 'php', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs', 'sql',
  'graphql', 'gql', 'vue', 'svelte', 'astro', 'env', 'gitignore', 'dockerfile'
];

// Obtenir l'icône selon l'extension
const getFileIcon = (extension?: string) => {
  if (!extension) return <File size={20} className="text-gray-400" />;
  
  const ext = extension.toLowerCase();
  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'java', 'cpp', 'c', 'go', 'rs', 'php', 'cs'];
  const markupExtensions = ['html', 'xml', 'md', 'json', 'yml', 'yaml', 'toml'];
  
  if (codeExtensions.includes(ext)) {
    return <FileCode size={20} className="text-blue-400" />;
  } else if (markupExtensions.includes(ext)) {
    return <FileText size={20} className="text-green-400" />;
  }
  
  return <File size={20} className="text-gray-400" />;
};

// Vérifier si un fichier est éditable
const isFileEditable = (extension?: string): boolean => {
  if (!extension) return false;
  return EDITABLE_EXTENSIONS.includes(extension.toLowerCase());
};

// Obtenir le langage Prism selon l'extension
const getPrismLanguage = (extension?: string) => {
  if (!extension) return languages.plain;
  
  const ext = extension.toLowerCase();
  const langMap: Record<string, any> = {
    'js': languages.javascript,
    'jsx': languages.javascript,
    'ts': languages.typescript,
    'tsx': languages.typescript,
    'html': languages.markup,
    'xml': languages.markup,
    'css': languages.css,
    'scss': languages.css,
    'sass': languages.css,
    'md': languages.markdown,
    'markdown': languages.markdown,
    'json': languages.json,
    'yml': languages.yaml,
    'yaml': languages.yaml,
    'toml': languages.toml,
    'ini': languages.ini,
    'cfg': languages.ini,
    'conf': languages.ini,
    'sh': languages.bash,
    'bash': languages.bash,
    'zsh': languages.bash,
    'py': languages.python,
    'rb': languages.ruby,
    'php': languages.php,
    'java': languages.java,
    'cpp': languages.cpp,
    'c': languages.c,
    'cs': languages.csharp,
    'go': languages.go,
    'rs': languages.rust,
    'sql': languages.sql,
    'graphql': languages.graphql,
    'gql': languages.graphql,
    'vue': languages.markup,
    'svelte': languages.markup,
    'astro': languages.markup,
    'dockerfile': languages.docker,
  };
  
  return langMap[ext] || languages.plain;
};

export default function FileEditor(props: FileEditorProps) {
  const { name, extension, onClose, onSaved } = props;
  const mode = props.mode || (('path' in props) ? 'system' : 'project');
  
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(mode === 'system' || !('content' in props));
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [replaceQuery, setReplaceQuery] = useState<string>('');
  const [fullscreen, setFullscreen] = useState<boolean>(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const { readFile, writeFile } = useTauriFiles();
  const { getFileContent, setFileContent, getFileProject } = useFileProjectStore();
  
  // Charger le contenu du fichier
  useEffect(() => {
    const loadFileContent = async () => {
      if (mode === 'project' && 'content' in props && props.content !== undefined) {
        // Contenu déjà fourni
        setContent(props.content);
        setOriginalContent(props.content);
        setLoading(false);
        return;
      }
      
      setLoading(true);
      setError(null);
      
      try {
        let fileContent: string;
        
        if (mode === 'system' && 'path' in props) {
          // Mode système: lire via Tauri
          const result: FileContent = await readFile(props.path);
          fileContent = result.content;
        } else if (mode === 'project' && 'projectId' in props) {
          // Mode projet: lire depuis le store ou depuis le système
          const storedContent = getFileContent(props.projectId, props.filePath);
          if (storedContent !== undefined) {
            fileContent = storedContent;
          } else {
            // Lire depuis le système de fichiers (projet local)
            const project = getFileProject(props.projectId);
            if (!project) {
              throw new Error('Projet non trouvé');
            }
            const absolutePath = `${project.rootPath}/${props.filePath}`;
            const result: FileContent = await readFile(absolutePath);
            fileContent = result.content;
            // Stocker le contenu dans le store pour les prochaines ouvertures
            setFileContent(props.projectId, props.filePath, fileContent);
          }
        } else {
          throw new Error('Mode de fichier invalide');
        }
        
        setContent(fileContent);
        setOriginalContent(fileContent);
      } catch (err: any) {
        setError(err.toString());
      } finally {
        setLoading(false);
      }
    };
    
    loadFileContent();
  }, [mode, props, readFile, getFileContent]);
  
  // Vérifier les changements
  useEffect(() => {
    setHasChanges(content !== originalContent);
  }, [content, originalContent]);
  
  // Gestion des raccourcis clavier
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S pour sauvegarder
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      
      // Ctrl+F pour rechercher
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      
      // Échap pour fermer la recherche ou l'éditeur
      if (e.key === 'Escape') {
        if (showSearch) {
          setShowSearch(false);
        } else if (!hasChanges) {
          onClose();
        }
      }
      
      // Ctrl+Enter pour basculer le mode plein écran
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        setFullscreen(!fullscreen);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch, hasChanges, onClose, fullscreen]);
  
  // Sauvegarder le fichier
  const handleSave = async () => {
    if (!hasChanges) return;
    
    setSaving(true);
    setError(null);
    
    try {
      if (mode === 'system' && 'path' in props) {
        // Mode système: écrire via Tauri
        await writeFile(props.path, content);
        onSaved?.(props.path);
      } else if (mode === 'project' && 'projectId' in props) {
        // Mode projet: écrire dans le store et sur le disque si local
        setFileContent(props.projectId, props.filePath, content);
        const project = getFileProject(props.projectId);
        if (project?.isLocal && project?.rootPath) {
          const absolutePath = `${project.rootPath}/${props.filePath}`;
          await writeFile(absolutePath, content);
        }
        onSaved?.(props.filePath);
      }
      
      setOriginalContent(content);
      setHasChanges(false);
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setSaving(false);
    }
  };
  
  // Rechercher dans le contenu
  const handleSearch = (direction: 'next' | 'prev') => {
    if (!searchQuery) return;
    
    // Implémentation basique de recherche (à améliorer)
    const textarea = editorRef.current?.querySelector('textarea');
    if (!textarea) return;
    
    const startPos = textarea.selectionStart;
    const contentLower = content.toLowerCase();
    const searchLower = searchQuery.toLowerCase();
    
    let index = -1;
    if (direction === 'next') {
      index = contentLower.indexOf(searchLower, startPos);
      if (index === -1 && startPos > 0) {
        index = contentLower.indexOf(searchLower, 0); // Boucler au début
      }
    } else {
      // Recherche vers l'arrière
      const beforeCursor = contentLower.substring(0, startPos);
      index = beforeCursor.lastIndexOf(searchLower);
    }
    
    if (index !== -1) {
      textarea.focus();
      textarea.setSelectionRange(index, index + searchQuery.length);
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  
  // Remplacer le texte
  const handleReplace = () => {
    if (!searchQuery) return;
    
    const firstMatchIndex = content.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (firstMatchIndex === -1) return;
    
    const newContent = content.substring(0, firstMatchIndex) + 
                      replaceQuery + 
                      content.substring(firstMatchIndex + searchQuery.length);
    setContent(newContent);
    
    // Rechercher le prochain match automatiquement
    setTimeout(() => handleSearch('next'), 0);
  };
  
  // Remplacer tout
  const handleReplaceAll = () => {
    if (!searchQuery) return;
    
    const regex = new RegExp(searchQuery, 'gi');
    const newContent = content.replace(regex, replaceQuery);
    setContent(newContent);
  };
  
  // Obtenir le chemin d'affichage
  const getDisplayPath = () => {
    if (mode === 'system' && 'path' in props) {
      return props.path;
    } else if (mode === 'project' && 'projectId' in props) {
      return props.filePath;
    }
    return '';
  };
  
  // Obtenir l'identifiant unique pour la sauvegarde
  const getSaveId = () => {
    if (mode === 'system' && 'path' in props) {
      return `system:${props.path}`;
    } else if (mode === 'project' && 'projectId' in props) {
      return `project:${props.projectId}:${props.filePath}`;
    }
    return '';
  };
  
  if (!isFileEditable(extension)) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-[var(--anzar-surface)] border border-[var(--anzar-border)] rounded-2xl p-8 max-w-md w-full">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              {getFileIcon(extension)}
              <div>
                <h3 className="text-lg font-medium text-[var(--anzar-text)]">{name}</h3>
                <p className="text-sm text-[var(--anzar-text-secondary)]">Type de fichier non éditable</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:bg-[var(--anzar-elevated)] transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          
          <div className="p-6 rounded-xl bg-[var(--anzar-elevated)] border border-[var(--anzar-border)] text-center">
            <AlertCircle size={48} className="text-yellow-400 mx-auto mb-4" />
            <h4 className="text-lg font-medium text-[var(--anzar-text)] mb-2">Fichier non éditable</h4>
            <p className="text-[var(--anzar-text-secondary)]">
              Ce type de fichier ({extension || 'inconnu'}) ne peut pas être édité dans l'éditeur de texte.
              Seuls les fichiers texte et code sont supportés.
            </p>
          </div>
          
          <div className="flex justify-end mt-6">
            <button
              onClick={onClose}
              className="px-4 py-3 rounded-xl border border-[var(--anzar-border)] text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] transition-colors"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-[var(--anzar-surface)] ${fullscreen ? '' : 'p-4'}`}>
      {/* En-tête */}
      <div className={`flex items-center justify-between p-6 border-b border-[var(--anzar-border)] ${fullscreen ? 'bg-[var(--anzar-surface)]' : 'bg-[var(--anzar-surface)] rounded-t-2xl'}`}>
        <div className="flex items-center gap-4">
          {getFileIcon(extension)}
          <div>
            <h3 className="text-lg font-medium text-[var(--anzar-text)]">{name}</h3>
            <p className="text-sm text-[var(--anzar-text-secondary)] truncate max-w-lg" title={getDisplayPath()}>
              {getDisplayPath()}
            </p>
          </div>
          
          {mode === 'project' && 'projectId' in props && (
            <span className="px-2 py-1 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Projet
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Indicateur de changement */}
          {hasChanges && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-xs font-medium text-yellow-400">Non sauvegardé</span>
            </div>
          )}
          
          {/* Bouton plein écran */}
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-2 rounded-lg text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:bg-[var(--anzar-elevated)] transition-colors"
            aria-label={fullscreen ? "Quitter le mode plein écran" : "Mode plein écran"}
          >
            {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          
          {/* Bouton fermer */}
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[var(--anzar-text-secondary)] hover:text-red-400 hover:bg-red-500/5 transition-colors"
            aria-label="Fermer"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      
      {/* Barre d'outils */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--anzar-border)] bg-[var(--anzar-surface)]">
        <div className="flex items-center gap-3">
          {/* Bouton sauvegarder */}
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving || loading}
            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all ${
              hasChanges
                ? 'bg-gradient-to-r from-[var(--anzar-accent)] to-[var(--anzar-accent-light)] text-white hover:opacity-90'
                : 'bg-[var(--anzar-elevated)] text-[var(--anzar-text-secondary)] cursor-not-allowed'
            } ${saving ? 'opacity-70' : ''}`}
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            <span className="text-sm font-medium">
              {saving ? 'Sauvegarde...' : hasChanges ? 'Sauvegarder' : 'Sauvegardé'}
            </span>
          </button>
          
          {/* Raccourci clavier */}
          <div className="px-3 py-1.5 rounded-lg bg-[var(--anzar-elevated)] border border-[var(--anzar-border)]">
            <span className="text-xs text-[var(--anzar-text-muted)]">Ctrl+S</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Bouton recherche */}
          <button
            onClick={() => {
              setShowSearch(!showSearch);
              if (!showSearch) {
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }
            }}
            className={`px-3 py-2 rounded-lg flex items-center gap-2 ${
              showSearch
                ? 'bg-[var(--anzar-accent)]/10 border border-[var(--anzar-accent)]/20 text-[var(--anzar-accent)]'
                : 'text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:bg-[var(--anzar-elevated)]'
            } transition-colors`}
          >
            <Search size={16} />
            <span className="text-sm">Rechercher</span>
          </button>
          
          {/* Bouton actualiser */}
          <button
            onClick={() => {
              setContent(originalContent);
              setHasChanges(false);
            }}
            disabled={!hasChanges || loading}
            className="p-2 rounded-lg text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:bg-[var(--anzar-elevated)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Annuler les modifications"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      
      {/* Barre de recherche/remplacement */}
      {showSearch && (
        <div className="px-6 py-4 border-b border-[var(--anzar-border)] bg-[var(--anzar-elevated)]">
          <div className="flex items-center gap-4">
            <div className="flex-1 flex items-center gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--anzar-text-muted)]" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full pl-10 pr-4 py-2 bg-[var(--anzar-surface)] border border-[var(--anzar-border)] rounded-lg text-[var(--anzar-text)] placeholder-[var(--anzar-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--anzar-accent)] focus:border-transparent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch('next');
                    if (e.key === 'F3') handleSearch(e.shiftKey ? 'prev' : 'next');
                  }}
                />
              </div>
              
              <div className="relative flex-1">
                <Replace size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--anzar-text-muted)]" />
                <input
                  type="text"
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  placeholder="Remplacer par..."
                  className="w-full pl-10 pr-4 py-2 bg-[var(--anzar-surface)] border border-[var(--anzar-border)] rounded-lg text-[var(--anzar-text)] placeholder-[var(--anzar-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--anzar-accent)] focus:border-transparent"
                />
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSearch('prev')}
                className="px-3 py-2 rounded-lg border border-[var(--anzar-border)] text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] transition-colors text-sm"
                title="Rechercher précédent (Shift+F3)"
              >
                Précédent
              </button>
              <button
                onClick={() => handleSearch('next')}
                className="px-3 py-2 rounded-lg border border-[var(--anzar-border)] text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] transition-colors text-sm"
                title="Rechercher suivant (F3)"
              >
                Suivant
              </button>
              <button
                onClick={handleReplace}
                className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-colors text-sm"
              >
                Remplacer
              </button>
              <button
                onClick={handleReplaceAll}
                className="px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-colors text-sm"
              >
                Tout remplacer
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Éditeur */}
      <div className="flex-1 overflow-hidden relative" ref={editorRef}>
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Loader2 size={32} className="text-[var(--anzar-accent)] animate-spin mx-auto mb-4" />
              <p className="text-[var(--anzar-text-secondary)]">Chargement du fichier...</p>
            </div>
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="max-w-md text-center">
              <div className="p-4 rounded-full bg-red-500/10 border border-red-500/30 inline-block mb-4">
                <AlertCircle size={32} className="text-red-400" />
              </div>
              <h4 className="text-lg font-medium text-[var(--anzar-text)] mb-2">Erreur de chargement</h4>
              <p className="text-[var(--anzar-text-secondary)] mb-6">{error}</p>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-[var(--anzar-border)] text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : (
          <SimpleCodeEditor
            value={content}
            onValueChange={(code) => setContent(code)}
            highlight={(code) => highlight(code, getPrismLanguage(extension), extension || 'txt')}
            padding={16}
            className="h-full w-full font-mono text-sm bg-transparent text-[var(--anzar-text)] overflow-auto"
            textareaClassName="outline-none resize-none"
            preClassName="!m-0"
            style={{
              minHeight: '100%',
              backgroundColor: 'transparent',
            }}
          />
        )}
      </div>
      
      {/* Pied de page */}
      <div className="px-6 py-3 border-t border-[var(--anzar-border)] bg-[var(--anzar-surface)] text-sm text-[var(--anzar-text-muted)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span>{content.length} caractères</span>
            <span>{content.split('\n').length} lignes</span>
            {extension && <span>{extension.toUpperCase()}</span>}
          </div>
          <div className="flex items-center gap-4">
            <span>Mode: {mode === 'system' ? 'Système' : 'Projet'}</span>
            <span>UTF-8</span>
          </div>
        </div>
      </div>
    </div>
  );
}