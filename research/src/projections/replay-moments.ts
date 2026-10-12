import { and, eq, inArray, max, min } from "drizzle-orm";
import type { ReadonlyDb } from "@research/db/client";
import { playerWeekObservations, teamWeekObservations } from "@research/db/schema";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "./nflverse/schedule";

/**
 * WHEN EACH WEEK BECAME KNOWABLE, read back out of the store rather than recomputed from a download.
 *
 * `replay` requires an injected `asOfForWeek` and refuses to guess one, for the reason its own
 * docblock gives: the honest moment is a fact about the real world, and a default computed from
 * nowhere would be a guess dressed as a guarantee. Until now the only way to obtain it was to
 * re-ingest the season, which put a hundred megabytes of network between an operator and an
 * ablation — and an ablation that is expensive to run is an ablation that gets skipped.
 *
 * This derives the same moments from the same rows. `ingest.ts` stamps every participation
 * observation with its own game's `gameDayAsOf` and reports the per-week maximum; the maximum of the
 * stored stamps for a week is that number by construction. So this is not a second derivation of the
 * stamp — it is the first one, read back — and a season ingested by either script produces identical
 * replay moments.
 */

/** The last moment anything in a week became knowable, per week, for one season. */
export async function weekAsOfFromStore(db: ReadonlyDb, season: number): Promise<ReadonlyMap<number, Date>> {
  const rows = await db
    .select({ week: playerWeekObservations.week, asOf: max(playerWeekObservations.asOf) })
    .from(playerWeekObservations)
    .where(eq(playerWeekObservations.season, season))
    .groupBy(playerWeekObservations.week);
  return new Map(
    rows
      .filter((row): row is { week: number; asOf: Date } => row.asOf !== null)
      .map((row) => [row.week, row.asOf] as const),
  );
}

/**
 * The replay moment for each week of `season`: when the PREVIOUS week's numbers landed.
 *
 * Week 1 borrows the end of the prior season, which is the honest answer — nothing about the new
 * season has happened yet. A season whose prior season is absent from the store is refused rather
 * than defaulted, because a week-1 replay dated from a guess would silently show the model either
 * nothing or everything, and neither failure announces itself.
 */
export async function replayMomentsFor(db: ReadonlyDb, season: number): Promise<(week: number) => Date> {
  const target = await weekAsOfFromStore(db, season);
  const prior = await weekAsOfFromStore(db, season - 1);
  if (target.size === 0) {
    throw new Error(`The store holds no observations for ${season}; run \`npm run projections:backfill\` before replaying it.`);
  }
  if (prior.size === 0) {
    throw new Error(
      `The store holds no observations for ${season - 1}, so week 1 of ${season} has no honest replay moment. Backfill the prior season first.`,
    );
  }
  const priorSeasonEnd = new Date(Math.max(...[...prior.values()].map((date) => date.getTime())));
  return (week: number): Date => target.get(week - 1) ?? priorSeasonEnd;
}

/**
 * THE PARTICIPATION SOURCES — the feeds whose stamps mark when a WEEK'S GAMES became knowable.
 *
 * Named explicitly rather than taken as "everything in the table", because the news pass writes
 * player-week rows too and they are stamped when a publisher filed them, days BEFORE the games. A
 * minimum taken over the whole table would therefore return an injury report's own timestamp, and a
 * replay moment derived from it would be defined in terms of the very rows it is meant to gate.
 */
const GAME_RESULT_SOURCES: readonly string[] = ["nflverse_snap_counts", "nflverse_player_week"];

/**
 * How far before the FIRST fact about a week the game-week moment sits.
 *
 * Thirty-six hours, and the number is a consequence of the stamping arithmetic rather than a taste.
 * `gameDayAsOf` stamps a game at the end of its UTC calendar day plus a 24-hour publication lag, so
 * the earliest stamp for a week is midnight UTC on the day after that week's first game, plus a day.
 * Subtracting thirty-six hours lands at noon UTC on the morning of that first game — seven in the
 * morning, Eastern — which is before any kickoff the NFL schedules, including a Thursday night one.
 *
 * Conservative in the only direction that matters. Being early costs the layer some legitimately
 * knowable data; being late would put a game's own result inside the moment it is projected from,
 * and every number the harness has ever produced would become suspect.
 */
const GAME_WEEK_ADVANCE_HOURS = 36;

const MILLISECONDS_PER_HOUR = 3_600_000;

/**
 * The replay moment for a week set as late as a WHOLE-WEEK replay can honestly be: the morning of
 * the week's first game.
 *
 * The standard moment is "when the previous week's numbers landed", which is the Tuesday. That is
 * the right moment for a waiver decision and the wrong one for a start-and-sit, and it is
 * specifically too early to see anything a publisher files during the game week — which is the whole
 * of what the news pass exists to read. This is the other end of the same window.
 *
 * IT IS STILL A WHOLE-WEEK MOMENT, and that is its limit rather than a defect to be tuned away. Every
 * player in the week is projected from one instant, so that instant must precede the EARLIEST
 * kickoff of the week, which is Thursday night. A designation the league files on the Friday is
 * therefore unreachable here no matter how the constant is set, and the fix is not a later moment —
 * it is a PER-PLAYER moment, his own game's kickoff, which is a change to the harness and not to a
 * number. See `docs/research/2026-08-27-model-v3.md`.
 *
 * The guarantee is checked rather than argued. The returned moment is asserted to be strictly
 * earlier than the first stored result for the week being projected, so no fact produced BY that
 * week's games can pass the as-of gate. That is the guarantee the store can actually make; whether
 * the moment also precedes the first kickoff follows from the stamping arithmetic above and from
 * the fact that the NFL schedules no game before Thursday evening.
 */
export async function gameWeekMomentsFor(db: ReadonlyDb, season: number): Promise<(week: number) => Date> {
  const rows = await db
    .select({ week: playerWeekObservations.week, asOf: min(playerWeekObservations.asOf) })
    .from(playerWeekObservations)
    .where(
      and(
        eq(playerWeekObservations.season, season),
        inArray(playerWeekObservations.source, [...GAME_RESULT_SOURCES]),
      ),
    )
    .groupBy(playerWeekObservations.week);
  const earliest = new Map(
    rows
      .filter((row): row is { week: number; asOf: Date } => row.asOf !== null)
      .map((row) => [row.week, row.asOf] as const),
  );
  if (earliest.size === 0) {
    throw new Error(`The store holds no game results for ${season}; run \`npm run projections:backfill\` before replaying it.`);
  }
  return (week: number): Date => {
    const first = earliest.get(week);
    if (first === undefined) {
      throw new Error(`The store holds no game results for ${season} week ${week}, so it has no game-week moment.`);
    }
    const moment = new Date(first.getTime() - GAME_WEEK_ADVANCE_HOURS * MILLISECONDS_PER_HOUR);
    if (moment.getTime() >= first.getTime()) {
      throw new Error(
        `The game-week moment for ${season} week ${week} (${moment.toISOString()}) is not earlier than that week's first result (${first.toISOString()}). A replay moment that can see the games it is projecting is not a replay moment.`,
      );
    }
    return moment;
  };
}

/**
 * THE PER-PLAYER MOMENT: every man replayed at the morning of HIS OWN game.
 *
 * `gameWeekMomentsFor` above is as late as a WHOLE-WEEK replay can honestly be, and its own docblock
 * names the wall it hits: one instant for the whole week must precede the week's earliest kickoff,
 * which is Thursday night, so a designation the league files on the Friday is unreachable no matter
 * how the constant is set. `docs/research/2026-08-27-model-v3.md` measured the cost of that wall —
 * only fifteen to nineteen percent of the injury wire was reachable by any whole-week moment — and
 * named the fix as a change to the harness rather than to a number. This is that change.
 *
 * A Sunday player is projected from Sunday morning and a Thursday player from Thursday morning, so
 * the Friday filing about the Sunday player is READ, and the Friday filing about the Thursday player
 * is still refused, because his game was already played. That is the honest line and it is drawn per
 * player because that is where the real world draws it.
 *
 * THE MOMENT IS THE KICKOFF ITSELF, read from the schedule's own start time. `schedule.ts`'s
 * `kickoffInstant` function computes it and `SCHEDULE_METRICS.kickoffInstant` (fix round, I4/I5)
 * stamps it, UNCONDITIONALLY, for every scheduled game — so the minimum of a club's kickoff-stamped
 * marker facts IS that club's kickoff, and there is no arithmetic left to get wrong. A fact stamped
 * at that instant is admitted, which is the intent rather than an accident: the closing line is
 * settled at kickoff and a manager setting a lineup has it. A fact stamped one millisecond later is
 * refused.
 *
 * READS `SCHEDULE_METRICS.kickoffInstant`, NOT `pointSpread` (fix round, I4/I5 — this function used
 * to key off the betting line, the SAME latent defect `team-store.ts`'s own `firstKickoffFor`
 * docblock names: a real, scheduled game can carry no line at all past week six of a real season, so
 * a lined-games-only read would have silently returned `null` for a game the market never priced,
 * rather than that game's real kickoff). One shared metric, three former near-duplicates
 * (`depth.ts`, `source.ts`'s live path, this function) now converged on it.
 *
 * Returns null for a club with no scheduled game that week, and the caller falls back to the
 * whole-week moment rather than inventing one.
 */
export async function playerGameMomentsFor(
  db: ReadonlyDb,
  season: number,
): Promise<(week: number, team: string) => Date | null> {
  const rows = await db
    .select({
      week: teamWeekObservations.week,
      team: teamWeekObservations.team,
      asOf: min(teamWeekObservations.asOf),
    })
    .from(teamWeekObservations)
    .where(
      and(
        eq(teamWeekObservations.season, season),
        eq(teamWeekObservations.source, SCHEDULE_SOURCE.kickoff),
        eq(teamWeekObservations.metric, SCHEDULE_METRICS.kickoffInstant),
      ),
    )
    .groupBy(teamWeekObservations.week, teamWeekObservations.team);
  const kickoffs = new Map(
    rows
      .filter((row): row is { week: number; team: string; asOf: Date } => row.asOf !== null)
      .map((row) => [`${row.week}|${row.team}`, row.asOf] as const),
  );
  if (kickoffs.size === 0) {
    throw new Error(
      `The store holds no kickoff-stamped facts for ${season}, so no player can be replayed at his own game. Run \`npm run projections:context\` before replaying it.`,
    );
  }
  return (week: number, team: string): Date | null => kickoffs.get(`${week}|${team}`) ?? null;
}
