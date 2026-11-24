/**
 * Bandeau « Nouvelle version disponible » : visible en haut de l'app tant que l'utilisateur
 * n'a ni installé ni cliqué « Plus tard » (il revient au prochain lancement). Installation
 * en un clic : téléchargement avec progression, puis redémarrage d'ANZAR.
 * Si l'agent ou un travail de fond tourne, on demande confirmation avant de redémarrer.
 */
import { useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { dismissUpdate, installUpdateAndRelaunch, useUpdateStore } from '@/services/infra/updateService';
import { useChatStore } from '@/stores/chatStore';
import { hasBackgroundWork } from '@/services/background/status';

async function confirmerSiTravailEnCours(): Promise<boolean> {
  if (!useChatStore.getState().isGenerating && !hasBackgroundWork()) return true;
  try {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return await ask(
      "ANZAR travaille encore. Installer maintenant redémarre l'app et interrompt ce travail (tu pourras écrire « continue » ensuite).",
      { title: 'Installer la mise à jour ?', kind: 'warning', okLabel: 'Installer maintenant', cancelLabel: 'Attendre' },
    );
  } catch {
    return false;
  }
}

export default function UpdateBanner() {
  const { phase, version, notes, progress, dismissedVersion, error } = useUpdateStore();
  const [voirNotes, setVoirNotes] = useState(false);

  if (phase === 'idle') return null;
  if (phase === 'available' && dismissedVersion && dismissedVersion === version) return null;

  const enCours = phase === 'downloading' || phase === 'installing';
  const installer = async () => {
    if (!(await confirmerSiTravailEnCours())) return;
    await installUpdateAndRelaunch().catch(() => { /* l'erreur est affichée par le bandeau */ });
  };

  return (
    <div role="status" aria-live="polite" className="flex-shrink-0 border-b border-accent-primary/25 bg-accent-primary/10 px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Download size={14} className="flex-shrink-0 text-accent-primary" aria-hidden />
        <p className="min-w-0 flex-1 text-xs font-medium text-text-primary">
          {phase === 'error' && (error || "La mise à jour n'a pas pu être installée.")}
          {phase === 'available' && <>ANZAR {version} est disponible.</>}
          {phase === 'downloading' && <>Téléchargement d'ANZAR {version}{progress !== null ? ` · ${progress} %` : '…'}</>}
          {phase === 'installing' && <>Installation d'ANZAR {version}… l'app va redémarrer.</>}
        </p>
        {notes && phase === 'available' && (
          <button type="button" onClick={() => setVoirNotes((v) => !v)} aria-expanded={voirNotes}
            className="text-xs text-text-secondary underline-offset-2 hover:underline">
            {voirNotes ? 'Masquer les nouveautés' : 'Voir les nouveautés'}
          </button>
        )}
        {(phase === 'available' || phase === 'error') && (
          <button type="button" onClick={() => void installer()}
            className="rounded-md bg-accent-primary px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90">
            {phase === 'error' ? 'Réessayer' : 'Installer et redémarrer'}
          </button>
        )}
        {enCours && <Loader2 size={14} className="animate-spin text-accent-primary" aria-hidden />}
        {!enCours && (
          <button type="button" onClick={() => dismissUpdate()} aria-label="Plus tard"
            title="Plus tard (rappel au prochain lancement)"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary">
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      {phase === 'downloading' && progress !== null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-accent-primary/15" aria-hidden>
          <div className="h-full bg-accent-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      {voirNotes && notes && (
        <p className="mt-1.5 whitespace-pre-line text-xs text-text-secondary">{notes}</p>
      )}
    </div>
  );
}
