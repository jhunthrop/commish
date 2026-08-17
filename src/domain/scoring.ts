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
