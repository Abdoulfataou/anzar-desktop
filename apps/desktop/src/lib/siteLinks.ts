/**
 * Liens vers getanzar.com dans la langue de l'app (Réglages → langue).
 * Les adresses suivent les pages du site (apps/site/i18n/*.json, champ « slug »).
 */
import { useSettingsStore } from '@/stores/settingsStore';

export const SUPPORT_EMAIL = 'support@getanzar.com';
const SITE = 'https://getanzar.com';
const PAGES = {
  fr: { home: '/fr/', terms: '/fr/conditions/', privacy: '/fr/confidentialite/' },
  en: { home: '/en/', terms: '/en/terms/', privacy: '/en/privacy/' },
} as const;

export function siteUrl(page: keyof typeof PAGES.fr): string {
  const lang = useSettingsStore.getState().settings.language === 'en' ? 'en' : 'fr';
  return SITE + PAGES[lang][page];
}
