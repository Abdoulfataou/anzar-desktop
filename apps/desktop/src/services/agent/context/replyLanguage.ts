/**
 * Langue des réponses de l'agent.
 *
 * Règle : l'agent répond dans la langue du dernier message de l'utilisateur. Quand on ne
 * peut pas la déterminer (message très court, code seul, fichier joint sans texte), il
 * répond dans la langue de l'app, choisie dans les Réglages.
 */
import { useSettingsStore } from '@/stores/settingsStore';

const NAMES: Record<string, string> = { fr: 'français', en: 'anglais' };

/** Langue de l'app, en toutes lettres (« français » par défaut). */
export function appLanguageName(): string {
  try {
    return NAMES[useSettingsStore.getState().settings.language] ?? NAMES.fr;
  } catch {
    return NAMES.fr;
  }
}

/** Consigne à placer dans les prompts système. */
export function replyLanguageRule(): string {
  return "Réponds dans la langue du dernier message de l'utilisateur (il écrit en anglais : réponds en anglais ; " +
    `en français : en français, etc.). Si sa langue n'est pas claire (message très court, code seul), réponds en ${appLanguageName()}, ` +
    "la langue de l'app. Le code, les noms de fichiers et les commandes restent tels quels.";
}
