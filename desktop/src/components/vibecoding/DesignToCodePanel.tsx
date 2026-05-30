/**
 * DesignToCodePanel — Panneau de conversion design → code dans le VibeCoding Studio.
 *
 * Inspiré de TRAE SOLO Semi D2C:
 *  - Zone de drop/upload d'image ou champ URL
 *  - Sélection du framework cible (HTML, React, Vue)
 *  - Sélection du mode CSS (Tailwind, CSS Modules, etc.)
 *  - Preview de l'image uploadée
 *  - Bouton de génération avec progression
 *  - Instructions optionnelles
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Upload, Image as ImageIcon, X, Sparkles, Loader2,
  Code2, Paintbrush, Smartphone, Link2, AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { designToCode } from '@/services/studio/designToCode';
import type { DesignToCodeRequest, DesignAnalysis } from '@/services/studio/designToCode';
import type { OnAgentUpdate } from '@/services/projectGeneration';

// ============================================================================
// TYPES
// ============================================================================

interface DesignToCodePanelProps {
  projectId: string;
  projectName: string;
  existingFiles?: Record<string, string>;
  onFilesGenerated: (files: Record<string, string>) => void;
  onUpdate: OnAgentUpdate;
  disabled?: boolean;
}

type Framework = 'html' | 'react' | 'vue';
type CssMode = 'tailwind' | 'css-modules' | 'inline' | 'vanilla';

// ============================================================================
// FRAMEWORK OPTIONS
// ============================================================================

const FRAMEWORKS: Array<{ id: Framework; label: string; icon: string }> = [
  { id: 'html', label: 'HTML', icon: '🌐' },
  { id: 'react', label: 'React', icon: '⚛️' },
  { id: 'vue', label: 'Vue', icon: '💚' },
];

const CSS_MODES: Array<{ id: CssMode; label: string }> = [
  { id: 'tailwind', label: 'Tailwind' },
  { id: 'css-modules', label: 'CSS Modules' },
  { id: 'vanilla', label: 'CSS Vanilla' },
  { id: 'inline', label: 'Inline' },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const DesignToCodePanel: React.FC<DesignToCodePanelProps> = ({
  projectId,
  projectName,
  existingFiles,
  onFilesGenerated,
  onUpdate,
  disabled,
}) => {
  // Image state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Config state
  const [framework, setFramework] = useState<Framework>('react');
  const [cssMode, setCssMode] = useState<CssMode>('tailwind');
  const [responsive, setResponsive] = useState(true);
  const [instructions, setInstructions] = useState('');

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [analysis, setAnalysis] = useState<DesignAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number; tokens: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Image handling ──

  const handleFile = useCallback(async (file: File) => {
    const validation = designToCode.validateImage(file);
    if (!validation.valid) {
      setError(validation.error || 'Image invalide');
      return;
    }

    // Preview
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    setError(null);
    setResult(null);
    setAnalysis(null);

    // Base64
    const base64 = await designToCode.fileToBase64(file);
    setImageBase64(base64);
    setImageUrl('');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const clearImage = useCallback(() => {
    setImagePreview(null);
    setImageBase64(null);
    setImageUrl('');
    setError(null);
    setResult(null);
    setAnalysis(null);
  }, []);

  // ── Generation ──

  const handleGenerate = useCallback(async () => {
    if (isGenerating || (!imageBase64 && !imageUrl)) return;

    setIsGenerating(true);
    setError(null);
    setResult(null);
    setAnalysis(null);
    setProgress('Démarrage...');

    abortRef.current = new AbortController();

    try {
      const d2cResult = await designToCode.convert(
        projectId,
        {
          imageData: imageBase64 || undefined,
          imageUrl: imageUrl || undefined,
          framework,
          cssMode,
          responsive,
          instructions: instructions || undefined,
          existingFiles,
        },
        (update: import('@/services/projectGeneration').ExecutionEvent) => {
          onUpdate(update);
          if (update.type === 'step') {
            setProgress((update as any).label || 'En cours...');
          }
        },
        abortRef.current.signal,
      );

      if (d2cResult.success) {
        setResult({ count: Object.keys(d2cResult.files).length, tokens: d2cResult.tokensUsed || 0 });
        if (d2cResult.analysis) setAnalysis(d2cResult.analysis);
        onFilesGenerated(d2cResult.files);
      } else {
        setError(d2cResult.error || 'Échec de la génération');
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message || 'Erreur inattendue');
      }
    } finally {
      setIsGenerating(false);
      setProgress('');
    }
  }, [imageBase64, imageUrl, framework, cssMode, responsive, instructions, projectId, existingFiles, onUpdate, onFilesGenerated, isGenerating]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const hasImage = !!imageBase64 || !!imageUrl;

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-2">
          <Paintbrush size={14} className="text-accent-primary" />
          <span className="text-[11px] font-bold text-text-primary uppercase tracking-wider">
            Design → Code
          </span>
        </div>
      </div>

      <div className="flex-1 px-3 py-3 space-y-3">
        {/* ── Drop zone / Image preview ── */}
        {!imagePreview ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all',
              isDragOver
                ? 'border-accent-primary bg-accent-primary/5'
                : 'border-border-subtle hover:border-accent-primary/40 hover:bg-bg-tertiary/50',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            <Upload size={28} className="mx-auto mb-2 text-text-muted" />
            <p className="text-[12px] font-medium text-text-primary mb-1">
              Glisse une image ou clique pour uploader
            </p>
            <p className="text-[10px] text-text-muted">
              PNG, JPEG, WebP • Max 10 Mo
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        ) : (
          <div className="relative rounded-xl overflow-hidden border border-border-subtle">
            <img
              src={imagePreview}
              alt="Design preview"
              className="w-full max-h-[200px] object-contain bg-bg-tertiary"
            />
            <button
              onClick={clearImage}
              className="absolute top-2 right-2 p-1 rounded-full bg-bg-primary/80 hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── URL input (alternative) ── */}
        {!imageBase64 && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-medium mb-1 block">
              Ou colle une URL d'image
            </label>
            <div className="flex items-center gap-1.5">
              <Link2 size={13} className="text-text-muted flex-shrink-0" />
              <input
                type="url"
                value={imageUrl}
                onChange={e => { setImageUrl(e.target.value); setError(null); setResult(null); }}
                placeholder="https://..."
                className="flex-1 px-2 py-1.5 bg-bg-tertiary border border-border-subtle rounded-lg text-[12px] text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
              />
            </div>
          </div>
        )}

        {/* ── Framework selector ── */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-medium mb-1.5 block">
            Framework cible
          </label>
          <div className="flex gap-1.5">
            {FRAMEWORKS.map(fw => (
              <button
                key={fw.id}
                onClick={() => setFramework(fw.id)}
                className={cn(
                  'flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all text-center',
                  framework === fw.id
                    ? 'bg-accent-primary/10 text-accent-primary border border-accent-primary/20'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-secondary border border-transparent',
                )}
              >
                {fw.icon} {fw.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── CSS mode selector ── */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-medium mb-1.5 block">
            Mode CSS
          </label>
          <div className="flex flex-wrap gap-1">
            {CSS_MODES.map(cm => (
              <button
                key={cm.id}
                onClick={() => setCssMode(cm.id)}
                className={cn(
                  'px-2 py-1 rounded-md text-[10px] font-medium transition-all',
                  cssMode === cm.id
                    ? 'bg-accent-primary/10 text-accent-primary border border-accent-primary/20'
                    : 'text-text-muted hover:text-text-secondary hover:bg-bg-tertiary',
                )}
              >
                {cm.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Responsive toggle ── */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={responsive}
            onChange={e => setResponsive(e.target.checked)}
            className="rounded border-border-subtle text-accent-primary focus:ring-accent-primary/50"
          />
          <Smartphone size={13} className="text-text-muted" />
          <span className="text-[11px] text-text-secondary">Responsive mobile-first</span>
        </label>

        {/* ── Instructions ── */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-medium mb-1 block">
            Instructions (optionnel)
          </label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="Ex: Utilise des couleurs sombres, ajoute un header sticky..."
            rows={2}
            className="w-full px-2 py-1.5 bg-bg-tertiary border border-border-subtle rounded-lg text-[12px] text-text-primary placeholder-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
          />
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-red-500/5 border border-red-500/10">
            <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-400">{error}</p>
          </div>
        )}

        {/* ── Success ── */}
        {result && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
            <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] text-emerald-400 font-medium">
                {result.count} fichier{result.count > 1 ? 's' : ''} généré{result.count > 1 ? 's' : ''} !
              </p>
              {analysis && analysis.components.length > 0 && (
                <p className="text-[10px] text-text-muted mt-0.5">
                  Composants: {analysis.components.slice(0, 5).join(', ')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Progress ── */}
        {isGenerating && (
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-accent-primary/5 border border-accent-primary/10">
            <Loader2 size={14} className="text-accent-primary animate-spin flex-shrink-0" />
            <span className="text-[11px] text-text-primary">{progress}</span>
          </div>
        )}

        {/* ── Generate button ── */}
        <button
          onClick={isGenerating ? handleCancel : handleGenerate}
          disabled={!hasImage || (disabled && !isGenerating)}
          className={cn(
            'w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all flex items-center justify-center gap-2',
            isGenerating
              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
              : hasImage
                ? 'gradient-bg text-white hover:opacity-90'
                : 'bg-bg-tertiary text-text-muted cursor-not-allowed',
          )}
        >
          {isGenerating ? (
            <>
              <X size={16} />
              Annuler
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Générer le code
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default DesignToCodePanel;
