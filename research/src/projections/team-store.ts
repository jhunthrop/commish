import { and, asc, desc, eq, gte, lte, min } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@research/db/client";
import { playerWeekTeams, teamWeekObservations } from "@research/db/schema";
import type { WeekRange } from "./store";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "./nflverse/schedule";

/**
 * THE TEAM-LEVEL POINT-IN-TIME STORE — `store.ts` one level up, and deliberately its twin.
 *
 * Everything Phase 3's context layers read comes through here: the offensive line composite, pace
 * and pass rate over expected, the opponent's adjusted defence, the game script, the weather, the
 * rest. Each is a property of a team in a week with no player to hang on.
 *
 * The two functions here are copies of `observationsAsOf`'s shape rather than a generalisation of
 * it, and that is a considered choice. A shared implementation over a nullable `player_id` would
 * save forty lines and would put the one predicate this engine cannot afford to get wrong — `as_of
 * <= …` — behind a layer of parameterisation, where a caller that forgot to narrow the key would
 * read a hundred thousand player rows and average them into a team number. Two small, obvious
 * functions that each do one read are worth more here than one clever one.
 *
 * NULL IS NOT ZERO, as everywhere else in the engine. A team with no pace row for a week did not
 * play at zero seconds per play; it has no evidence, and a caller must carry that distinction
 * rather than defaulting it away.
 */

/** One quantity, for one team, in one week, as it was known at one moment. */
export interface TeamWeekObservation {
  readonly season: number;
  readonly week: number;
  /** nflverse team abbreviation — `CLE`, `BUF`. */
  readonly team: string;
  /** Which derivation said it — `nflverse_pbp`, `nflverse_schedule`. */
  readonly source: string;
  readonly metric: string;
  readonly value: number;
  /** When this fact became knowable. NOT when it was written down. */
  readonly asOf: Date;
}

/** Which offence a player was in, for one week, as it was known at one moment. */
export interface PlayerWeekTeam {
  readonly season: number;
  readonly week: number;
  readonly playerId: string;
  readonly team: string;
  readonly asOf: Date;
}

export interface TeamObservationQuery {
  readonly season: number;
  readonly week: number | WeekRange;
  /** The replay moment. Nothing stamped after this is visible, ever. */
  readonly asOf: Date;
  readonly source?: string;
}

/** Matches `store.ts`' own chunking, and for the same Postgres bind-parameter ceiling. */
const INSERT_CHUNK_ROWS = 2_000;

function assertFiniteValues(rows: readonly TeamWeekObservation[]): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (!Number.isFinite(row.value)) {
      throw new Error(
        `Team observation ${row.source}/${row.metric} for ${row.team} (${row.season} week ${row.week}) is not a finite number.`,
      );
    }
    const key = [row.season, row.week, row.team, row.source, row.metric, row.asOf.getTime()].join(" ");
    const previous = seen.get(key);
    // Two different values for one fact at one instant is a derivation bug, and `onConflictDoNothing`
    // would keep whichever Postgres inserted first and discard the other in silence. Silently
    // choosing between two contradictory numbers is the failure this store exists to prevent.
    if (previous !== undefined && previous !== row.value) {
      throw new Error(
        `Team observations contradict: ${row.source}/${row.metric} for ${row.team} (${row.season} week ${row.week}) is both ${previous} and ${row.value} as of ${row.asOf.toISOString()}.`,
      );
    }
    seen.set(key, row.value);
  }
}

/** Writes team observations idempotently. Returns how many rows were ACTUALLY new. */
export async function recordTeamObservations(db: Db, rows: readonly TeamWeekObservation[]): Promise<number> {
  assertFiniteValues(rows);
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const inserted = await db
      .insert(teamWeekObservations)
      .values(rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row })))
      .onConflictDoNothing()
      .returning({ id: teamWeekObservations.id });
    written += inserted.length;
  }
  return written;
}

/** Writes player-to-team edges idempotently. Returns how many rows were ACTUALLY new. */
export async function recordPlayerTeams(db: Db, rows: readonly PlayerWeekTeam[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const inserted = await db
      .insert(playerWeekTeams)
      .values(rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row })))
      .onConflictDoNothing()
      .returning({ id: playerWeekTeams.id });
    written += inserted.length;
  }
  return written;
}

function weekPredicateFor(week: number | WeekRange) {
  return typeof week === "number"
    ? eq(teamWeekObservations.week, week)
    : and(gte(teamWeekObservations.week, week.from), lte(teamWeekObservations.week, week.to));
}

/**
 * Every team fact the engine was allowed to know at `asOf`, and not one row more.
 *
 * `DISTINCT ON` over the fact key with `as_of` descending gives the latest STATEMENT at or before
 * the replay moment, so a pace number restated by a later nflverse rebuild is seen as it stood.
 */
export async function teamObservationsAsOf(
  db: ReadonlyDb,
  { season, week, asOf, source }: TeamObservationQuery,
): Promise<readonly TeamWeekObservation[]> {
  return await db
    .selectDistinctOn(
      [teamWeekObservations.week, teamWeekObservations.team, teamWeekObservations.source, teamWeekObservations.metric],
      {
        season: teamWeekObservations.season,
        week: teamWeekObservations.week,
        team: teamWeekObservations.team,
        source: teamWeekObservations.source,
        metric: teamWeekObservations.metric,
        value: teamWeekObservations.value,
        asOf: teamWeekObservations.asOf,
      },
    )
    .from(teamWeekObservations)
    .where(
      and(
        eq(teamWeekObservations.season, season),
        weekPredicateFor(week),
        lte(teamWeekObservations.asOf, asOf),
        source === undefined ? undefined : eq(teamWeekObservations.source, source),
      ),
    )
    .orderBy(
      asc(teamWeekObservations.week),
      asc(teamWeekObservations.team),
      asc(teamWeekObservations.source),
      asc(teamWeekObservations.metric),
      desc(teamWeekObservations.asOf),
    );
}

/**
 * Which offence each player was in, over a span of weeks, as it was known at `asOf`.
 *
 * A player who has not yet played a down for his new team is still on his old one here, and that is
 * correct rather than a limitation: the transaction wire is not a source this engine reads, so the
 * earliest honest moment a trade is knowable is the first snap that proves it.
 */
export async function playerTeamsAsOf(
  db: ReadonlyDb,
  { season, week, asOf }: Omit<TeamObservationQuery, "source">,
): Promise<readonly PlayerWeekTeam[]> {
  const weekPredicate =
    typeof week === "number"
      ? eq(playerWeekTeams.week, week)
      : and(gte(playerWeekTeams.week, week.from), lte(playerWeekTeams.week, week.to));
  return await db
    .selectDistinctOn([playerWeekTeams.week, playerWeekTeams.playerId], {
      season: playerWeekTeams.season,
      week: playerWeekTeams.week,
      playerId: playerWeekTeams.playerId,
      team: playerWeekTeams.team,
      asOf: playerWeekTeams.asOf,
    })
    .from(playerWeekTeams)
    .where(and(eq(playerWeekTeams.season, season), weekPredicate, lte(playerWeekTeams.asOf, asOf)))
    .orderBy(asc(playerWeekTeams.week), asc(playerWeekTeams.playerId), desc(playerWeekTeams.asOf));
}

/**
 * THE ONE DEFINITION OF "A SEASON'S FIRST KICKOFF" (fix round, live-board Task 2 — I4/I5).
 *
 * Before this, three call sites each ran their own copy of essentially this query — `preseason/
 * depth.ts`'s own `firstKickoffFor`, `preseason/source.ts`'s live-moment path, and
 * `replay-moments.ts`'s `playerGameMomentsFor` — and all three keyed off `SCHEDULE_METRICS.
 * pointSpread`, the CONTINGENT stamp (`scheduleObservations` only emits it when the file carries a
 * line). Checked directly against 2026: a real, scheduled game can carry no line at all past week
 * six, so a minimum taken over lined games can silently return a moment AFTER the season's actual
 * first kickoff — the exact leak `SCHEDULE_METRICS.kickoffInstant`'s own docblock names. This reads
 * that metric instead: UNCONDITIONAL, emitted for every scheduled game regardless of pricing.
 *
 * `null` (not a throw) when the store holds no kickoff instants for `season` at all — every caller
 * that needs a season to genuinely have one uses `requireFirstKickoffFor` below instead.
 *
 * WEEK ONE, EXPLICITLY (fix round review, I1) — THE SINGLE POINT EVERYTHING ELSE IN THIS CHAIN
 * REDUCES TO. Before this, the query took `min(asOf)` over EVERY week's kickoff row for the season,
 * with no week predicate at all. That is silently wrong the moment a season's ingest is PARTIAL: a
 * store holding week 2 onward but not week 1 yet (an ingest that started mid-week, or a schedule
 * release updated out of order) would report week 2's kickoff as though it were the season's first —
 * and everything downstream trusts that value as a bound. `preseason/source.ts`'s `liveMomentFor`
 * would cap "now" against a fake, later kickoff and could produce a live moment for a season that has
 * actually already started (past the REAL first kickoff, before the FAKE one this query reported);
 * `preseason/ingest.ts`'s `ingestDepthCharts` would compute an ingest cutoff from the same fake
 * instant. Both are the exact leak this whole chain of fixes exists to close. `eq(week, 1)` makes the
 * value definitionally week one's kickoff — never a later week's, whatever that week's own store state.
 */
export async function firstKickoffFor(db: ReadonlyDb, season: number): Promise<Date | null> {
  const [row] = await db
    .select({ earliest: min(teamWeekObservations.asOf) })
    .from(teamWeekObservations)
    .where(
      and(
        eq(teamWeekObservations.season, season),
        eq(teamWeekObservations.week, 1),
        eq(teamWeekObservations.source, SCHEDULE_SOURCE.kickoff),
        eq(teamWeekObservations.metric, SCHEDULE_METRICS.kickoffInstant),
      ),
    );
  return row?.earliest ?? null;
}

/** `firstKickoffFor`, throwing rather than returning `null` — the shape every pre-existing call
 *  site (`preseason/depth.ts`'s `firstKickoffFor` re-export, `preseason/ingest.ts`) already
 *  depended on before this consolidation, and the one `source.ts`'s replay-adjacent call sites use
 *  when a missing schedule is a refusal rather than a value a caller must branch on. */
export async function requireFirstKickoffFor(db: ReadonlyDb, season: number): Promise<Date> {
  const kickoff = await firstKickoffFor(db, season);
  if (kickoff === null) {
    throw new Error(
      `The store holds no ${season} kickoff instants, so the season's first kickoff cannot be derived. Run \`npm run projections:context\` first.`,
    );
  }
  return kickoff;
}

/**
 * `firstKickoffFor`'s own query, generalised across every week rather than pinned to week one —
 * props-backfill Task 1's own need: one snapshot instant per REGULAR-SEASON week, and the store
 * already carries only regular-season weeks (`kickoffInstant` is written under
 * `NFLVERSE_CONFIG.seasonType === "REG"`, `nflverse/schedule.ts`'s own filter), so the weeks this
 * returns are, by construction, exactly the weeks a props backfill should ever ask the odds API
 * about — no separate playoff exclusion needed here.
 *
 * `GROUP BY week` rather than eighteen calls to `firstKickoffFor` with a week predicate bolted on:
 * one query, one round trip, and a season the store has not ingested at all returns an empty map
 * rather than eighteen individual nulls.
 */
export async function kickoffInstantsByWeek(db: ReadonlyDb, season: number): Promise<ReadonlyMap<number, Date>> {
  const rows = await db
    .select({ week: teamWeekObservations.week, earliest: min(teamWeekObservations.asOf) })
    .from(teamWeekObservations)
    .where(
      and(
        eq(teamWeekObservations.season, season),
        eq(teamWeekObservations.source, SCHEDULE_SOURCE.kickoff),
        eq(teamWeekObservations.metric, SCHEDULE_METRICS.kickoffInstant),
      ),
    )
    .groupBy(teamWeekObservations.week);

  const byWeek = new Map<number, Date>();
  for (const row of rows) {
    if (row.earliest !== null) byWeek.set(row.week, row.earliest);
  }
  return byWeek;
}
