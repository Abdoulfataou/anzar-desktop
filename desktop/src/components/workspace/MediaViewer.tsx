/**
 * Affiche une image, un GIF ou une vidéo du projet (exports de l'agent : export_animation,
 * visuels pour les réseaux…) au lieu de l'ouvrir comme du texte.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const MAX_BYTES = 300 * 1024 * 1024;

export const isMediaFile = (path: string) => IMAGE.test(path) || VIDEO.test(path);

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

export default function MediaViewer({ absPath, name, version }: { absPath: string; name: string; version?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setError(null);
    (async () => {
      try {
        const { readBinaryFile } = await import('@tauri-apps/api/fs');
        const bytes = await readBinaryFile(absPath);
        if (bytes.byteLength > MAX_BYTES) throw new Error('fichier trop lourd pour l\'aperçu (300 Mo au plus)');
        const ext = name.split('.').pop()?.toLowerCase() || '';
        objectUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: MIME[ext] || 'application/octet-stream' }));
        if (!alive) { URL.revokeObjectURL(objectUrl); return; }
        setSize(bytes.byteLength);
        setUrl(objectUrl);
      } catch (e: any) {
        if (alive) setError(e?.message || 'lecture impossible');
      }
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [absPath, name, version]);

  if (error) {
    return <div className="flex items-center justify-center h-full text-text-muted text-ui-caption">Aperçu impossible : {error}</div>;
  }
  if (!url) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-ui-caption">
        <Loader2 size={14} className="animate-spin mr-2" /> Chargement…
      </div>
    );
  }
  const mo = size >= 1048576 ? `${(size / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(size / 1024))} Ko`;
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 bg-[repeating-conic-gradient(var(--color-bg-tertiary)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
        {VIDEO.test(name) ? (
          <video src={url} controls loop autoPlay muted playsInline className="max-w-full max-h-full rounded-md shadow-md" />
        ) : (
          <img src={url} alt={name} className="max-w-full max-h-full object-contain rounded-md shadow-md" />
        )}
      </div>
      <div className="px-3 py-1.5 border-t border-border-subtle text-ui-caption text-text-muted flex justify-between gap-2">
        <span className="truncate">{name}</span>
        <span className="whitespace-nowrap">{mo}</span>
      </div>
    </div>
  );
}
