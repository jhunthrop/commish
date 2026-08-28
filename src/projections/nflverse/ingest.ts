import type { Db } from "@/db/client";
import { recordObservations } from "../store";
import { recordPlayerTeams, recordTeamObservations, teamObservationsAsOf, type TeamWeekObservation } from "../team-store";
import { indexTeamMetrics } from "../team-context";
import { LAST_POSSIBLE_WEEK } from "../store";
import { coachObservations, seasonMeans } from "./coaches";
import { DEFENCE_METRICS, opponentDefenceObservations, type DefenceWeek } from "../features/context";
import { recordNflPlayers } from "../universe";
import { createNflverseClient, type NflverseClient } from "./client";
import { NFLVERSE_CONFIG } from "./config";
import { mapParticipation, participationObservations, weekAsOfFromSnapCounts } from "./map";
import { PlayByPlayAggregator, playProfileObservations, PBP_COLUMNS } from "./pbp";
import { PlayerPlayAggregator, playerTouchObservations, PBP_PLAYER_COLUMNS } from "./pbp-players";
import { allPositions } from "../backtest";
import { buildPlayerUniverse, mapNflPlayers, nflPlayerRows, type PlayerUniverse } from "./players";
import { kickoffAsOf, mapSchedule, scheduleObservations, SCHEDULE_SOURCE_CONFIG } from "./schedule";
import { mapStatLines, statLineObservations } from "./stat-lines";
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
}

/** Fetches and stores the historical player universe. Run once, before any season. */
export async function ingestPlayerUniverse(db: Db, client: NflverseClient): Promise<PlayerUniverse> {
  const rows = await client.getCsv(NFLVERSE_CONFIG.releases.players, NFLVERSE_CONFIG.files.players);
  const universe = mapNflPlayers(rows);
  await recordNflPlayers(db, nflPlayerRows(universe));
  return buildPlayerUniverse(universe);
}

export async function ingestSeason(
  db: Db,
  client: NflverseClient,
  universe: PlayerUniverse,
  season: number,
): Promise<SeasonIngestReport> {
  const snapCounts = await client.getCsv(NFLVERSE_CONFIG.releases.snapCounts, `snap_counts_${season}.csv`);
  const playerWeek = await client.getCsv(NFLVERSE_CONFIG.releases.playerWeek, `stats_player_week_${season}.csv`);
  const weekAsOf = weekAsOfFromSnapCounts(snapCounts, NFLVERSE_CONFIG.publicationLagHours);

  const participation = mapParticipation({ snapCounts, playerWeek, universe });
  const statLines = mapStatLines({ playerWeek, weekAsOf, universe });

  const observationsWritten =
    (await recordObservations(db, participationObservations(participation.participation))) +
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

/**
 * The play-caller table: tenure, and an incoming coach's own pace and pass-rate history.
 *
 * Run AFTER the play-by-play, and the ordering is not incidental: a coach's prior pace is the mean
 * of the situation-neutral pace of every offence he ran before this season, so it can only be
 * computed once those seasons' play-by-play is in the store. Run first, it would write a table of
 * nulls and nothing downstream would complain — the scheme prior would simply fall back to the
 * league for every coaching change, which is exactly the case the feature exists to handle.
 */
export async function ingestCoaches(db: Db, seasons: readonly number[], client = createScheduleClient()): Promise<number> {
  const rows = await client.getCsv(SCHEDULE_SOURCE_CONFIG.release, SCHEDULE_SOURCE_CONFIG.file);
  // Every season back to the earliest the store could hold, so a coach hired in 2024 is credited
  // with the offences he ran in 2016 rather than looking like a first-time head coach.
  const earliest = Math.min(...seasons);
  const history = Array.from({ length: Math.max(...seasons) - earliest + 1 }, (_, index) => earliest + index);
  const games = mapSchedule(rows, history);

  const all: TeamWeekObservation[] = [];
  for (const season of history) {
    all.push(
      ...(await teamObservationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FAR_FUTURE })),
    );
  }
  const metrics = indexTeamMetrics({ playerTeams: [], teamObservations: all });
  const weeks = Array.from({ length: LAST_POSSIBLE_WEEK }, (_, index) => index + 1);
  return await recordTeamObservations(db, coachObservations(games, seasonMeans(metrics, weeks), seasons));
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
