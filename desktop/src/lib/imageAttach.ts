/**
 * Images jointes envoyées au modèle (deepseek-flash est multimodal).
 * Les grandes images sont réduites (côté le plus long ≤ 1600 px, JPEG) : moins lourd à
 * envoyer et moins de tokens facturés, sans perte utile pour une capture d'écran.
 */
const MAX_SIDE = 1600;
const KEEP_ORIGINAL_BYTES = 1_500_000;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
};

export const imageMimeFromName = (name: string) => MIME_BY_EXT[name.split('.').pop()?.toLowerCase() || ''] || 'image/png';

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export async function imageToDataUrl(blob: Blob): Promise<string> {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('image trop lourde (20 Mo maximum)');
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return readAsDataUrl(blob); // format non décodable ici : envoyé tel quel
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (scale === 1 && blob.size <= KEEP_ORIGINAL_BYTES && /^image\/(png|jpeg|webp|gif)$/.test(blob.type)) {
    bitmap.close();
    return readAsDataUrl(blob);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); return readAsDataUrl(blob); }
  ctx.fillStyle = '#ffffff'; // fond blanc pour les PNG transparents convertis en JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
