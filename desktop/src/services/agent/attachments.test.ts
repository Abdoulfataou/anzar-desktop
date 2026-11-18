import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '@/types';
import { MAX_ATTACHMENT_CHARS, withAttachments } from './attachments';

const base = { id: 'a', name: 'f.txt', kind: 'text', size: 0, ref: 'A' } as ChatAttachment;

describe('withAttachments', () => {
  it('ne change rien sans pièce jointe', () => {
    expect(withAttachments('Bonjour', [])).toBe('Bonjour');
  });

  it('décrit une image selon sa lisibilité', () => {
    const withImage = withAttachments('Vois', [
      { ...base, kind: 'image', dataUrl: 'data:image/png;base64,AAA' },
      { ...base, id: 'b', name: 'g.png', kind: 'image' },
    ]);
    expect(withImage).toContain('Image jointe : elle t');
    expect(withImage).toContain('Image jointe illisible');
  });

  it('tronque un long texte et signale la troncature', () => {
    const text = 'x'.repeat(MAX_ATTACHMENT_CHARS + 100);
    const result = withAttachments('Lis', [{ ...base, excerpt: text }]);
    expect(result).toContain('Tronqué');
    expect(result).toContain('Préviens');
  });

  it('signale un contenu vide et une copie projet', () => {
    const result = withAttachments('Lis', [
      { ...base, id: 'empty', excerpt: '   ' },
      { ...base, id: 'copy', excerpt: 'ok', projectCopy: 'ANZAR/f.txt' },
    ]);
    expect(result).toContain('Contenu illisible ou vide');
    expect(result).toContain('Copie du fichier');
  });
});
