/**
 * Affichage des montants — solde en crédits, prix dans la monnaie locale.
 *
 * Le solde et les coûts sont des CRÉDITS (1 crédit = 1 FCFA côté serveur, unité du
 * grand livre). Seuls les prix de recharge sont dans la monnaie de l'utilisateur.
 * Aucun calcul de prix ici : le serveur envoie les montants exacts en unités
 * mineures ISO (centimes, millièmes…) et l'app ne fait que les formater.
 */

const LOCALE = 'fr-FR';
/** Unité du grand livre côté serveur (1 crédit = 1 unité). */
export const LEDGER_CURRENCY = 'XOF';

/** « 12 450 crédits », « 1 crédit », « < 1 crédit ». */
export function formatCredits(n: number, opts: { short?: boolean } = {}): string {
  const v = Number.isFinite(n) ? n : 0;
  if (v > 0 && v < 1) return opts.short ? '< 1' : '< 1 crédit';
  const r = Math.round(v);
  const num = r.toLocaleString(LOCALE);
  if (opts.short) return num;
  return `${num} ${Math.abs(r) <= 1 ? 'crédit' : 'crédits'}`;
}

/** Unités mineures ISO → nombre décimal (500, 2 → 5 ; 750, 3 → 0,75). */
export function fromMinor(minor: number, decimals: number): number {
  return minor / 10 ** decimals;
}

/**
 * Montant au format local via Intl.NumberFormat, en respectant le nombre de
 * décimales ISO de la devise (0 pour XOF/JPY, 3 pour KWD…).
 */
export function formatMoney(amount: number, currency: string, decimals?: number): string {
  const code = (currency || '').toUpperCase();
  try {
    const opts: Intl.NumberFormatOptions = { style: 'currency', currency: code };
    if (typeof decimals === 'number') {
      opts.minimumFractionDigits = decimals;
      opts.maximumFractionDigits = decimals;
    }
    return new Intl.NumberFormat(LOCALE, opts).format(amount);
  } catch {
    const d = typeof decimals === 'number' ? decimals : 2;
    return `${amount.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d })} ${code}`;
  }
}

export function formatMinor(minor: number, currency: string, decimals: number): string {
  return formatMoney(fromMinor(minor, decimals), currency, decimals);
}

export type DisplayRate = { currency: string; decimals: number; fcfaPerUnit: number | null };

/**
 * Équivalent d'un nombre de crédits dans la monnaie de l'utilisateur.
 * « ≈ 18,97 € » (conversion), « 12 450 F CFA » (unité du grand livre, exact),
 * ou '' si aucun taux n'est connu.
 */
export function creditsInLocal(credits: number, rate: DisplayRate | null): string {
  if (!rate || !rate.currency) return '';
  if (rate.currency.toUpperCase() === LEDGER_CURRENCY) return formatMoney(Math.round(credits), LEDGER_CURRENCY, 0);
  if (!rate.fcfaPerUnit || rate.fcfaPerUnit <= 0) return '';
  return `≈ ${formatMoney(credits / rate.fcfaPerUnit, rate.currency, rate.decimals)}`;
}

/** Nom localisé d'une devise (« naira nigérian »), sinon le code. */
export function currencyName(code: string): string {
  try {
    const dn = new Intl.DisplayNames([LOCALE], { type: 'currency' });
    return dn.of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Fuseaux sans région de langue fiable → pays (indice seulement, le serveur décide). */
const TZ_COUNTRY: Record<string, string> = {
  'Africa/Niamey': 'NE', 'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Nairobi': 'KE',
  'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN', 'Africa/Bamako': 'ML', 'Africa/Ouagadougou': 'BF',
  'Africa/Lome': 'TG', 'Africa/Porto-Novo': 'BJ', 'Africa/Conakry': 'GN', 'Africa/Douala': 'CM',
  'Africa/Libreville': 'GA', 'Africa/Brazzaville': 'CG', 'Africa/Kinshasa': 'CD', 'Africa/Ndjamena': 'TD',
  'Africa/Bangui': 'CF', 'Africa/Malabo': 'GQ', 'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ',
  'Africa/Tunis': 'TN', 'Africa/Cairo': 'EG', 'Africa/Johannesburg': 'ZA', 'Africa/Kampala': 'UG',
  'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kigali': 'RW', 'Africa/Addis_Ababa': 'ET', 'Africa/Lusaka': 'ZM',
  'Africa/Blantyre': 'MW', 'Africa/Maputo': 'MZ', 'Africa/Harare': 'ZW', 'Africa/Nouakchott': 'MR',
  'Europe/Paris': 'FR', 'Europe/Brussels': 'BE', 'Europe/London': 'GB', 'Europe/Berlin': 'DE',
  'America/Toronto': 'CA', 'America/Montreal': 'CA', 'America/Vancouver': 'CA',
  'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Dubai': 'AE', 'Asia/Kuwait': 'KW',
};

/**
 * Pays probable d'après le système : région de la langue (« fr-NE » → NE), sinon
 * le fuseau horaire. Ce n'est qu'un indice : l'en-tête pays du serveur passe avant.
 */
export function guessCountry(
  languages: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [],
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || '',
): string {
  for (const tag of languages) {
    try {
      const region = new Intl.Locale(tag).maximize().region;
      // « fr » seul se maximise en « fr-FR » : on ne s'y fie que si la région était écrite.
      if (region && /^[a-z]{2,3}-[A-Z]{2}$/i.test(tag.split('-u-')[0].split('-').slice(0, 2).join('-'))) {
        return region.toUpperCase();
      }
    } catch { /* étiquette invalide */ }
  }
  return TZ_COUNTRY[timeZone] ?? '';
}
