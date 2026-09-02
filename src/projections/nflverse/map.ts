import type { PlayerWeekObservation } from "../store";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";
import { projectedPosition, type PlayerRef, type PlayerUniverse, type UnresolvedRef } from "./players";

/**
 * SNAP COUNTS AND TARGETS — the participation layer, and the reason this whole module exists.
 *
 * A box score reports five catches on eight targets; it cannot say whether the man played twenty
 * offensive snaps or sixty, and those are two different players. Layer 1 of the engine forecasts
 * OPPORTUNITY, and opportunity is a share — so it needs the denominator, and the denominator is
 * the one thing our paid stats feed cannot supply.
 *
 * Everything here is pure over already-fetched rows. The client does the I/O, the player universe
 * (`players.ts`) does identity, and this file does exactly one job: turn two nflverse files into
 * facts with an honest `as_of` on each.
 */

/** The `source` stamp each file's observations carry — the axis an ablation holds a feed out on. */
export const NFLVERSE_SOURCE = {
  snapCounts: "nflverse_snap_counts",
  playerWeek: "nflverse_player_week",
} as const;

/**
 * Metric names, spelled once. A typo here and a feature silently reads nothing.
 *
 * Every share the opportunity model predicts appears here as a NUMERATOR and a DENOMINATOR pair,
 * because a share computed against the wrong denominator is not merely inaccurate — it is a
 * plausible-looking number that survives review. The team totals ride on each player's own row
 * rather than in a table of their own: the store has no team column, and a player traded midseason
 * therefore carries his new team's volume with him automatically, which is exactly the segment a
 * team-keyed table would get wrong.
 */
export const PARTICIPATION_METRICS = {
  offensiveSnaps: "offensive_snaps",
  teamOffensiveSnaps: "team_offensive_snaps",
  routesRun: "routes_run",
  targets: "targets",
  teamTargets: "team_targets",
  carries: "carries",
  teamCarries: "team_carries",
  /** A quarterback's own throws. The denominator for every passing rate the composer applies. */
  passAttempts: "pass_attempts",
  teamPassAttempts: "team_pass_attempts",
} as const;

/**
 * THE SNAP-COUNT ASSET FLOOR — the earliest season nflverse's `snap_counts` release carries any ROWS
 * for, audited by hand against the live release on 2026-09-01 (every asset, 2003 through 2013):
 *
 *   2011 and older  `snap_counts_YYYY.csv` is a deterministic 404, nothing published.
 *   2012            published, 200, and EMPTY: 154 bytes, a header line and zero data rows.
 *   2013 onwards    published and full (2013 is two megabytes).
 *
 * The same audit found `stats_player_week_YYYY.csv` and `play_by_play_YYYY.csv` published for EVERY
 * season 2003-2012, which is why the history extension ingests those seasons' PUBLISHED stat lines
 * and simply has no participation for them.
 *
 * ROWS, NOT EXISTENCE, is what this floor measures, and 2012 is why. A 404 and a header-only file
 * are two upstream shapes of one downstream fact — there are no snap counts for this season — and a
 * floor drawn at "the file exists" would put 2012 on the wrong side of itself, leaving
 * `ingestSeason` to derive an empty week map and `mapStatLines` to throw on the first week it could
 * not date. `laws/config.ts`'s window note says 2012 "is missing its own week 1"; on today's
 * release it is missing every week, which sharpens that note rather than contradicting it.
 *
 * NOT `HISTORICAL_ROSTER_FLOOR` AND NOT `MEASURE_SEASONS.from`, which are SCOPE bounds this constant
 * deliberately does not touch. This one is an ASSET bound, the same kind of fact `rosters.ts`'s
 * `ROSTER_ASSET_FLOOR` (2002) records for the weekly-roster release: it answers "is the data
 * upstream", never "is this engine willing to read that far back". All three read 2013 until
 * 2026-09-01, when `MEASURE_SEASONS.from` moved to 2003 and the other two did not — which is the
 * separation this docblock predicted, arriving exactly as described: a window move is a decision of
 * its own that this constant must never be read as having made, in either direction.
 *
 * ITS READERS are `ingest.ts`'s `fetchSnapCounts` (which treats a missing file at or above this
 * floor as an ALARM and below it as the ordinary shape of history, exactly the way
 * `fetchPlayerWeek` reads `STAT_LINE_GAPS`) and `scripts/projection-backfill.ts` (which fetches the
 * schedule for the seasons below it, since their stat lines have nothing else to take an as-of
 * from).
 */
export const SNAP_COUNT_ASSET_FLOOR = 2013;

/** One player's opportunity in one week, joined across the two files that describe it. */
export interface PlayerWeekParticipation {
  readonly playerId: string;
  readonly season: number;
  readonly week: number;
  readonly offensiveSnaps: number;
  readonly teamOffensiveSnaps: number;
  /**
   * ALWAYS null today, and typed nullable rather than defaulted to zero on purpose: routes run is
   * charting data (PFF, FTN), not something nflverse publishes free, so we genuinely do not know
   * it. Zero would say "he ran no routes", which is a completely different claim and one that
   * would wreck targets-per-route-run the moment anyone computed it. Same "null is not zero"
   * discipline `metrics.ts` follows.
   */
  readonly routesRun: number | null;
  readonly targets: number;
  readonly carries: number;
  readonly passAttempts: number;
  /** His team's totals for the same week — the denominators the shares are taken against. */
  readonly teamTargets: number;
  readonly teamCarries: number;
  readonly teamPassAttempts: number;
  readonly asOf: Date;
}

export interface MapParticipationInput {
  readonly snapCounts: readonly CsvRow[];
  readonly playerWeek: readonly CsvRow[];
  /** The historical player universe — `players.ts`. Identity is an id join, never a name join. */
  readonly universe: PlayerUniverse;
  /** Defaults to `NFLVERSE_CONFIG.publicationLagHours`. */
  readonly publicationLagHours?: number;
}

export interface MapParticipationResult {
  readonly participation: readonly PlayerWeekParticipation[];
  /** Never empty when someone failed to join — see `players.ts` for why a silent drop is fatal. */
  readonly unresolved: readonly UnresolvedRef[];
  readonly resolutionRate: number | null;
}

const MILLISECONDS_PER_HOUR = 3_600_000;

/** A required numeric field. Empty or unparseable throws — see `csv.ts` on why not zero. */
function numeric(row: CsvRow, column: string): number {
  const raw = row[column];
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`nflverse row has no readable ${column} (got ${JSON.stringify(raw)}).`);
  }
  return value;
}

/** A field that may legitimately be blank — nflverse leaves a stat empty rather than writing 0. */
function optionalNumeric(row: CsvRow, column: string): number {
  const raw = row[column];
  if (raw === undefined || raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`nflverse row has an unreadable ${column} (got ${JSON.stringify(raw)}).`);
  }
  return value;
}

/**
 * THE `as_of` STAMP for a game, derived from the date buried in `pfr_game_id` (`202409080buf`).
 *
 * The stamp is the END of the game's UTC calendar day plus the publication lag, not the date
 * itself. A Monday night game kicks off at 20:15 Eastern and finishes after midnight UTC, so
 * stamping from the bare date would produce an `as_of` EARLIER than the moment the game it
 * describes had even finished — a leak, in the one file that exists to prevent them. Erring late
 * costs a replay a few hours of legitimately-knowable data; erring early invalidates every number
 * the harness ever produces, so the arithmetic rounds the safe way.
 */
export function gameDayAsOf(pfrGameId: string, lagHours: number): Date {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(pfrGameId);
  if (match === null) {
    throw new Error(`nflverse pfr_game_id "${pfrGameId}" carries no readable date; an observation cannot be stamped.`);
  }
  const [, year, month, day] = match;
  const endOfGameDay = Date.UTC(Number(year), Number(month) - 1, Number(day) + 1);
  return new Date(endOfGameDay + lagHours * MILLISECONDS_PER_HOUR);
}

/**
 * When each week's numbers became knowable, taken from that week's LAST game.
 *
 * The weekly stats file carries no game date of its own, so it borrows one from the snap counts.
 * The last game rather than the first, because a week's stats are not complete until its Monday
 * night game is over — dating the week from its Thursday opener would make four days of results
 * visible to a replay before they existed.
 */
export function weekAsOfFromSnapCounts(rows: readonly CsvRow[], lagHours: number): ReadonlyMap<number, Date> {
  const byWeek = new Map<number, Date>();
  for (const row of rows) {
    if (row.game_type !== NFLVERSE_CONFIG.seasonType) continue;
    const week = numeric(row, "week");
    const asOf = gameDayAsOf(row.pfr_game_id ?? "", lagHours);
    const known = byWeek.get(week);
    if (known === undefined || asOf > known) byWeek.set(week, asOf);
  }
  return byWeek;
}

/**
 * The team's offensive snap total for a game, taken as the MAXIMUM any of its players played.
 *
 * `offense_pct` looks like the direct route (`snaps / pct`) and is not: nflverse rounds it to two
 * decimals, so it disagrees with the true total for any player under 100%, and the derived number
 * can come out ABOVE the real one — which would put a share over 1.0 and make a "share" not a
 * share. The maximum cannot: nobody plays more offensive snaps than his offense ran. In the 2024
 * season 99.8% of team-games have at least one player at 100% of snaps, so this is exact almost
 * always and a tight lower bound otherwise.
 */
function teamSnapsByGame(rows: readonly CsvRow[]): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.game_type !== NFLVERSE_CONFIG.seasonType) continue;
    const key = `${row.game_id}|${row.team}`;
    const snaps = numeric(row, "offense_snaps");
    totals.set(key, Math.max(totals.get(key) ?? 0, snaps));
  }
  return totals;
}

/** One player's, or one team's, opportunity numerators for a week. */
interface Usage {
  readonly targets: number;
  readonly carries: number;
  readonly passAttempts: number;
}

const NO_USAGE: Usage = { targets: 0, carries: 0, passAttempts: 0 };

function usageOf(row: CsvRow): Usage {
  return {
    targets: optionalNumeric(row, "targets"),
    carries: optionalNumeric(row, "carries"),
    passAttempts: optionalNumeric(row, "attempts"),
  };
}

/**
 * Opportunity numerators keyed by `<gsis id>|<week>`, and the same totals keyed by `<team>|<week>`.
 *
 * The join between the two files used to be a name join through the crosswalk. It is now the id
 * both files already carry, which is why this reads a column instead of building a key.
 *
 * Team totals are summed over EVERY player the weekly file carries for that team, at every
 * position, not over the four the engine projects. Every target belongs to somebody, so the sum is
 * the team's real volume; a total built from skill players alone would be short by the trick plays
 * and the linemen who caught something, and every share taken against it would be inflated in the
 * same direction — a wrong number that looks right, which is the only kind that survives review.
 */
function usageByPlayerAndTeam(rows: readonly CsvRow[]): {
  readonly byPlayer: ReadonlyMap<string, Usage>;
  readonly byTeam: ReadonlyMap<string, Usage>;
} {
  const byPlayer = new Map<string, Usage>();
  const byTeam = new Map<string, Usage>();
  for (const row of rows) {
    if (row.season_type !== NFLVERSE_CONFIG.seasonType) continue;
    const usage = usageOf(row);
    byPlayer.set(`${row.player_id ?? ""}|${row.week ?? ""}`, usage);
    const teamKey = `${row.team ?? ""}|${row.week ?? ""}`;
    const running = byTeam.get(teamKey) ?? NO_USAGE;
    byTeam.set(teamKey, {
      targets: running.targets + usage.targets,
      carries: running.carries + usage.carries,
      passAttempts: running.passAttempts + usage.passAttempts,
    });
  }
  return { byPlayer, byTeam };
}

/**
 * Joins the two files into one participation row per projected player per week.
 *
 * The denominator is computed over EVERY position, then the output is narrowed to the four the
 * engine projects. That order matters and is the easiest thing to get backwards: a team snap total
 * built from skill players alone is short by the whole offensive line, and every share computed
 * against it is inflated by roughly a third — a number that looks plausible, which is why it would
 * survive review.
 *
 * Two narrowings, and they are not the same one. The file's own position decides who is a
 * CANDIDATE, because that is all that is knowable before resolving; the UNIVERSE's position decides
 * who is projected, because `nfl_players.position` is what the backtest scores through and the two
 * must agree or a player would be ingested and then silently dropped at scoring time.
 */
export function mapParticipation({
  snapCounts,
  playerWeek,
  universe,
  publicationLagHours = NFLVERSE_CONFIG.publicationLagHours,
}: MapParticipationInput): MapParticipationResult {
  const teamSnaps = teamSnapsByGame(snapCounts);
  const { byPlayer: playerUsage, byTeam: teamUsage } = usageByPlayerAndTeam(playerWeek);

  const scored = snapCounts.filter(
    (row) =>
      row.game_type === NFLVERSE_CONFIG.seasonType &&
      (NFLVERSE_CONFIG.scoredPositions as readonly string[]).includes(row.position ?? ""),
  );
  const refs: readonly PlayerRef[] = scored.map((row) => ({
    kind: "pfr" as const,
    id: row.pfr_player_id ?? "",
    name: row.player ?? "",
  }));
  const { resolved, unresolved, resolutionRate } = universe.resolveAll(refs);

  const participation: PlayerWeekParticipation[] = [];
  for (const [index, row] of scored.entries()) {
    const playerId = resolved.get(refs[index]!.id);
    // Unresolved players are NOT silently skipped — they are on `unresolved`, named and counted.
    // They are merely not stored, because there is no id to store them against.
    if (playerId === undefined) continue;
    if (projectedPosition(universe.byGsisId(playerId)!.position) === null) continue;
    const week = numeric(row, "week");
    // The player's own team for THIS week comes from the snap row he appears on, not from any
    // roster: a player traded in October has two teams in one season, and his shares belong to
    // whichever offence he was actually in that Sunday.
    const own = playerUsage.get(`${playerId}|${week}`) ?? NO_USAGE;
    const team = teamUsage.get(`${row.team}|${week}`) ?? NO_USAGE;
    participation.push({
      playerId,
      season: numeric(row, "season"),
      week,
      offensiveSnaps: numeric(row, "offense_snaps"),
      teamOffensiveSnaps: teamSnaps.get(`${row.game_id}|${row.team}`) ?? 0,
      routesRun: null,
      targets: own.targets,
      carries: own.carries,
      passAttempts: own.passAttempts,
      teamTargets: team.targets,
      teamCarries: team.carries,
      teamPassAttempts: team.passAttempts,
      asOf: gameDayAsOf(row.pfr_game_id ?? "", publicationLagHours),
    });
  }
  return { participation, unresolved, resolutionRate };
}

/**
 * Flattens participation into the narrow rows the point-in-time store holds.
 *
 * A metric we do not know emits NO ROW, rather than a row of zero. The store cannot tell those
 * apart afterwards, and "he ran no routes" is a claim we have no evidence for.
 */
export function participationObservations(
  rows: readonly PlayerWeekParticipation[],
): readonly PlayerWeekObservation[] {
  return rows.flatMap((row) => {
    const stamp = { season: row.season, week: row.week, playerId: row.playerId, asOf: row.asOf };
    const observations: PlayerWeekObservation[] = [
      { ...stamp, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.offensiveSnaps, value: row.offensiveSnaps },
      { ...stamp, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: row.teamOffensiveSnaps },
      { ...stamp, source: NFLVERSE_SOURCE.playerWeek, metric: PARTICIPATION_METRICS.targets, value: row.targets },
      { ...stamp, source: NFLVERSE_SOURCE.playerWeek, metric: PARTICIPATION_METRICS.teamTargets, value: row.teamTargets },
      { ...stamp, source: NFLVERSE_SOURCE.playerWeek, metric: PARTICIPATION_METRICS.carries, value: row.carries },
      { ...stamp, source: NFLVERSE_SOURCE.playerWeek, metric: PARTICIPATION_METRICS.teamCarries, value: row.teamCarries },
      { ...stamp, source: NFLVERSE_SOURCE.playerWeek, metric: PARTICIPATION_METRICS.passAttempts, value: row.passAttempts },
      { ...stamp, source: NFLVERSE_SOURCE.playerWeek, metric: PARTICIPATION_METRICS.teamPassAttempts, value: row.teamPassAttempts },
    ];
    if (row.routesRun !== null) {
      observations.push({ ...stamp, source: NFLVERSE_SOURCE.playerWeek, metric: PARTICIPATION_METRICS.routesRun, value: row.routesRun });
    }
    return observations;
  });
}
