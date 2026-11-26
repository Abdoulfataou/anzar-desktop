import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/runtime/terminal', () => ({ ESCALATION_HINT: '[sandbox: escalation available]' }));

import { autoVerifyAllowed, isWindowsPlatform, unconfinedCommandRefusal } from './isolation';

const original = { platform: navigator.platform, ua: navigator.userAgent };
const setPlatform = (platform: string, ua: string) => {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
};

describe('Windows sans isolation : fail-closed comme Harness', () => {
  afterEach(() => setPlatform(original.platform, original.ua));

  describe('sous Windows', () => {
    beforeEach(() => setPlatform('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'));

    it('Demander et plan : passage obligé par l’élévation (carte d’accord)', () => {
      expect(isWindowsPlatform()).toBe(true);
      for (const mode of ['ask', 'plan', undefined] as const) {
        const r = unconfinedCommandRefusal(mode, false);
        expect(r).toContain('[sandbox: unavailable');
        expect(r).toContain('escalation available');
      }
    });

    it('Modifier automatiquement : refus, sans carte, avec la marche à suivre', () => {
      const r = unconfinedCommandRefusal('auto', false);
      expect(r).toContain('Refusé');
      expect(r).toContain('Accès complet');
      expect(r).not.toContain('escalation available');
    });

    it('Accès complet ou élévation approuvée : la commande part', () => {
      expect(unconfinedCommandRefusal('full', false)).toBeNull();
      expect(unconfinedCommandRefusal('ask', true)).toBeNull();
    });

    it('serveur de développement : message dédié ; vérifications automatiques seulement en Accès complet', () => {
      expect(unconfinedCommandRefusal('ask', false, 'start_dev_server')).toContain('run_command en élévation');
      expect(autoVerifyAllowed('ask')).toBe(false);
      expect(autoVerifyAllowed('auto')).toBe(false);
      expect(autoVerifyAllowed('full')).toBe(true);
    });
  });

  it('macOS : isolation réelle, rien ne change', () => {
    setPlatform('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(isWindowsPlatform()).toBe(false);
    for (const mode of ['ask', 'auto', 'plan', 'full'] as const) {
      expect(unconfinedCommandRefusal(mode, false)).toBeNull();
      expect(autoVerifyAllowed(mode)).toBe(true);
    }
  });
});
