import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';
import { replyLanguageRule } from './replyLanguage';
import { buildAgentSystemPrompt } from './agentPrompts';

const setLanguage = (language: 'fr' | 'en') =>
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, language } }));

describe('langue des réponses de l’agent', () => {
  afterEach(() => setLanguage('fr'));

  it('suit la langue de l’utilisateur, avec la langue de l’app en repli', () => {
    setLanguage('fr');
    expect(replyLanguageRule()).toMatch(/langue du dernier message/);
    expect(replyLanguageRule()).toMatch(/réponds en français, la langue de l'app/);
    setLanguage('en');
    expect(replyLanguageRule()).toMatch(/réponds en anglais, la langue de l'app/);
  });

  it('n’impose plus le français dans le prompt du moteur', () => {
    const prompt = buildAgentSystemPrompt({ projectName: 'p', projectRoot: '/p' } as never);
    expect(prompt).not.toMatch(/Réponds et commente en français/);
    expect(prompt).toMatch(/langue du dernier message/);
  });
});
