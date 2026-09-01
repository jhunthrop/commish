import type { Position } from "@/domain/player";
import type { CsvRow } from "../nflverse/csv";
import { NFLVERSE_CONFIG } from "../nflverse/config";
import type { PredictedOpportunity } from "../model/opportunity";
import type { PlayerWeekObservation } from "../store";
import { requireFirstKickoffFor } from "../team-store";

/**
 * THE DEPTH CHART — who is behind whom, which is the one thing August knows and this board did not.
 *
 * `docs/research/2026-08-27-preseason-board.md` lost the deep band, on both held-out seasons and by
 * more than any other band, and named the cause in its own weaknesses section: "preseason holdouts,
 * training-camp injury designations, beat-reporter depth charts and coaching quotes are all real
 * August information and we ingest none of them." Ranks 151 to 400 are backups, committee members
 * and third receivers, and the difference between the man who starts and the man behind him is
 * almost the whole of what separates them.
 *
 * WHY LAYER 1 CANNOT KNOW THIS. Opportunity is forecast from the usage a player has already
 * produced, and across an offseason there is none of this season's. A quarterback who was benched in
 * March and a quarterback who won the job in August look identical to a model reading last year's
 * snaps. Measured on the fit seasons, that is exactly where the error is: the model projects a
 * club's number-two quarterback at nearly twice what he scores and its number one at three quarters
 * of it, consistently, in both seasons.
 *
 * WEAK IN SEASON, STRONG IN AUGUST, and this is the opposite of the weekly case. In week ten a depth
 * chart is a stale restatement of snaps everybody can already see; the model reads the snaps and the
 * chart adds nothing. In August the snaps do not exist yet and the chart is the only statement of
 * intent anybody has published. It is measured on its own terms here for that reason, and on the
 * band it targets rather than on the pooled number.
 *
 * WHAT IT IS ALLOWED TO CLAIM, and this is the delicate part. nflverse's historical depth charts
 * carry a season and a week and NO DATE — the 2020-to-2025 LEGACY schema has no timestamp column at
 * all — so the stamp has to be derived rather than read. It is derived as the LATEST instant that is
 * provably before the season's first kickoff: one millisecond before that kickoff, which
 * `firstKickoffFor` (re-exported here from `team-store.ts`'s own consolidated definition — fix
 * round, I4/I5) recovers from the store's own UNCONDITIONAL kickoff-instant stamps, never from the
 * betting line, which can legitimately be missing for a real scheduled game. A week-1 depth chart is
 * filed by the league's own process before week 1 is played,
 * so this stamp is LATER than the real publication, which is the direction that cannot claim
 * knowledge we did not have. What it cannot rule out is that nflverse scraped the file late in that
 * window; the file contains orderings rather than outcomes, so the exposure is a club reshuffling
 * after a Thursday game, and the research document states it as a weakness rather than hiding it.
 *
 * THE DATED SCHEMA (2026 onward) NEEDS NO SUCH DERIVATION, and stamps DIFFERENTLY as of Task 3
 * (ruling B). Every dated-schema row carries its own real `dt` — the actual instant ESPN published
 * that snapshot — so `mapDatedDepthChart` stamps each observation with that `dt` directly rather
 * than with the kickoff-eve convention above. That convention was built for a schema with nothing
 * better to say; a schema that DOES carry a real publication instant should say it, and the old
 * uniform choice had a real cost for a season that had not yet kicked off: a chart stamped at
 * `kickoff - 1ms` sits AFTER `now` for as long as the season's live moment is capped before kickoff,
 * which made an already-published chart invisible to the live board's own `now`-bounded gate for no
 * reason but the stamping convention's own choice. See `mapDepthChart`'s docblock below for the
 * mechanics of the split.
 *
 * ARCHIVE COMPARABILITY IS NOW INGESTION-SCHEDULE-DEPENDENT, for a dated-schema season, IN A WAY IT
 * NEVER WAS BEFORE (fix round review, I4). A LEGACY season's permanently-stored chart is definitionally
 * the last one before kickoff, because the legacy file only ever carries ONE week-one listing per
 * season and the kickoff-eve convention stamps whatever that listing is. A DATED season's permanently-
 * stored chart is whatever snapshot was LATEST AT THE MOMENT SOMEONE RAN THE INGEST — if that run
 * happens well before kickoff (this task's own 2026 re-ingest ran 1 September, nine days before the
 * 10 September kickoff), the stored chart is an early snapshot, not necessarily the club's final
 * pre-kickoff word, even though later snapshots the CSV itself will go on to publish exist and are
 * knowable to a later run. This is not a correctness defect in the STAMP (each row still honestly
 * claims its own real `dt`, never a date it was not knowable by) — it is a claim about what "the"
 * 2026 chart on file means for comparison against an archived season's chart, and the two are only
 * comparable if the dated season's ingest is ALSO run right before its own kickoff. See this task's
 * own report for the operational step this implies.
 */

/** Where a depth-chart fact came from. Matches the store's `source` column. */
export const DEPTH_SOURCE = "nflverse_depth_charts";

/** The metric: his place on his club's own list, 1 for the starter. See `DEPTH_RANKS`. */
export const DEPTH_METRIC = "depth_team";

/**
 * The ranks the prior is estimated in, plus the one that is an absence rather than a number.
 *
 * `offChart` is a real and different fact from being listed third: a club that publishes an
 * offensive depth chart and does not put a man on it anywhere has said something about him. It is
 * kept as its own cell rather than folded into third string because it measured differently from
 * third string on both fit seasons, in the same direction on both.
 */
export const DEPTH_RANKS = ["first", "second", "third", "offChart"] as const;
export type DepthRank = (typeof DEPTH_RANKS)[number];

/** Everything past third string is third string: the published charts only ever run to three. */
export function depthRankFor(depthTeam: number | null): DepthRank {
  if (depthTeam === null) return "offChart";
  if (depthTeam <= 1) return "first";
  if (depthTeam === 2) return "second";
  return "third";
}

export interface DepthPriors {
  /**
   * How much the chart moves layer 1's belief about how much a man plays, per position and rank.
   *
   * ONE MULTIPLIER, ON SNAP SHARE, and everything else scales with it. The depth chart is a
   * statement about ROLE and nothing else — it does not say how many targets a slot receiver sees,
   * it says he is the slot receiver — and snap share is the quantity layer 1 holds that role in.
   * Applying separate corrections to targets and carries would be reading four claims out of a file
   * that makes one.
   *
   * Normalised so the position's own overall correction is one. The chart is allowed to reorder a
   * position and never to relevel it against the others: a league-wide multiplier on every
   * quarterback would move all thirty-two of them together and could not improve a ranking, and if
   * the model were badly levelled at a position that is layer 1's defect to fix rather than this
   * file's to paper over.
   */
  readonly bySnapShare: Readonly<Record<Position, Readonly<Record<DepthRank, number>>>>;
  /**
   * The most the chart may move a projection, either way, as a multiplier.
   *
   * Bounded for the reason `rookies.ts` bounds its landing term, and less tightly for a reason: a
   * depth chart is a much stronger claim in August than a landing spot is, and the correction it
   * needs at quarterback is genuinely large. What the bound stops is a thin cell asserting that a
   * third-string tight end is a starter.
   */
  readonly bound: number;
}

/** One club's published ordering, as the board consumes it: rank per player. */
export type DepthChart = ReadonlyMap<string, DepthRank>;

export interface MapDepthChartResult {
  readonly observations: readonly PlayerWeekObservation[];
  /** Rows naming a player the universe does not project. Reported, never silently dropped. */
  readonly unknownPlayers: readonly string[];
}

/**
 * THE INSTANT A PRE-GAME FACT ABOUT `season` MAY CLAIM: the season's first kickoff.
 *
 * Re-exported under this module's own established name — `ingest.ts` and every test in this
 * directory already import `firstKickoffFor` from here — but the definition itself now lives in
 * `team-store.ts`, consolidated with `source.ts`'s live-moment path onto the SAME unconditional
 * kickoff-instant metric (fix round, I4/I5: three near-identical queries against
 * `SCHEDULE_METRICS.pointSpread`, a stamp that can legitimately be missing, became one against
 * `SCHEDULE_METRICS.kickoffInstant`, which cannot).
 *
 * SCOPED TO WEEK ONE, EXPLICITLY (Task 3 fix round review, I1 — this bullet was stale before that
 * fix landed, since `team-store.ts`'s query used to take a minimum across every week with no week
 * predicate at all). A partially-ingested schedule holding week 2 onward but not week 1 yet would
 * otherwise return a LATER week's kickoff as though it were the season's first, which this module's
 * own `asOf` derivations below trust as a bound. `team-store.ts`'s `firstKickoffFor` now filters on
 * `week = 1` for exactly that reason; see its own docblock for the full account.
 */
export const firstKickoffFor = requireFirstKickoffFor;

/**
 * Turns one season's `depth_charts_YYYY.csv` into stamped observations.
 *
 * Narrowed to WEEK ONE, to the regular season, to the offence, and to players the engine projects.
 * The week-one chart is the only one a preseason board could have read, the offensive formation is
 * the only one carrying a fantasy position, and the universe decides who is projectable exactly as
 * it does for every other feed here.
 *
 * A player listed in several slots keeps his BEST rank. Charts list a man at both `WR` and `KR`, or
 * at `RB` and `HB`, and the highest place his club gave him anywhere is the claim it is making
 * about him.
 *
 * TWO SCHEMAS, because nflverse changed `depth_charts_YYYY.csv` between the 2025 and 2026 releases
 * without a version marker anywhere but the column list itself. `depth_charts_2019.csv` through
 * `depth_charts_2025.csv` carry `season`, `week`, `game_type`, `formation`, `depth_team`,
 * `depth_position`, `gsis_id` — one row per player per week, and week one is the one this board may
 * read. `depth_charts_2026.csv`, inspected directly against the real nflverse release, carries none
 * of those: it is `dt`, `team`, `player_name`, `espn_id`, `gsis_id`, `pos_grp_id`, `pos_grp`,
 * `pos_id`, `pos_name`, `pos_abb`, `pos_slot`, `pos_rank` — an ESPN-sourced feed, snapshotted on a
 * rolling basis (164 distinct `dt` stamps between March and August of the 2026 file) rather than
 * published once per week. `mapDepthChart` DISPATCHES on which columns the first row actually
 * carries and throws if neither marker is present, rather than guessing: a schema this adapter has
 * never seen is a stop-the-line event, identically to `client.ts`'s `malformed` classification for
 * every other feed here.
 *
 * THE DATED SCHEMA'S MAPPING DECISIONS, each checked against the real 2026 file rather than assumed:
 *
 * - NO WEEK COLUMN AT ALL, so "week one" is redefined as "the latest snapshot at or before the
 *   instant this call is allowed to know about" — the same `asOf` the caller already computes as
 *   one millisecond before the season's first kickoff (`ingestDepthCharts` derives it via
 *   `firstKickoffFor` exactly as before). This is the direct dated analogue of the legacy path's
 *   week-1 filter: both pick the one chart a manager could have read the morning of the opener.
 *   Snapshots dated after that instant are excluded outright — the identical leak defence the
 *   legacy path gets for free from `week === "1"` never admitting week 2.
 * - `pos_grp` IS THE FORMATION EQUIVALENT. The 2026 file carries exactly four distinct values:
 *   `"3WR 1TE"`, `"Base 3-4 D"`, `"Base 4-3 D"`, `"Special Teams"`. Every offensive position this
 *   engine ever reads (QB, RB, WR, TE, plus the offensive line and fullback the universe filter
 *   drops downstream) appears under `"3WR 1TE"` and only there — it is ESPN's one published offence
 *   grouping, not a personnel-package signal, and the file never varies it by team or by down. That
 *   makes it the literal counterpart of the legacy file's `formation === "Offense"`.
 * - `pos_rank` IS THE DEPTH NUMBER, already scoped to one position the way `depth_team` was: an
 *   arizona sample confirmed QB, RB, WR and TE each restart their own `pos_rank` at 1 for the club's
 *   top man at that spot, counting the whole depth (a nine-man WR list runs 1 through 9) rather than
 *   being capped at three the way the legacy `depth_team` column was. `depthRankFor` already buckets
 *   any number past 2 into `"third"`, so this needs no new bucketing — it is fed the same way
 *   `depth_team` always was.
 * - THE OUTPUT STAMP NOW SPLITS BY SCHEMA (Task 3, ruling B — this bullet was written differently
 *   before that ruling; see git history for the uniform version it replaced). The LEGACY path
 *   (`mapLegacyDepthChart`) still stamps every observation with the caller's `asOf`, uniformly,
 *   byte-identical to before: every published measurement was fitted against that convention and
 *   must not move, and the legacy schema carries no better instant to promote anyway. The DATED path
 *   (`mapDatedDepthChart`) now stamps each observation with the CHOSEN SNAPSHOT'S OWN `dt` instead —
 *   the real instant the file says this ordering was published, which is a strictly EARLIER and more
 *   honest claim than the cutoff it replaces. The `asOf`/cutoff parameter keeps its old job on the
 *   dated path too: it still decides WHICH snapshot counts (see `ingestDepthCharts`'s own
 *   `min(now, kickoff - 1ms)`, Task 3's other half of this same change) — it is simply no longer
 *   promoted into the written row once that snapshot is chosen.
 */
export function mapDepthChart(
  rows: readonly CsvRow[],
  projected: ReadonlySet<string>,
  season: number,
  asOf: Date,
): MapDepthChartResult {
  if (rows.length === 0) return { observations: [], unknownPlayers: [] };
  const columns = new Set(Object.keys(rows[0]!));
  if (columns.has("week")) return mapLegacyDepthChart(rows, projected, season, asOf);
  if (columns.has("dt")) return mapDatedDepthChart(rows, projected, season, asOf);
  throw new Error(
    `depth_charts_${season}.csv matches neither the legacy week/game_type/formation schema nor the ` +
      `dated dt/pos_grp schema; the published schema changed again. See mapDepthChart's docblock.`,
  );
}

/** The 2019-2025 schema: one row per player per week, week and formation named directly. */
function mapLegacyDepthChart(
  rows: readonly CsvRow[],
  projected: ReadonlySet<string>,
  season: number,
  asOf: Date,
): MapDepthChartResult {
  const best = new Map<string, number>();
  const unknown = new Set<string>();
  for (const row of rows) {
    if (required(row, "week", season) !== "1") continue;
    if (required(row, "game_type", season) !== NFLVERSE_CONFIG.seasonType) continue;
    if (required(row, "formation", season) !== "Offense") continue;
    const playerId = (row.gsis_id ?? "").trim();
    if (playerId === "") continue;
    const depth = Number(required(row, "depth_team", season));
    if (!Number.isFinite(depth) || depth < 1) continue;
    if (!projected.has(playerId)) {
      unknown.add(playerId);
      continue;
    }
    best.set(playerId, Math.min(best.get(playerId) ?? Number.POSITIVE_INFINITY, depth));
  }
  return finish(best, unknown, season, asOf);
}

/** The `"3WR 1TE"` offensive personnel group in the dated schema. See `mapDepthChart`'s docblock. */
const DATED_OFFENSE_POS_GRP = "3WR 1TE";

/** The 2026-onward schema: rolling `dt`-stamped snapshots, no week column. See `mapDepthChart`. */
function mapDatedDepthChart(
  rows: readonly CsvRow[],
  projected: ReadonlySet<string>,
  season: number,
  asOf: Date,
): MapDepthChartResult {
  // Compared as parsed instants rather than as raw strings: nflverse's own `dt` values carry no
  // milliseconds ("...:50Z") while `asOf` almost always does (it is `kickoff - 1ms`), and lexical
  // comparison of two ISO stamps that differ only in that trailing precision sorts them backwards.
  const cutoff = asOf.getTime();
  let snapshot: string | null = null;
  let snapshotTime = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const dt = required(row, "dt", season);
    const time = Date.parse(dt);
    if (!Number.isFinite(time)) {
      throw new Error(`depth_charts_${season}.csv has a "dt" value "${dt}" that does not parse as a date.`);
    }
    if (time > cutoff) continue;
    if (time > snapshotTime) {
      snapshot = dt;
      snapshotTime = time;
    }
  }
  // No snapshot at or before the cutoff is the dated schema's exact equivalent of the legacy path
  // finding no `week === "1"` row: an empty chart, not a thrown error. `ingestDepthCharts` still
  // reports it (`entriesRead` is zero), and a caller that expected rows notices from the count.
  if (snapshot === null) return { observations: [], unknownPlayers: [] };
  // THE SNAPSHOT'S OWN REAL PUBLICATION INSTANT (Task 3, ruling B) — what every row from this
  // snapshot is stamped with, in place of the caller's `asOf` cutoff. See `mapDepthChart`'s own
  // docblock, "THE OUTPUT STAMP NOW SPLITS BY SCHEMA", for why: this is the honest moment ESPN
  // published this ordering, strictly before `asOf` by construction (the loop above only ever keeps
  // a `dt` at or before it), and a strictly earlier, more honest claim than stamping every row with
  // the cutoff itself.
  const publishedAt = new Date(snapshotTime);

  const best = new Map<string, number>();
  const unknown = new Set<string>();
  for (const row of rows) {
    if (required(row, "dt", season) !== snapshot) continue;
    if (required(row, "pos_grp", season) !== DATED_OFFENSE_POS_GRP) continue;
    const playerId = (row.gsis_id ?? "").trim();
    if (playerId === "") continue;
    const depth = Number(required(row, "pos_rank", season));
    if (!Number.isFinite(depth) || depth < 1) continue;
    if (!projected.has(playerId)) {
      unknown.add(playerId);
      continue;
    }
    best.set(playerId, Math.min(best.get(playerId) ?? Number.POSITIVE_INFINITY, depth));
  }
  return finish(best, unknown, season, publishedAt);
}

/** Turns the best-rank map both schemas build into the shared result shape. */
function finish(best: ReadonlyMap<string, number>, unknown: ReadonlySet<string>, season: number, asOf: Date): MapDepthChartResult {
  return {
    observations: [...best.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([playerId, depth]) => ({
        season,
        week: 1,
        playerId,
        source: DEPTH_SOURCE,
        metric: DEPTH_METRIC,
        value: depth,
        asOf,
      })),
    unknownPlayers: [...unknown].sort(),
  };
}

function required(row: CsvRow, column: string, season: number): string {
  const value = row[column];
  if (value === undefined) {
    throw new Error(`depth_charts_${season}.csv has no ${column} column; the published schema changed.`);
  }
  return value.trim();
}

/**
 * Layer 1's opportunity, corrected by what the clubs published.
 *
 * Applied to the whole predicted line rather than to snap share alone, because everything a player
 * does scales with how much he is on the field, and applied BEFORE availability reads his snap
 * share so that a backup's shorter season follows from the same correction rather than from a
 * second rule about backups.
 */
export function applyDepthChart(
  opportunity: ReadonlyMap<string, PredictedOpportunity>,
  chart: DepthChart,
  positions: ReadonlyMap<string, Position>,
  priors: DepthPriors,
): ReadonlyMap<string, PredictedOpportunity> {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return new Map(
    [...opportunity].map(([playerId, player]) => {
      const position = positions.get(playerId);
      if (position === undefined) return [playerId, player] as const;
      const multiplier = depthMultiplier(position, chart.get(playerId) ?? "offChart", priors);
      return [
        playerId,
        {
          ...player,
          snapShare: clamp(player.snapShare * multiplier),
          targetShare: clamp(player.targetShare * multiplier),
          carryShare: clamp(player.carryShare * multiplier),
          passAttemptShare: clamp(player.passAttemptShare * multiplier),
        },
      ] as const;
    }),
  );
}

/** The bounded correction for one cell. Exported so a test and the fit report read the same number. */
export function depthMultiplier(position: Position, rank: DepthRank, priors: DepthPriors): number {
  const raw = priors.bySnapShare[position]?.[rank];
  if (raw === undefined || !(raw > 0) || !Number.isFinite(raw)) return 1;
  return Math.min(1 + priors.bound, Math.max(1 / (1 + priors.bound), raw));
}
