/**
 * Budget d'un tour d'agent : étapes, tokens, coût FCFA, durée.
 *
 * Un budget est un objet de première classe, pas un compteur d'étapes : le moteur refuse
 * l'étape suivante dès qu'une dimension est épuisée, et l'adaptateur peut afficher en
 * direct ce qui reste. Le dépassement est coopératif — on ne coupe pas un flux en cours,
 * on empêche le pas suivant.
 *
 * Module pur : l'horloge est injectable, donc les tests ne dépendent pas du temps réel.
 */
export type BudgetLimit = 'steps' | 'tokensIn' | 'tokensOut' | 'fcfa' | 'wallMs';

/** Plafonds d'un tour. Une dimension absente n'est pas bornée. */
export interface BudgetSpec {
  steps?: number;
  tokensIn?: number;
  tokensOut?: number;
  fcfa?: number;
  wallMs?: number;
}

export interface BudgetUsage {
  steps: number;
  tokensIn: number;
  tokensOut: number;
  fcfa: number;
  /** Temps écoulé depuis le début du tour. */
  wallMs: number;
}

export interface BudgetView {
  limit: BudgetSpec;
  used: BudgetUsage;
  remaining: BudgetSpec;
  /** Dimension qui a stoppé le tour, `null` tant qu'il reste du budget. */
  exhaustedBy: BudgetLimit | null;
  /** Part du budget la plus consommée, de 0 à 1 (pour l'affichage). */
  usedPct: number;
}

/** Seuils d'avertissement (fraction du budget la plus consommée). */
const WARNINGS = [0.6, 0.85] as const;

/**
 * Budget d'un tour interactif. Il ne doit arrêter qu'un tour pathologique : un gros
 * refactor légitime peut consommer plusieurs centaines de FCFA.
 */
export const CHAT_BUDGET: BudgetSpec = { fcfa: 1200, wallMs: 45 * 60_000 };

/** Budget d'un travail de fond : personne ne surveille, on plafonne plus tôt. */
export const BACKGROUND_BUDGET: BudgetSpec = { fcfa: 200, wallMs: 15 * 60_000 };

const EMPTY_USAGE = (): BudgetUsage => ({ steps: 0, tokensIn: 0, tokensOut: 0, fcfa: 0, wallMs: 0 });

export class BudgetLedger {
  readonly spec: BudgetSpec;
  private used: BudgetUsage = EMPTY_USAGE();
  private readonly startedAt: number;
  private readonly now: () => number;
  /** Budget parent : la consommation (tokens, FCFA) y est répercutée. */
  private readonly parent?: BudgetLedger;
  private readonly warned = new Set<number>();
  private readonly warners = new Set<(pct: number, limit: BudgetLimit | null) => void>();
  private readonly watchers = new Set<(view: BudgetView) => void>();

  constructor(
    spec: BudgetSpec = {},
    opts: { now?: () => number; startedAt?: number; parent?: BudgetLedger } = {},
  ) {
    this.spec = { ...spec };
    this.now = opts.now ?? Date.now;
    this.startedAt = opts.startedAt ?? this.now();
    this.parent = opts.parent;
  }

  /** Compte une étape de boucle (comptée même si l'appel échoue). */
  countStep(): void {
    this.used.steps += 1;
    this.emit();
  }

  /** Ajoute une consommation : tokens lus/écrits ou coût réel (FCFA). */
  charge(delta: Partial<Pick<BudgetUsage, 'tokensIn' | 'tokensOut' | 'fcfa'>>): void {
    if (delta.tokensIn) this.used.tokensIn += delta.tokensIn;
    if (delta.tokensOut) this.used.tokensOut += delta.tokensOut;
    if (delta.fcfa) this.used.fcfa += delta.fcfa;
    // Un sous-agent consomme le budget du parent : la comptabilité reste unique.
    this.parent?.charge(delta);
    this.emit();
  }

  /**
   * Enveloppe pour un sous-agent : une fraction du budget **restant** du parent.
   * Les étapes restent locales (le budget d'étapes du parent est sa boucle), mais les
   * tokens et les FCFA consommés remontent au parent.
   */
  child(share: number, capFcfa?: number): BudgetLedger {
    const remaining = this.remaining();
    const frac = Math.min(1, Math.max(0.05, Number.isFinite(share) ? share : 0.5));
    const part = (value?: number) => (value === undefined ? undefined : Math.max(0, Math.floor(value * frac)));
    const spec: BudgetSpec = {
      steps: remaining.steps !== undefined ? Math.max(1, Math.floor(remaining.steps * frac)) : undefined,
      tokensIn: part(remaining.tokensIn),
      tokensOut: part(remaining.tokensOut),
      fcfa: capFcfa !== undefined
        ? Math.max(0, Math.round(Math.min(capFcfa, remaining.fcfa ?? capFcfa) * 100) / 100)
        : remaining.fcfa !== undefined ? Math.max(0, Math.round(remaining.fcfa * frac * 100) / 100) : undefined,
      wallMs: remaining.wallMs,
    };
    return new BudgetLedger(spec, { now: this.now, parent: this });
  }

  /** Un sous-agent a-t-il dépassé son enveloppe (et non celle du parent) ? */
  get isChild(): boolean { return !!this.parent; }

  usage(): BudgetUsage {
    return { ...this.used, wallMs: Math.max(0, this.now() - this.startedAt) };
  }

  remaining(): BudgetSpec {
    const u = this.usage();
    const rest: BudgetSpec = {};
    if (this.spec.steps !== undefined) rest.steps = Math.max(0, this.spec.steps - u.steps);
    if (this.spec.tokensIn !== undefined) rest.tokensIn = Math.max(0, this.spec.tokensIn - u.tokensIn);
    if (this.spec.tokensOut !== undefined) rest.tokensOut = Math.max(0, this.spec.tokensOut - u.tokensOut);
    if (this.spec.fcfa !== undefined) rest.fcfa = Math.max(0, this.spec.fcfa - u.fcfa);
    if (this.spec.wallMs !== undefined) rest.wallMs = Math.max(0, this.spec.wallMs - u.wallMs);
    return rest;
  }

  /** Dimension épuisée, ou `null`. L'ordre fixe la raison annoncée à l'utilisateur. */
  exhaustedBy(): BudgetLimit | null {
    const u = this.usage();
    if (this.spec.steps !== undefined && u.steps >= this.spec.steps) return 'steps';
    if (this.spec.fcfa !== undefined && u.fcfa >= this.spec.fcfa) return 'fcfa';
    if (this.spec.tokensIn !== undefined && u.tokensIn >= this.spec.tokensIn) return 'tokensIn';
    if (this.spec.tokensOut !== undefined && u.tokensOut >= this.spec.tokensOut) return 'tokensOut';
    if (this.spec.wallMs !== undefined && u.wallMs >= this.spec.wallMs) return 'wallMs';
    return null;
  }

  /** Part du budget la plus consommée (0 à 1). */
  fraction(): number {
    const u = this.usage();
    const ratio = (used: number, limit?: number) => (limit !== undefined && limit > 0 ? used / limit : 0);
    const max = Math.max(
      ratio(u.steps, this.spec.steps),
      ratio(u.fcfa, this.spec.fcfa),
      ratio(u.tokensIn, this.spec.tokensIn),
      ratio(u.tokensOut, this.spec.tokensOut),
      ratio(u.wallMs, this.spec.wallMs),
    );
    return Math.min(1, Math.max(0, max));
  }

  view(): BudgetView {
    return {
      limit: { ...this.spec },
      used: this.usage(),
      remaining: this.remaining(),
      exhaustedBy: this.exhaustedBy(),
      usedPct: this.fraction(),
    };
  }

  /** Prévenu au franchissement de 60 % puis de 85 %. Renvoie le désabonnement. */
  onWarning(cb: (pct: number, limit: BudgetLimit | null) => void): () => void {
    this.warners.add(cb);
    return () => { this.warners.delete(cb); };
  }

  /** Prévenu à chaque consommation (compteur en direct). Renvoie le désabonnement. */
  onChange(cb: (view: BudgetView) => void): () => void {
    this.watchers.add(cb);
    return () => { this.watchers.delete(cb); };
  }

  private emit(): void {
    const pct = this.fraction();
    for (const threshold of WARNINGS) {
      if (pct >= threshold && !this.warned.has(threshold)) {
        this.warned.add(threshold);
        const limit = this.exhaustedBy();
        this.warners.forEach((cb) => cb(threshold, limit));
      }
    }
    if (this.watchers.size) {
      const view = this.view();
      this.watchers.forEach((cb) => cb(view));
    }
  }
}

/** Message rendu à l'utilisateur quand le budget arrête le tour. */
export function budgetStopMessage(limit: BudgetLimit, ledger: BudgetLedger): string {
  const u = ledger.usage();
  const what = {
    steps: `nombre d'étapes atteint (${u.steps})`,
    fcfa: `coût maximal atteint (${Math.round(u.fcfa).toLocaleString('fr-FR')} crédits)`,
    tokensIn: `volume de contexte atteint (${Math.round(u.tokensIn).toLocaleString('fr-FR')} jetons lus)`,
    tokensOut: `volume de réponse atteint (${Math.round(u.tokensOut).toLocaleString('fr-FR')} jetons écrits)`,
    wallMs: `durée maximale atteinte (${Math.max(1, Math.round(u.wallMs / 60_000))} min)`,
  }[limit];
  return `Budget de cette demande atteint : ${what}. Le travail déjà fait est conservé — relance l'agent pour continuer, ou augmente le budget.`;
}
