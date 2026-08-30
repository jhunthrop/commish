export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  readonly nflTeam: string;
  /**
   * The player's photo — an ESPN CDN `https://` URL from Tank01's `espnHeadshot`
   * (`src/stats/tank01/map.ts`'s `mapPlayerList`), or `null` for a team defense (no person to
   * photograph) and for any player the feed doesn't carry a photo for. REQUIRED, not optional:
   * every `Player` states its own headshot rather than leaving callers to guess whether "absent"
   * means "not fetched yet" or "genuinely has none" (founder directive 2026-08-26).
   */
  readonly headshotUrl: string | null;
  /**
   * Average Draft Position from the configured stats provider's ADP feed, or `null` for a player
   * the feed does not rank. Lower is earlier, and the value is fractional ("1.6", "12.8") because
   * that is what a consensus of real drafts produces.
   *
   * DECLARED HERE BECAUSE IT ALREADY SHIPS. `rankedPlayers` (`src/draft-service/pool.ts`) returns
   * drizzle `players` rows straight through as `readonly Player[]` — a structural widening
   * TypeScript permits — so this column has been crossing the wire to the draft room since
   * migration 0041 while the type said it did not exist. The room could not read it without
   * asserting past its own contract, which is the same thing as not having it.
   *
   * WHAT BREAKS WITHOUT IT: the pool has an ORDERING but no VALUES, and you cannot find a cliff in
   * 1,2,3,4. A tier band is a gap between adjacent ADPs; with only a rank there is no gap to
   * measure and the only honest tier ladder is none at all.
   *
   * REQUIRED, not optional, for the same reason `headshotUrl` is: a caller must never have to
   * guess whether an absent field means "unranked" or "this Player was built somewhere that
   * forgot". `null` is the one spelling of "the feed does not rank him", and the pool sorts those
   * players below every ranked one.
   */
  readonly adp: number | null;
}

export interface StatLine {
  readonly playerId: string;
  readonly week: number;
  readonly passingYards: number;
  readonly passingTouchdowns: number;
  readonly interceptions: number;
  readonly rushingYards: number;
  readonly rushingTouchdowns: number;
  readonly receivingYards: number;
  readonly receivingTouchdowns: number;
  readonly receptions: number;
  readonly fumblesLost: number;
  readonly fieldGoalsMade: number;
  readonly extraPointsMade: number;
  readonly sacks: number;
  readonly defensiveInterceptions: number;
  readonly defensiveTouchdowns: number;
  // THE HARVEST BLOCK (founder, 2026-08-30: "make sure we're harvesting all of the data").
  // Usage and context detail the box score already carries and the mapper used to discard.
  // OPTIONAL, not defaulted: the mock dataset and recorded fixtures predate these fields, and
  // "absent" honestly means "not recorded", never 0 targets. The persistence edge writes 0 for
  // an absent value because a column cannot say undefined; scoring reads none of them, and they
  // are deliberately NOT in STAT_FIELDS — the digest and the provider contract govern the
  // SCORED fields, and widening that list would make every provider owe numbers it may not have.
  readonly targets?: number;
  readonly carries?: number;
  readonly passAttempts?: number;
  readonly passCompletions?: number;
  readonly fieldGoalsAttempted?: number;
  /** DST rows only: points the defense allowed — the input standard points-allowed tiers score. */
  readonly pointsAllowed?: number;
  readonly offensiveSnaps?: number;
  /** As the source reports it (`snapCounts.offSnapPct`); shape unverified until a live box score exists. */
  readonly offensiveSnapShare?: number;
}

/**
 * Canonical order of every numeric stat field on a `StatLine`. One list, two readers:
 * `src/stats-pipeline/digest.ts` joins values in this order to build a player's per-tick digest,
 * and the `StatsProvider` contract suite (`src/stats/test-support.ts`) walks it field by field to
 * assert every provider returns a finite number for each one. Keeping a single canonical list is
 * what stops the digest and the contract suite from silently drifting apart when a stat field is
 * added or renamed.
 */
export const STAT_FIELDS = [
  "passingYards",
  "passingTouchdowns",
  "interceptions",
  "rushingYards",
  "rushingTouchdowns",
  "receivingYards",
  "receivingTouchdowns",
  "receptions",
  "fumblesLost",
  "fieldGoalsMade",
  "extraPointsMade",
  "sacks",
  "defensiveInterceptions",
  "defensiveTouchdowns",
] as const satisfies readonly (keyof Omit<StatLine, "playerId" | "week">)[];
