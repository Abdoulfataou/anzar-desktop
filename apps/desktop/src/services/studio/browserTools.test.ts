import { describe, expect, it } from 'vitest';
import { browserTools } from './browserTools';

describe('console de l\'aperçu', () => {
  it('n\'accepte que les messages de l\'iframe d\'aperçu', () => {
    const preview = document.createElement('iframe');
    const other = document.createElement('iframe');
    document.body.append(preview, other);
    let seen: string[] = [];
    const unsub = browserTools.subscribe((entries) => { seen = entries.map((e) => e.message); });
    browserTools.startListening();
    browserTools.setPreviewFrame(preview);

    const post = (source: Window | null, message: unknown) =>
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'anzar-console', level: 'log', message }, source }));

    post(other.contentWindow, 'faux message');
    post(null, 'sans source');
    post(preview.contentWindow, 'vrai message');

    expect(seen).toEqual(['vrai message']);
    browserTools.stopListening();
    unsub();
  });
});
