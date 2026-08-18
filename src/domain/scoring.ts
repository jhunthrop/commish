export interface ScoringSettings {
  readonly leagueId: string;
  readonly pointsPerPassingYard: number;
  readonly pointsPerPassingTouchdown: number;
  readonly pointsPerInterception: number;
  readonly pointsPerRushingYard: number;
  readonly pointsPerRushingTouchdown: number;
  readonly pointsPerReceivingYard: number;
  readonly pointsPerReceivingTouchdown: number;
  readonly pointsPerReception: number;
  readonly pointsPerFumbleLost: number;
  /** Extra points per reception, added on top of pointsPerReception, for TE receptions only. */
  readonly teReceptionBonus: number;
  readonly pointsPerFieldGoal: number;
  readonly pointsPerExtraPoint: number;
  readonly pointsPerSack: number;
  readonly pointsPerDefensiveInterception: number;
  readonly pointsPerDefensiveTouchdown: number;
}

export const STANDARD_SCORING: Omit<ScoringSettings, "leagueId"> = {
  pointsPerPassingYard: 0.04,
  pointsPerPassingTouchdown: 4,
  pointsPerInterception: -2,
  pointsPerRushingYard: 0.1,
  pointsPerRushingTouchdown: 6,
  pointsPerReceivingYard: 0.1,
  pointsPerReceivingTouchdown: 6,
  pointsPerReception: 0,
  pointsPerFumbleLost: -2,
  teReceptionBonus: 0,
  pointsPerFieldGoal: 3,
  pointsPerExtraPoint: 1,
  pointsPerSack: 1,
  pointsPerDefensiveInterception: 2,
  pointsPerDefensiveTouchdown: 6,
};

export const PPR_SCORING: Omit<ScoringSettings, "leagueId"> = {
  ...STANDARD_SCORING,
  pointsPerReception: 1,
};

export const HALF_PPR_SCORING: Omit<ScoringSettings, "leagueId"> = {
  ...STANDARD_SCORING,
  pointsPerReception: 0.5,
};

export const TE_PREMIUM_SCORING: Omit<ScoringSettings, "leagueId"> = {
  ...PPR_SCORING,
  teReceptionBonus: 0.5,
};

export type ScoringPresetName = "standard" | "ppr" | "half_ppr" | "te_premium";

/**
 * The one lookup from a preset's name to its rules. League creation stores a name; this is
 * what turns that name into a `scoring_settings` row. Adding a preset means adding it here
 * and nowhere else.
 */
export const SCORING_PRESETS: Readonly<Record<ScoringPresetName, Omit<ScoringSettings, "leagueId">>> = {
  standard: STANDARD_SCORING,
  ppr: PPR_SCORING,
  half_ppr: HALF_PPR_SCORING,
  te_premium: TE_PREMIUM_SCORING,
};
