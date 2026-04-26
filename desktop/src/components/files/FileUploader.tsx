'use client';

import { useState, useCallback } from 'react';
import { Upload, File, Image, X, AlertCircle, Check, Loader2, Eye, Trash2, Download, Brain, Sparkles } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useAnzarIA } from '@/hooks/useAnzarIA';



interface UploadedFile {
  id: string;
  file: File;
  preview?: string;
  size: number;
  type: string;
  uploadDate: Date;
  status: 'uploading' | 'success' | 'error';
  error?: string;
}

interface FileUploaderProps {
  onUpload?: (files: UploadedFile[]) => void;
  onAnalyze?: (file: UploadedFile) => void;
  maxFiles?: number;
  maxSize?: number; // en bytes
  acceptedFileTypes?: string[];
}

export default function FileUploader({
  onUpload,
  onAnalyze,
  maxFiles = 10,
  maxSize = 10 * 1024 * 1024, // 10 MB
  acceptedFileTypes = ['image/*', 'application/pdf', 'text/plain', 'application/json']
}: FileUploaderProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzingFile, setAnalyzingFile] = useState<UploadedFile | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any /* AIAnalysisResult */ | null>(null);
  
  const { analyzeImage, analyzeDocument, isAnalyzing, error: aiError, clearError } = useAnzarIA();

  const onDrop = useCallback(async (acceptedFiles: File[], fileRejections: any[]) => {
    setError(null);
    
    // Gérer les rejets
    if (fileRejections.length > 0) {
      const reasons = fileRejections.map(rejection => {
        const file = rejection.file;
        const errors = rejection.errors.map(err => err.message).join(', ');
        return `${file.name}: ${errors}`;
      }).join('; ');
      setError(`Certains fichiers ont été rejetés: ${reasons}`);
    }
    
    // Limiter le nombre total de fichiers
    const remainingSlots = maxFiles - uploadedFiles.length;
    if (remainingSlots <= 0) {
      setError(`Limite de ${maxFiles} fichiers atteinte. Supprimez des fichiers pour en ajouter d'autres.`);
      return;
    }
    
    const filesToUpload = acceptedFiles.slice(0, remainingSlots);
    
    // Créer les objets UploadedFile
    const newFiles: UploadedFile[] = filesToUpload.map(file => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      
      return {
        id,
        file,
        preview,
        size: file.size,
        type: file.type,
        uploadDate: new Date(),
        status: 'uploading'
      };
    });
    
    // Ajouter aux fichiers uploadés
    setUploadedFiles(prev => [...prev, ...newFiles]);
    setUploading(true);
    
    // Simuler l'upload (à remplacer par une vraie API)
    setTimeout(() => {
      setUploadedFiles(prev => prev.map(f => 
        newFiles.some(nf => nf.id === f.id) 
          ? { ...f, status: 'success' }
          : f
      ));
      setUploading(false);
      
      // Appeler le callback
      const updatedFiles = [...uploadedFiles, ...newFiles.map(f => ({ ...f, status: 'success' as const }))];
      onUpload?.(updatedFiles);
    }, 1000);
  }, [maxFiles, uploadedFiles, onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles,
    maxSize,
    accept: acceptedFileTypes.reduce((acc, type) => ({ ...acc, [type]: [] }), {}),
    disabled: uploading || uploadedFiles.length >= maxFiles
  });

  // Supprimer un fichier
  const handleRemoveFile = (id: string) => {
    const fileToRemove = uploadedFiles.find(f => f.id === id);
    if (fileToRemove?.preview) {
      URL.revokeObjectURL(fileToRemove.preview);
    }
    setUploadedFiles(prev => prev.filter(f => f.id !== id));
  };

  // Analyser un fichier avec ANZAR IA
  const handleAnalyzeFile = async (file: UploadedFile) => {
    setAnalyzingFile(file);
    setAnalysisResult(null);
    clearError();
    
    let result: any /* AIAnalysisResult */;
    if (file.type.startsWith('image/')) {
      result = await analyzeImage(file.file, 'Décris cette image en détail.');
    } else if (file.type.includes('pdf') || file.type.includes('text')) {
      result = await analyzeDocument(file.file, 'Analyse ce document:');
    } else {
      result = {
        success: false,
        error: 'Type de fichier non supporté pour l\'analyse',
        timestamp: Date.now(),
      };
    }
    
    setAnalysisResult(result);
    onAnalyze?.(file);
  };

  // Fermer le modal d'analyse
  const handleCloseAnalysis = () => {
    setAnalyzingFile(null);
    setAnalysisResult(null);
    clearError();
  };

  // Formater la taille
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Formater la date
  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Obtenir l'icône selon le type de fichier
  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) {
      return <Image size={20} className="text-green-400" />;
    } else if (type.includes('pdf')) {
      return <File size={20} className="text-red-400" />;
    } else if (type.includes('json')) {
      return <File size={20} className="text-yellow-400" />;
    } else if (type.includes('text')) {
      return <File size={20} className="text-blue-400" />;
    }
    return <File size={20} className="text-gray-400" />;
  };

  // Télécharger un fichier
  const handleDownloadFile = (file: UploadedFile) => {
    const url = URL.createObjectURL(file.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Aperçu d'un fichier
  const handlePreviewFile = (file: UploadedFile) => {
    if (file.preview) {
      window.open(file.preview, '_blank');
    } else {
      const url = URL.createObjectURL(file.file);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Zone de drop */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
          isDragActive
            ? 'border-[var(--anzar-accent)] bg-[var(--anzar-accent)]/10'
            : 'border-[var(--anzar-border)] bg-[var(--anzar-surface)] hover:border-[var(--anzar-accent)] hover:bg-[var(--anzar-accent)]/5'
        } ${uploading || uploadedFiles.length >= maxFiles ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input {...getInputProps()} />
        
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 rounded-full bg-gradient-to-br from-[var(--anzar-accent)]/10 to-[var(--anzar-accent-light)]/10 border border-[var(--anzar-accent)]/20">
            <Upload size={32} className="text-[var(--anzar-accent)]" />
          </div>
          
          <div>
            <h3 className="text-lg font-medium text-[var(--anzar-text)] mb-2">
              {isDragActive ? 'Déposez les fichiers ici' : 'Glissez-déposez vos fichiers'}
            </h3>
            <p className="text-[var(--anzar-text-secondary)] mb-4">
              ou cliquez pour sélectionner
            </p>
          </div>
          
          <div className="text-sm text-[var(--anzar-text-muted)]">
            <p>Types supportés: Images, PDF, texte, JSON</p>
            <p>Taille max: {formatSize(maxSize)} • Max {maxFiles} fichiers</p>
          </div>
        </div>
      </div>

      {/* Message d'erreur */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-3">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Erreur d'upload</p>
            <p className="text-sm">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="p-1 hover:text-red-300">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Liste des fichiers uploadés */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-[var(--anzar-text)]">
              Fichiers uploadés ({uploadedFiles.length}/{maxFiles})
            </h3>
            {uploadedFiles.length > 0 && (
              <button
                onClick={() => setUploadedFiles([])}
                className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors text-sm"
              >
                Tout supprimer
              </button>
            )}
          </div>
          
          <div className="grid gap-3">
            {uploadedFiles.map((uploadedFile) => (
              <div
                key={uploadedFile.id}
                className={`p-4 rounded-xl border transition-all ${
                  uploadedFile.status === 'error'
                    ? 'border-red-500/30 bg-red-500/5'
                    : uploadedFile.status === 'uploading'
                    ? 'border-yellow-500/30 bg-yellow-500/5'
                    : 'border-[var(--anzar-border)] bg-[var(--anzar-surface)] hover:border-[var(--anzar-accent)]/30'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Icône ou aperçu */}
                  <div className="flex-shrink-0">
                    {uploadedFile.preview ? (
                      <div className="w-16 h-16 rounded-lg overflow-hidden border border-[var(--anzar-border)] bg-[var(--anzar-elevated)]">
                        <img
                          src={uploadedFile.preview}
                          alt={uploadedFile.file.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-lg border border-[var(--anzar-border)] bg-[var(--anzar-elevated)] flex items-center justify-center">
                        {getFileIcon(uploadedFile.type)}
                      </div>
                    )}
                  </div>
                  
                  {/* Infos du fichier */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium text-[var(--anzar-text)] truncate">
                          {uploadedFile.file.name}
                        </h4>
                        <div className="flex items-center gap-3 mt-2 text-sm text-[var(--anzar-text-muted)]">
                          <span>{formatSize(uploadedFile.size)}</span>
                          <span>•</span>
                          <span>{formatDate(uploadedFile.uploadDate)}</span>
                          <span>•</span>
                          <span className="px-2 py-0.5 rounded-md bg-[var(--anzar-elevated)] text-xs">
                            {uploadedFile.type.split('/')[1] || uploadedFile.type}
                          </span>
                        </div>
                      </div>
                      
                      {/* Statut */}
                      <div className="flex items-center gap-2">
                        {uploadedFile.status === 'uploading' && (
                          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                            <Loader2 size={12} className="animate-spin" />
                            <span className="text-xs text-yellow-400">En cours</span>
                          </div>
                        )}
                        {uploadedFile.status === 'success' && (
                          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-green-500/10 border border-green-500/20">
                            <Check size={12} />
                            <span className="text-xs text-green-400">Réussi</span>
                          </div>
                        )}
                        {uploadedFile.status === 'error' && (
                          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20">
                            <AlertCircle size={12} />
                            <span className="text-xs text-red-400">Erreur</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-4">
                      {uploadedFile.status === 'success' && (
                        <>
                          {uploadedFile.preview && (
                            <button
                              onClick={() => handlePreviewFile(uploadedFile)}
                              className="px-3 py-1.5 rounded-lg border border-[var(--anzar-border)] text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] transition-colors text-sm flex items-center gap-2"
                            >
                              <Eye size={14} />
                              Aperçu
                            </button>
                          )}
                          <button
                            onClick={() => handleDownloadFile(uploadedFile)}
                            className="px-3 py-1.5 rounded-lg border border-[var(--anzar-border)] text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] transition-colors text-sm flex items-center gap-2"
                          >
                            <Download size={14} />
                            Télécharger
                          </button>
                          <button
                            onClick={() => handleAnalyzeFile(uploadedFile)}
                            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:opacity-90 transition-opacity text-sm flex items-center gap-2"
                          >
                            <Image size={14} />
                            Analyser avec ANZAR IA
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleRemoveFile(uploadedFile.id)}
                        className="ml-auto p-2 rounded-lg text-[var(--anzar-text-secondary)] hover:text-red-400 hover:bg-red-500/5 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Message d'erreur */}
                {uploadedFile.error && (
                  <div className="mt-3 pt-3 border-t border-red-500/20">
                    <p className="text-sm text-red-400">{uploadedFile.error}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aperçu de l'analyse */}
      {uploadedFiles.some(f => f.status === 'success') && !analyzingFile && (
        <div className="p-6 rounded-2xl border border-[var(--anzar-border)] bg-[var(--anzar-surface)]">
          <h3 className="text-lg font-medium text-[var(--anzar-text)] mb-4">Analyse ANZAR IA</h3>
          <div className="space-y-4">
            <p className="text-[var(--anzar-text-secondary)]">
              Cliquez sur "Analyser avec ANZAR IA" pour utiliser l'API ANZAR IA avec votre clé API.
              L'analyse peut détecter des objets, du texte, des scènes dans les images, ou extraire du contenu des documents.
            </p>
            <div className="p-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20">
              <div className="flex items-center gap-3">
                <AlertCircle size={20} className="text-blue-400" />
                <div>
                  <p className="font-medium text-[var(--anzar-text)]">API ANZAR IA</p>
                  <p className="text-sm text-[var(--anzar-text-secondary)]">
                    Configurez votre clé API dans les paramètres pour activer l'analyse d'images.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal d'analyse ANZAR IA */}
      {analyzingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--anzar-surface)] border border-[var(--anzar-border)] rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-[var(--anzar-border)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20">
                    <Brain size={20} className="text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-[var(--anzar-text)]">Analyse ANZAR IA</h3>
                    <p className="text-sm text-[var(--anzar-text-secondary)]">
                      {analyzingFile.file.name}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCloseAnalysis}
                  className="p-2 rounded-lg text-[var(--anzar-text-secondary)] hover:text-red-400 hover:bg-red-500/5 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 size={32} className="text-[var(--anzar-accent)] animate-spin mb-4" />
                  <p className="text-[var(--anzar-text)]">Analyse en cours...</p>
                  <p className="text-sm text-[var(--anzar-text-secondary)] mt-2">
                    L'analyse peut prendre quelques secondes.
                  </p>
                </div>
              ) : aiError ? (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={20} className="text-red-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-400">Erreur d'analyse</p>
                      <p className="text-sm text-red-300 mt-1">{aiError}</p>
                    </div>
                  </div>
                </div>
              ) : analysisResult ? (
                <div className="space-y-6">
                  <div className={`p-4 rounded-xl ${
                    analysisResult.success
                      ? 'bg-green-500/10 border border-green-500/20'
                      : 'bg-red-500/10 border border-red-500/20'
                  }`}>
                    <div className="flex items-center gap-3 mb-3">
                      {analysisResult.success ? (
                        <>
                          <Sparkles size={20} className="text-green-400" />
                          <h4 className="font-medium text-[var(--anzar-text)]">Analyse réussie</h4>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={20} className="text-red-400" />
                          <h4 className="font-medium text-[var(--anzar-text)]">Analyse échouée</h4>
                        </>
                      )}
                    </div>
                    {analysisResult.success ? (
                      <div className="prose prose-invert max-w-none">
                        <p className="text-[var(--anzar-text)] whitespace-pre-wrap">{analysisResult.data}</p>
                      </div>
                    ) : (
                      <p className="text-red-300">{analysisResult.error}</p>
                    )}
                  </div>
                  
                  {analysisResult.success && (
                    <div className="pt-4 border-t border-[var(--anzar-border)]">
                      <h4 className="font-medium text-[var(--anzar-text)] mb-3">Informations</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-[var(--anzar-text-secondary)]">Fichier</p>
                          <p className="text-[var(--anzar-text)]">{analyzingFile.file.name}</p>
                        </div>
                        <div>
                          <p className="text-[var(--anzar-text-secondary)]">Type</p>
                          <p className="text-[var(--anzar-text)]">{analyzingFile.type}</p>
                        </div>
                        <div>
                          <p className="text-[var(--anzar-text-secondary)]">Taille</p>
                          <p className="text-[var(--anzar-text)]">{formatSize(analyzingFile.size)}</p>
                        </div>
                        <div>
                          <p className="text-[var(--anzar-text-secondary)]">Date d'analyse</p>
                          <p className="text-[var(--anzar-text)]">
                            {new Date(analysisResult.timestamp).toLocaleString('fr-FR')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            
            <div className="p-6 border-t border-[var(--anzar-border)] bg-[var(--anzar-elevated)]">
              <div className="flex items-center justify-between">
                <button
                  onClick={handleCloseAnalysis}
                  className="px-4 py-2 rounded-lg border border-[var(--anzar-border)] text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:border-[var(--anzar-accent)] transition-colors"
                >
                  Fermer
                </button>
                {analysisResult?.success && (
                  <button
                    onClick={() => navigator.clipboard.writeText(analysisResult.data || '')}
                    className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:opacity-90 transition-opacity"
                  >
                    Copier le résultat
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
