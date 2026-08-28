import { eq, max } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { playerWeekObservations } from "@/db/schema";

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
