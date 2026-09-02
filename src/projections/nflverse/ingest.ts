import { readFileSync } from "node:fs";
import type { Db } from "@/db/client";
import type { SeasonStatLine } from "../lines";
import { deleteObservationsBySource, recordObservations } from "../store";
import { recordPlayerTeams, recordTeamObservations, teamObservationsAsOf, type TeamWeekObservation } from "../team-store";
import { indexTeamMetrics } from "../team-context";
import { LAST_POSSIBLE_WEEK } from "../store";
import { coachObservations, seasonMeans } from "./coaches";
import { parsePlayCallers, playCallerLookup } from "./play-callers";
import { DEFENCE_METRICS, opponentDefenceObservations, type DefenceWeek } from "../features/context";
import { recordNflPlayers } from "../universe";
import { createNflverseClient, NflverseError, type NflverseClient } from "./client";
import type { CsvRow } from "./csv";
import { NFLVERSE_CONFIG } from "./config";
import {
  DERIVED_STAT_LINE_SOURCE,
  DerivedStatLineAggregator,
  deriveStatLines,
  derivedStatLineObservations,
  weekAsOfFromDerivedLines,
} from "./derived-stat-lines";
import {
  mapParticipation,
  participationObservations,
  weekAsOfFromSnapCounts,
  NFLVERSE_SOURCE,
  PARTICIPATION_METRICS,
  SNAP_COUNT_ASSET_FLOOR,
} from "./map";
import { PlayByPlayAggregator, playProfileObservations, PBP_COLUMNS } from "./pbp";
import { PlayerPlayAggregator, playerTouchObservations, PBP_PLAYER_COLUMNS } from "./pbp-players";
import { allPositions } from "../backtest";
import { mapInjuries } from "../news/retrieve";
import { buildPlayerUniverse, mapNflPlayers, nflPlayerRows, type PlayerUniverse } from "./players";
import {
  gameResultObservations,
  kickoffAsOf,
  mapSchedule,
  scheduleObservations,
  weekAsOfFromSchedule,
  SCHEDULE_SOURCE_CONFIG,
} from "./schedule";
import { mapStatLines, statLineObservations, STAT_LINE_GAPS } from "./stat-lines";
import { lineContinuityObservations, mapPlayerTeams } from "./team-map";

/**
 * ONE SEASON, FROM RELEASE TO STORE — the sequence every script that touches nflverse runs.
 *
 * It exists because two scripts need it (the backfill and the report) and a second copy of an
 * ingestion is a second place for the `as_of` derivation to drift. The stamp is the whole point of
 * the store; two implementations of it, differing by a few hours, would make a backtest replayed by
 * one script disagree with the same backtest replayed by the other and nobody would know which was
 * honest.
 *
 * The universe is fetched ONCE and passed in, not fetched per season: it is a single seven-megabyte
 * release covering every year, and re-parsing it per season would be six downloads to answer the
 * same question.
 *
 * TWO UPSTREAM HOLES, TWO BRANCHES, AND THEY ARE NOT THE SAME HOLE. `fetchPlayerWeek` handles the
 * seasons whose PUBLISHED WEEKLY STATS were never released (`STAT_LINE_GAPS`: 2019, 2025), where the
 * stat lines have to be derived from play-by-play instead. `fetchSnapCounts` handles the seasons
 * BELOW `SNAP_COUNT_ASSET_FLOOR` (2012), where the weekly stats are published and it is the
 * PARTICIPATION half that does not exist: the 2003-2012 extension ingests published stat lines for
 * every one of those seasons and gets no participation at all, which is the opposite shape from a
 * gap season and is reported as `snapCountsUnavailable` rather than folded into one "thin" flag.
 */

/**
 * The moment a derivation reads the store at when it is deriving a fact about the PAST.
 *
 * A coach's prior pace is computed from seasons that are over, so the honest read is the final,
 * corrected one — the same choice `backtest.ts` makes for actuals and `projection-fit.ts` makes for
 * fitting. The point-in-time gate governs what a MODEL may see when predicting; the resulting fact
 * carries its own `as_of`, which is what a replay is bounded by.
 */
const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");

/** Everything one season's ingestion reports about itself, which the operator is expected to read. */
export interface SeasonIngestReport {
  readonly season: number;
  readonly participationRows: number;
  readonly statLines: number;
  /** How many observations were ACTUALLY new — a re-run of a landed ingestion reports 0. */
  readonly observationsWritten: number;
  /** Distinct skill-position people placed in the universe, over those the files listed. */
  readonly participationResolution: number | null;
  readonly statLineResolution: number | null;
  /** Everyone the universe could not place, named and counted. Never silently dropped. */
  readonly unresolved: readonly { readonly id: string; readonly name: string; readonly occurrences: number }[];
  /**
   * When each week's numbers became knowable, from that week's LAST game. Returned rather than
   * recomputed by the caller, because a replay's as-of moments must be derived from exactly the
   * same rows the ingestion was: two derivations of one stamp is how a leak gets in.
   */
  readonly weekAsOf: ReadonlyMap<number, Date>;
  /**
   * TRUE when this season's weekly stats file did not exist, so `participationRows` counts rows
   * whose `targets`/`carries`/`pass_attempts`/team totals were WITHHELD rather than written — see
   * the comment above the filter in `ingestSeason`. Fix round, M5: a caller reading only
   * `participationRows` would otherwise read "6218 participation rows" and reasonably assume full
   * participation data landed, when for a gap season only the two snap-count-sourced metrics did.
   */
  readonly playerWeekUnavailable: boolean;
  /**
   * TRUE when this season predates nflverse's snap-count release (`SNAP_COUNT_ASSET_FLOOR`), so
   * NOTHING participation-shaped landed at all — not the two snap-count metrics, and not the six
   * `playerWeek`-sourced ones either, since `mapParticipation` builds a player-week from a
   * snap-count row and has nothing to hang a target on without one. The stat lines DID land, dated
   * from the schedule (`weekAsOfFromSchedule`). Reported for the same reason
   * `playerWeekUnavailable` is: "0 participation rows" beside a full set of stat lines is a fact
   * about the upstream release, not a thin ingestion.
   */
  readonly snapCountsUnavailable: boolean;
}

/** Fetches and stores the historical player universe. Run once, before any season. */
export async function ingestPlayerUniverse(db: Db, client: NflverseClient): Promise<PlayerUniverse> {
  const rows = await client.getCsv(NFLVERSE_CONFIG.releases.players, NFLVERSE_CONFIG.files.players);
  const universe = mapNflPlayers(rows);
  await recordNflPlayers(db, nflPlayerRows(universe));
  return buildPlayerUniverse(universe);
}

/**
 * The weekly player-stats file, or an empty release for a season nflverse never published one for.
 *
 * `client.ts`'s own docblock is explicit that `not_found` "is the ordinary case of asking for a
 * season nflverse has not published yet and is NOT an alarm" — before this, `ingestSeason` did not
 * live up to that: it let the 404 propagate uncaught, so nobody could ever run a backfill spanning
 * 2019 at all. Catching ONLY `not_found`, and only for this one asset, keeps that promise: an
 * `upstream` failure (GitHub or the release being down) or a `malformed` one (the schema moved) must
 * still throw and stop the backfill, because those two ARE alarms.
 *
 * FIX ROUND, M7: `STAT_LINE_GAPS` (`stat-lines.ts`) is the one season this 404 is EXPECTED for. A
 * season NOT on that list returning empty here is a different fact entirely — nflverse dropped or
 * renamed a release this engine has never seen missing — and silently treating it the same as the
 * known 2019 hole would let a real upstream break through as a quiet, thin backfill instead of a
 * loud one. `console.warn` rather than a throw: the fallback to `[]` is still safe (the false-zero
 * participation bug this same fix round closed means an unexpected gap degrades honestly, to
 * absent data, not to wrong data) so this is an operator's problem to investigate, not a reason to
 * abort a backfill that is otherwise proceeding correctly for every other season.
 */
/** The six participation metrics `mapParticipation` builds from `playerWeek` rather than from snap
 *  counts — see `ingestSeason`'s own comment on why these, and only these, are withheld (and, if
 *  found stale, cleaned up under I4) for a season whose weekly stats file does not exist. */
const PLAYERWEEK_PARTICIPATION_METRICS: readonly string[] = [
  PARTICIPATION_METRICS.targets,
  PARTICIPATION_METRICS.teamTargets,
  PARTICIPATION_METRICS.carries,
  PARTICIPATION_METRICS.teamCarries,
  PARTICIPATION_METRICS.passAttempts,
  PARTICIPATION_METRICS.teamPassAttempts,
];

async function fetchPlayerWeek(client: NflverseClient, season: number): Promise<readonly CsvRow[]> {
  try {
    return await client.getCsv(NFLVERSE_CONFIG.releases.playerWeek, `stats_player_week_${season}.csv`);
  } catch (error) {
    if (error instanceof NflverseError && error.kind === "not_found") {
      if (!STAT_LINE_GAPS.includes(season)) {
        console.warn(
          `WARNING: nflverse has no weekly stats for ${season}, and ${season} is not in STAT_LINE_GAPS. ` +
            `This is not the known 2019 hole; investigate before trusting this season's participation or stat lines.`,
        );
      }
      return [];
    }
    throw error;
  }
}

/**
 * The snap-count file, or an empty release for a season that predates the one nflverse first
 * published — the mirror of `fetchPlayerWeek` above, and it exists for the mirror-image reason.
 *
 * `fetchPlayerWeek` catches the 404 for the seasons in the MIDDLE of the range whose weekly stats
 * were never released; this catches the 404 for every season BELOW `SNAP_COUNT_ASSET_FLOOR` (2012),
 * where the snap-count release simply does not reach. Before it existed, a backfill of any season
 * older than 2012 died on its first download and the published weekly stats sitting right there
 * upstream were unreachable.
 *
 * Only `not_found`, only this asset, and LOUD above the floor: a missing `snap_counts_2018.csv` is
 * nflverse dropping a release this engine has always read, and treating it like ordinary history
 * would turn that into a quiet season with no participation rather than an alarm.
 */
async function fetchSnapCounts(client: NflverseClient, season: number): Promise<readonly CsvRow[]> {
  try {
    return await client.getCsv(NFLVERSE_CONFIG.releases.snapCounts, `snap_counts_${season}.csv`);
  } catch (error) {
    if (error instanceof NflverseError && error.kind === "not_found") {
      if (season >= SNAP_COUNT_ASSET_FLOOR) {
        console.warn(
          `WARNING: nflverse has no snap counts for ${season}, which is at or above SNAP_COUNT_ASSET_FLOOR ` +
            `(${SNAP_COUNT_ASSET_FLOOR}). This is not the ordinary shape of pre-2012 history; investigate before ` +
            `trusting this season's participation.`,
        );
      }
      return [];
    }
    throw error;
  }
}

/**
 * PER-SEASON WEEK AS-OFS FROM THE SCHEDULE, FETCHED ONCE — what `ingestSeason` needs for a season
 * with no snap-count file of its own (`SNAP_COUNT_ASSET_FLOOR`).
 *
 * One `games.csv` covers every season, so a ten-season backfill pays for one two-megabyte download
 * here rather than one per season, exactly as `ingestSchedule` and `ingestCoaches` already treat the
 * same file. Read-only: this writes nothing, and the schedule's own OBSERVATIONS remain
 * `ingestSchedule`'s job.
 */
export async function scheduleWeekAsOf(
  seasons: readonly number[],
  client = createScheduleClient(),
): Promise<ReadonlyMap<number, ReadonlyMap<number, Date>>> {
  const rows = await client.getCsv(SCHEDULE_SOURCE_CONFIG.release, SCHEDULE_SOURCE_CONFIG.file);
  const games = mapSchedule(rows, seasons);
  return new Map(seasons.map((season) => [season, weekAsOfFromSchedule(games.filter((game) => game.season === season))]));
}

export async function ingestSeason(
  db: Db,
  client: NflverseClient,
  universe: PlayerUniverse,
  season: number,
  /**
   * The week as-ofs to use when this season has NO snap-count file to derive them from — built by
   * `scheduleWeekAsOf` and passed in rather than fetched here, so a ten-season backfill downloads
   * `games.csv` once. Injected rather than defaulted so a caller that reaches a pre-2012 season
   * without having thought about the stamp fails loudly (see the throw below) instead of quietly
   * pulling a second file.
   */
  scheduleAsOf?: ReadonlyMap<number, Date>,
): Promise<SeasonIngestReport> {
  const snapCounts = await fetchSnapCounts(client, season);
  const playerWeek = await fetchPlayerWeek(client, season);
  // Snap counts stay the first choice for every season that has them; the schedule is the fallback
  // for the seasons below `SNAP_COUNT_ASSET_FLOOR`, on identical stamp arithmetic (see
  // `weekAsOfFromSchedule`). A season with neither has no honest way to date a stat line, and
  // `mapStatLines` would throw one week at a time; throwing here says why once.
  if (snapCounts.length === 0 && scheduleAsOf === undefined) {
    throw new Error(
      `nflverse has no snap counts for ${season} and no schedule-derived week as-ofs were supplied, so its stat ` +
        `lines cannot be dated. Pass scheduleWeekAsOf([...]).get(${season}) for seasons below SNAP_COUNT_ASSET_FLOOR.`,
    );
  }
  const weekAsOf =
    snapCounts.length > 0 ? weekAsOfFromSnapCounts(snapCounts, NFLVERSE_CONFIG.publicationLagHours) : scheduleAsOf!;

  const participation = mapParticipation({ snapCounts, playerWeek, universe });
  const statLines = mapStatLines({ playerWeek, weekAsOf, universe });

  // `mapParticipation` cannot tell "this player genuinely had zero targets" apart from "the weekly
  // file this season's targets/carries/pass-attempts come from does not exist" — it falls back to
  // `NO_USAGE` (real zeros) either way (`map.ts`'s `own = playerUsage.get(...) ?? NO_USAGE`), which
  // is the right call for the ordinary case (a lineman who genuinely recorded nothing) and the wrong
  // one for a whole gap season (every skill player would read as a false zero). So for a season
  // where `playerWeek` came back empty, the playerWeek-SOURCED participation metrics are dropped here
  // before they are written — absent, not falsely zero — while the snap-count-sourced ones
  // (`offensive_snaps`, `team_offensive_snaps`) are unaffected and still land, because snap counts
  // are a genuinely separate release that exists for 2019.
  const participationRows = participationObservations(participation.participation).filter(
    (row) => playerWeek.length > 0 || row.source !== NFLVERSE_SOURCE.playerWeek,
  );

  // FIX ROUND, I4: this filter alone stops the poisoning going FORWARD, but any environment that
  // ran the earlier buggy `ingestSeason` before this fix already has the false zeros sitting in its
  // store, and `recordObservations`'s `onConflictDoNothing` would keep them there forever — nothing
  // about re-running this ingestion, on its own, removes a row it no longer writes. So when
  // `playerWeek` is empty, this ALSO deletes any pre-existing rows for exactly the six
  // playerWeek-sourced participation metrics, scoped by metric (not by source alone) so a
  // published stat line sharing the same source string is never touched. Idempotent and loud: the
  // second run of this against an already-clean season finds and removes nothing, and the first run
  // against a poisoned one says so.
  if (playerWeek.length === 0) {
    const removedFalseZeros = await deleteObservationsBySource(db, season, NFLVERSE_SOURCE.playerWeek, PLAYERWEEK_PARTICIPATION_METRICS);
    if (removedFalseZeros > 0) {
      console.warn(
        `WARNING: removed ${removedFalseZeros} stale false-zero participation observations for ${season} ` +
          `(targets/carries/pass_attempts written by a version of ingestSeason that predates this fix).`,
      );
    }
  }

  const observationsWritten =
    (await recordObservations(db, participationRows)) +
    (await recordObservations(db, statLineObservations(statLines.statLines)));

  // Both derived from the snap counts already in hand, so they cost no second download. The
  // player-to-team edge is what every Phase 3 context feature joins on, and line continuity is the
  // one part of the offensive line composite that needs no play-by-play at all.
  await recordPlayerTeams(db, mapPlayerTeams(snapCounts, universe));
  await recordTeamObservations(db, lineContinuityObservations(snapCounts, season));

  const unresolved = new Map<string, { id: string; name: string; occurrences: number }>();
  for (const row of [...participation.unresolved, ...statLines.unresolved]) {
    const already = unresolved.get(row.id);
    unresolved.set(
      row.id,
      already === undefined ? { id: row.id, name: row.name, occurrences: row.occurrences } : { ...already, occurrences: already.occurrences + row.occurrences },
    );
  }

  return {
    season,
    participationRows: participation.participation.length,
    statLines: statLines.statLines.length,
    observationsWritten,
    participationResolution: participation.resolutionRate,
    statLineResolution: statLines.resolutionRate,
    unresolved: [...unresolved.values()],
    weekAsOf,
    playerWeekUnavailable: playerWeek.length === 0,
    snapCountsUnavailable: snapCounts.length === 0,
  };
}

/**
 * THE CONTEXT INGESTION — play-by-play and the schedule, which `ingestSeason` deliberately does not
 * touch.
 *
 * Separate because the costs are two orders of magnitude apart. `ingestSeason` pulls a few
 * megabytes and is run by the report script every time somebody wants a scoreboard; a season of
 * play-by-play is a hundred megabytes, and putting it on that path would make printing a scoreboard
 * a coffee break. This is run when the seasons change, exactly as the backfill is.
 *
 * The schedule covers every season in one small file, so it is fetched once for a list of them
 * rather than once per season.
 */
export interface ContextIngestReport {
  readonly season: number;
  readonly playsRead: number;
  readonly teamWeeks: number;
  /** Player-weeks of red-zone and air-yard counts written beside the team-week facts. */
  readonly playerWeeks: number;
  readonly observationsWritten: number;
  /** Everyone the play-by-play attributed a touch to that the universe does not project. */
  readonly unknownPlayers: number;
}

/** The schedule repository is a different host from the release assets — see `schedule.ts`. */
function createScheduleClient(): NflverseClient {
  return createNflverseClient({ baseUrl: SCHEDULE_SOURCE_CONFIG.baseUrl });
}

/**
 * Opponent, rest, venue, weather and the closing line, for every named season at once.
 *
 * The two `source` stamps the mapper applies are the load-bearing part: half of this file is
 * knowable in May and half only at kickoff, and the store is where that difference is recorded.
 */
export async function ingestSchedule(db: Db, seasons: readonly number[], client = createScheduleClient()): Promise<number> {
  const rows = await client.getCsv(SCHEDULE_SOURCE_CONFIG.release, SCHEDULE_SOURCE_CONFIG.file);
  return await recordTeamObservations(db, scheduleObservations(mapSchedule(rows, seasons)));
}

/**
 * The game-RESULT rows only, for a store that already holds every other schedule fact.
 *
 * `ingestSchedule` above writes results too (they are part of `scheduleObservations` now), so a
 * store built from scratch never needs this. It exists for the store that already exists: running
 * the full schedule ingestion again to pick up one added metric would also write every row the
 * upstream file has gained since the last run, which is a data change nobody asked for and which no
 * `--check` baseline in this repo would attribute correctly. See `gameResultObservations`.
 */
export async function ingestGameResults(db: Db, seasons: readonly number[], client = createScheduleClient()): Promise<number> {
  const rows = await client.getCsv(SCHEDULE_SOURCE_CONFIG.release, SCHEDULE_SOURCE_CONFIG.file);
  return await recordTeamObservations(db, gameResultObservations(mapSchedule(rows, seasons)));
}

/**
 * One season of play-by-play, streamed and reduced to team-week AND player-week facts as it
 * arrives.
 *
 * Stamped from the game's own date, on exactly the arithmetic `gameDayAsOf` uses for a box score:
 * end of the game's UTC calendar day plus the publication lag. A pace number is knowable when the
 * game that produced it has finished and not before.
 *
 * ONE STREAM, TWO AGGREGATORS. A season is a hundred megabytes, so a second pass to collect the
 * red-zone counts would double the cost of a backfill to read the same rows a second time. The two
 * accumulators are independent — neither reads the other's state — so feeding both from one loop is
 * a saving with no coupling attached.
 */
export async function ingestPlayByPlay(db: Db, client: NflverseClient, season: number): Promise<ContextIngestReport> {
  const teams = new PlayByPlayAggregator();
  const players = new PlayerPlayAggregator();
  const columns = [...new Set([...PBP_COLUMNS, ...PBP_PLAYER_COLUMNS])];
  const playsRead = await client.streamCsv("pbp", `play_by_play_${season}.csv`, columns, (row) => {
    teams.add(row);
    players.add(row);
  });
  const profiles = teams.profiles();
  const observations = playProfileObservations(profiles, (profile) =>
    kickoffAsOf(profile.gameDate, NFLVERSE_CONFIG.publicationLagHours),
  );

  // The universe decides who is storable, exactly as it does for the participation feed: the store
  // is keyed on a player the backtest can score through, and a touch attributed to a punter or to
  // an id the release does not carry has nowhere to go. Reported rather than dropped in silence.
  const projected = new Set((await allPositions(db)).keys());
  const touches = playerTouchObservations(
    players.touches(),
    (touch) => kickoffAsOf(touch.gameDate, NFLVERSE_CONFIG.publicationLagHours),
    projected,
  );

  return {
    season,
    playsRead,
    teamWeeks: profiles.length,
    playerWeeks: touches.observations.length === 0 ? 0 : new Set(touches.observations.map((row) => `${row.week}|${row.playerId}`)).size,
    observationsWritten:
      (await recordTeamObservations(db, observations)) + (await recordObservations(db, touches.observations)),
    unknownPlayers: touches.unknownPlayers.length,
  };
}

/** Everything one season's pbp-derived stat-line COMPUTATION reports about itself — no write. */
export interface DerivedStatLineComputation {
  readonly season: number;
  readonly playsRead: number;
  readonly unknownPlayers: number;
  readonly derivedLines: readonly SeasonStatLine[];
}

/**
 * ONE SEASON OF PLAY-BY-PLAY, REDUCED TO PBP-DERIVED STAT-LINE OUTCOMES — a SECOND, INDEPENDENT
 * stream of the same release `ingestPlayByPlay` reads, not a third aggregator folded into that call.
 *
 * The two are kept apart deliberately. `ingestPlayByPlay` is the CONTEXT ingestion
 * (`scripts/projection-context.ts`): it runs over the whole backfill window every time the seasons
 * change and writes team-week and player-touch FEATURES. This is the GAP-SEASON derivation
 * (`scripts/projection-backfill.ts`'s gap-season branch): it runs only for the seasons named in
 * `STAT_LINE_GAPS` (today, 2019 and 2025) plus the one non-gap season the spec requires as a validation
 * control (2018), and it computes stat-line OUTCOMES. Folding this into `ingestPlayByPlay` would make
 * every context backfill — every season, every time — pay for a stat-line derivation almost nothing
 * ever reads (`statLinesAsOfForMeasurement` only ever admits a gap season's rows). A second download
 * of two seasons' worth of play-by-play costs minutes on a run that already happens rarely; paying
 * that cost on every one of the twelve seasons `projection-context.ts` touches, every time it is run,
 * would not be free by comparison.
 *
 * NEVER WRITES (fix round, M3/I3). `scripts/projection-backfill.ts`'s validation run needs 2018's
 * derived lines purely to compare against 2018's published ones in memory — it is not a gap season
 * and its derived rows have no reason to exist in the store at all. `ingestDerivedStatLines` below is
 * the ONLY writer; it wraps this function and adds the write, so the validation path (which calls
 * this function directly) touches the database with reads only, by construction, not by convention.
 */
export async function computeDerivedStatLines(db: Db, client: NflverseClient, season: number): Promise<DerivedStatLineComputation> {
  const aggregator = new DerivedStatLineAggregator();
  const playsRead = await client.streamCsv("pbp", `play_by_play_${season}.csv`, DerivedStatLineAggregator.COLUMNS, (row) =>
    aggregator.add(row),
  );
  const lines = aggregator.lines();

  const projected = new Set((await allPositions(db)).keys());
  const { statLines, unknownPlayers } = deriveStatLines(lines, weekAsOfFromDerivedLines(lines, NFLVERSE_CONFIG.publicationLagHours), projected);

  return { season, playsRead, unknownPlayers: unknownPlayers.length, derivedLines: statLines };
}

/** Everything one season's pbp-derived stat-line ingestion reports about itself. */
export interface DerivedStatLineIngestReport {
  readonly season: number;
  readonly playsRead: number;
  readonly statLines: number;
  readonly observationsWritten: number;
  readonly unknownPlayers: number;
  /**
   * The mapped lines themselves, not just their count — `scripts/projection-backfill.ts`'s
   * validation step (`seasonPointsAgreement`) needs exactly this shape and reads it straight off the
   * report rather than issuing a second query for what this call just wrote.
   */
  readonly derivedLines: readonly SeasonStatLine[];
}

/**
 * `computeDerivedStatLines` PLUS THE WRITE — the ONLY function in this module that puts a derived
 * stat line in the store.
 *
 * SELF-SUPERSEDING (fix round, I5). Deletes every existing `DERIVED_STAT_LINE_SOURCE` row for this
 * season, then writes the freshly computed ones, in ONE transaction. Without the delete,
 * `recordObservations`'s `onConflictDoNothing` would keep a STALE value forever the moment the
 * derivation itself changes: a corrected formula recomputes the SAME season under the SAME `as_of`
 * (the game's own kickoff never moves), so a re-run's rows collide on the exact unique-index key the
 * old, wrong rows already occupy, and the insert would silently do nothing. This is exactly what
 * happened to the first version of this derivation's already-landed 2019 rows when the missing
 * `two_point_attempt` column (C1) was fixed — the corrected rows would not have replaced the
 * inflated ones without this delete. Recomputable-by-construction is what makes the delete safe: a
 * derived row is never a primary record of anything, only ever the current best recomputation of it.
 */
export async function ingestDerivedStatLines(db: Db, client: NflverseClient, season: number): Promise<DerivedStatLineIngestReport> {
  const computation = await computeDerivedStatLines(db, client, season);
  const observations = derivedStatLineObservations(computation.derivedLines);

  const observationsWritten = await db.transaction(async (tx) => {
    await deleteObservationsBySource(tx, season, DERIVED_STAT_LINE_SOURCE);
    return recordObservations(tx, observations);
  });

  return {
    season,
    playsRead: computation.playsRead,
    statLines: computation.derivedLines.length,
    observationsWritten,
    unknownPlayers: computation.unknownPlayers,
    derivedLines: computation.derivedLines,
  };
}

/** The committed play-caller table, relative to the process's working directory (the repo root). */
const PLAY_CALLERS_CSV_PATH = "data/play-callers/play-callers.csv";

/**
 * The play-caller table: tenure, and an incoming play-caller's own pace and pass-rate history.
 *
 * Run AFTER the play-by-play, and the ordering is not incidental: a coach's prior pace is the mean
 * of the situation-neutral pace of every offence he ran before this season, so it can only be
 * computed once those seasons' play-by-play is in the store. Run first, it would write a table of
 * nulls and nothing downstream would complain — the scheme prior would simply fall back to the
 * league for every coaching change, which is exactly the case the feature exists to handle.
 *
 * Reads the committed play-caller CSV straight off disk rather than over the network — it ships in
 * the repo, checked in beside the code that reads it. A missing file is a broken checkout, not a
 * degraded feature, so this THROWS rather than falling back to head-coach-only silently: an operator
 * who deleted or renamed the file should see the ingestion fail, not a report that looks clean but
 * quietly lost the coordinator-level attribution for every team-season.
 */
export async function ingestCoaches(db: Db, seasons: readonly number[], client = createScheduleClient()): Promise<number> {
  const rows = await client.getCsv(SCHEDULE_SOURCE_CONFIG.release, SCHEDULE_SOURCE_CONFIG.file);
  // Every season back to the earliest the store could hold, so a coach hired in 2024 is credited
  // with the offences he ran in 2016 rather than looking like a first-time head coach.
  const earliest = Math.min(...seasons);
  const history = Array.from({ length: Math.max(...seasons) - earliest + 1 }, (_, index) => earliest + index);
  const games = mapSchedule(rows, history);

  const playCallers = playCallerLookup(parsePlayCallers(readFileSync(PLAY_CALLERS_CSV_PATH, "utf8")));

  const all: TeamWeekObservation[] = [];
  for (const season of history) {
    all.push(
      ...(await teamObservationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FAR_FUTURE })),
    );
  }
  const metrics = indexTeamMetrics({ playerTeams: [], teamObservations: all });
  const weeks = Array.from({ length: LAST_POSSIBLE_WEEK }, (_, index) => index + 1);
  return await recordTeamObservations(db, coachObservations(games, seasonMeans(metrics, weeks), seasons, playCallers));
}

/**
 * The opponent adjustment, derived from what is already in the store.
 *
 * Run AFTER the play-by-play, like the coach table and for the same reason: the ratings are built
 * from what each defence allowed, which the play-by-play ingestion is what writes. Run first, it
 * would rate every defence exactly league average and the feature would measure as nothing.
 *
 * A derivation rather than an ingestion — it reaches no network except for the schedule, which is
 * two megabytes and covers every season. Re-running it after a change of method costs seconds,
 * which is the point of keeping the method here rather than inside the play-by-play stream.
 */
export async function ingestOpponentDefence(db: Db, seasons: readonly number[], client = createScheduleClient()): Promise<number> {
  const rows = await client.getCsv(SCHEDULE_SOURCE_CONFIG.release, SCHEDULE_SOURCE_CONFIG.file);
  // The prior season too, so week 1 carries last season's final ratings rather than no adjustment.
  const earliest = Math.min(...seasons) - 1;
  const history = Array.from({ length: Math.max(...seasons) - earliest + 1 }, (_, index) => earliest + index);
  const games = mapSchedule(rows, history);

  const observations: TeamWeekObservation[] = [];
  for (const season of history) {
    observations.push(
      ...(await teamObservationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FAR_FUTURE })),
    );
  }
  const metrics = indexTeamMetrics({ playerTeams: [], teamObservations: observations });

  const defenceWeeks: DefenceWeek[] = games.map((game) => ({
    season: game.season,
    week: game.week,
    defence: game.team,
    offence: game.opponent,
    passYardsAllowedPerDropback: metrics(game.team, { season: game.season, week: game.week }, DEFENCE_METRICS.pass),
    rushYardsAllowedPerCarry: metrics(game.team, { season: game.season, week: game.week }, DEFENCE_METRICS.rush),
    asOf: game.kickoffAsOf,
  }));

  return await recordTeamObservations(db, opponentDefenceObservations(games, defenceWeeks, seasons));
}

/**
 * THE NEWS PASS'S RETRIEVAL — the official injury report, stamped when the league filed it.
 *
 * A separate step from the play-by-play because it is a different kind of fact and a very much
 * smaller file: under a megabyte a season, against a hundred. It is also the only ingestion in the
 * engine whose stamps are not derived from a game's date, which is the whole reason the news pass
 * exists — see `news/retrieve.ts`.
 *
 * The universe is read once and reused across seasons, exactly as the play-by-play ingestion does.
 */
export interface NewsIngestReport {
  readonly season: number;
  readonly reportRows: number;
  readonly observationsWritten: number;
  readonly unknownPlayers: number;
}

export async function ingestInjuryReports(
  db: Db,
  client: NflverseClient,
  seasons: readonly number[],
): Promise<readonly NewsIngestReport[]> {
  const projected = new Set((await allPositions(db)).keys());
  const reports: NewsIngestReport[] = [];
  for (const season of seasons) {
    const rows = await client.getCsv(NFLVERSE_CONFIG.releases.injuries, `injuries_${season}.csv`);
    const mapped = mapInjuries(rows, projected);
    reports.push({
      season,
      reportRows: rows.length,
      observationsWritten: await recordObservations(db, mapped.observations),
      unknownPlayers: mapped.unknownPlayers.length,
    });
  }
  return reports;
}
