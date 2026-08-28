import { TANK01_CONFIG } from "@/stats/tank01/config";

/**
 * WHAT TO CAPTURE, HOW OFTEN, AND WHAT IT COSTS.
 *
 * Pure configuration and pure predicates — no clock read, no I/O, no Redis. `capture.ts` does the
 * fetching; this file only decides what is worth fetching and when, so the cadence rules can be
 * driven through every day of a week in a unit test rather than waited for.
 *
 * Every feed here is one with NO HISTORY ENDPOINT. That is the entry criterion and the reason the
 * job is urgent: anything nflverse archives (participation, play-by-play, weekly stats) is
 * deliberately absent, because it can be backfilled at leisure and does not belong in a job that
 * competes for the live-scoring request budget on a Sunday afternoon.
 */

export const CAPTURE_CONFIG = {
  /**
   * How long a feed's capture is considered fresh, per cadence. Enforced with a Redis key whose
   * TTL is this value, so a restart does not re-fetch everything and a lost Redis only ever costs
   * one extra poll.
   *
   * `daily` is 20 hours rather than 24 deliberately: a strict 24 would drift a little later every
   * day against a 30-minute poll interval and eventually skip a calendar day entirely. Slightly
   * short means the capture lands at roughly the same hour indefinitely, at the price of an
   * occasional extra request.
   */
  freshnessHours: {
    daily: 20,
    "game-day": 4,
    weekly: 6 * 24,
  },
  /**
   * The days of the week odds and salaries are captured on, as `Date#getUTCDay` (0 = Sunday).
   *
   * Thursday through Monday: every day the NFL plays, plus a margin either side. Deliberately
   * GENEROUS rather than tight — a UTC day boundary is five hours off Eastern, so a tight window
   * would silently miss a Monday night line, and the cost of an extra capture is one request while
   * the cost of a miss is a market consensus that no longer exists anywhere.
   */
  gameDaysUtc: [0, 1, 4, 5, 6],
  /** Redis key holding "this feed was polled recently", TTL'd by its cadence. */
  attemptKey: (source: string) => `commish:capture:attempted:${source}`,
} as const;

export type CaptureCadence = keyof typeof CAPTURE_CONFIG.freshnessHours;

/**
 * The 32 team abbreviations, in Tank01's own spelling, for the feeds fetched a team at a time.
 *
 * A constant rather than a `/getNFLTeams` call on every capture. The league adds a team about once
 * a decade and renames one about as often, so paying a request every day to re-learn a list that
 * does not change is the wrong trade — and it would make the injury feed depend on another feed's
 * response having parsed correctly. Verified against `src/stats/tank01/fixtures/teams.json`, which
 * is where to check them if a relocation ever moves one (`WSH`, `LV` and `JAX` are the spellings
 * that differ between providers).
 */
export const NFL_TEAM_ABBREVIATIONS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND",
  "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF",
  "TB", "TEN", "WSH",
] as const;

/** One upstream request a feed makes. A feed may make several (injuries fan out over teams). */
export interface CaptureRequest {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
}

export interface CaptureFeedContext {
  readonly season: number;
  readonly week: number;
  /** All 32 NFL team abbreviations, for the feeds that are fetched a team at a time. */
  readonly teams: readonly string[];
}

export interface CaptureFeed {
  /** The `source` stamp its snapshots carry. */
  readonly source: string;
  readonly cadence: CaptureCadence;
  /** Why this feed cannot be backfilled — kept next to the feed so it is never quietly dropped. */
  readonly irrecoverable: string;
  requests(context: CaptureFeedContext): readonly CaptureRequest[];
}

/**
 * The feeds, in the order a tick attempts them: cheapest and most perishable first.
 *
 * Injuries lead because a designation changes hourly on a Friday and is overwritten in place
 * upstream, and because a wrong availability assumption is the single largest source of projection
 * error there is. The changelog is here rather than in the live-scoring worker because a stat
 * correction that is not TIMESTAMPED makes the whole point-in-time store quietly dishonest — a
 * backtest would score a week against numbers nobody could have known that week.
 */
export const CAPTURE_FEEDS: readonly CaptureFeed[] = [
  {
    source: "tank01_injuries",
    cadence: "daily",
    irrecoverable: "Injury designations are a current snapshot; there is no history endpoint. Yesterday's report is gone.",
    // One request per team: the roster endpoint is where a designation actually lives. Thirty-two
    // requests a day is the most expensive line in this file, and it buys the feature with the
    // largest effect on projection error, so it is priced deliberately rather than by accident.
    requests: ({ teams }) =>
      teams.map((team) => ({ path: TANK01_CONFIG.paths.teamRoster, query: { teamAbv: team, getStats: "false" } })),
  },
  {
    source: "tank01_depth_charts",
    cadence: "daily",
    irrecoverable: "Depth charts are current-only. A player's role in week 3 is unrecoverable in week 10.",
    requests: () => [{ path: TANK01_CONFIG.paths.depthCharts, query: {} }],
  },
  {
    source: "tank01_changelog",
    cadence: "daily",
    irrecoverable: "Stat corrections must be timestamped or every replay silently scores against numbers nobody had.",
    requests: () => [{ path: TANK01_CONFIG.paths.changelog, query: {} }],
  },
  {
    source: "tank01_news",
    cadence: "daily",
    irrecoverable: "Headlines roll off the feed. Layer 5 retrieves facts from them and cannot retrieve what is gone.",
    requests: () => [{ path: TANK01_CONFIG.paths.news, query: { fantasyNews: "true" } }],
  },
  {
    source: "tank01_betting_odds",
    cadence: "game-day",
    irrecoverable: "The line as it stood before kickoff. Afterwards only the closing line survives, and layer 4 wants the pre-game one.",
    requests: ({ season, week }) => [
      { path: TANK01_CONFIG.paths.bettingOdds, query: { gameWeek: String(week), season: String(season) } },
    ],
  },
  {
    source: "tank01_dfs_salaries",
    cadence: "game-day",
    irrecoverable: "The only weekly market consensus there is, published for a week and then gone.",
    requests: ({ season, week }) => [
      { path: TANK01_CONFIG.paths.dfs, query: { week: String(week), season: String(season) } },
    ],
  },
  {
    source: "tank01_adp",
    cadence: "weekly",
    irrecoverable: "ADP drift through the preseason is the market changing its mind, and nobody archives it.",
    requests: () => [{ path: TANK01_CONFIG.paths.adp, query: { adpType: TANK01_CONFIG.adpType } }],
  },
];

/**
 * Whether a feed's cadence permits capturing at this moment, ignoring how recently it last ran.
 *
 * Only `game-day` has anything to say here — daily and weekly feeds are due whenever their
 * freshness has lapsed, whatever day it is. Separating "is today a day for this" from "has it been
 * long enough" keeps both testable without a clock.
 */
export function cadenceAllows(cadence: CaptureCadence, at: Date): boolean {
  if (cadence !== "game-day") return true;
  return (CAPTURE_CONFIG.gameDaysUtc as readonly number[]).includes(at.getUTCDay());
}

/** How long a capture of this cadence stays fresh, in seconds — the attempt key's TTL. */
export function freshnessSeconds(cadence: CaptureCadence): number {
  return CAPTURE_CONFIG.freshnessHours[cadence] * 3600;
}

/** What one pass over every due feed would cost upstream, for a budget reservation. */
export function requestCostOf(feeds: readonly CaptureFeed[], context: CaptureFeedContext): number {
  return feeds.reduce((total, feed) => total + feed.requests(context).length, 0);
}
