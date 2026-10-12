import type { ReadonlyDb } from "@research/db/client";
import { allPositions } from "../backtest";
import { availabilityStoreCoverage, injuryReportsBySeason, rosterWeeksBySeason, seasonAvailabilityRecords } from "../availability/season-record";
import { FITTED_MODEL } from "../model/source";
import { LAST_POSSIBLE_WEEK } from "../store";
import { usageAsOf } from "../usage";
import { ageAtSeason, teamGamesIn, type SeasonAvailability } from "./availability";
import type { AvailabilityObservation } from "./availability-fit";
import { availabilityDesignationOf, availabilityStatusFor } from "./availability-status";
import { withCurrentStatus } from "./current-status";
import { FITTED_DEPTH_PRIORS } from "./fitted";
import { FINAL_OUTCOME, HISTORY_SEASONS, SHIPPED_PRESEASON_FEATURES, boardOpportunity, loadPreseason, type PreseasonPriors } from "./source";
import { preseasonRostersAsOf } from "./store";

/**
 * THE AVAILABILITY HISTORY — a player's per-season record (games played, games unavailable) read
 * from the stat store and the two designation archives, for the board (`loadPreseason`) and for
 * the availability fit (`loadAvailabilityObservations`).
 *
 * THIS MODULE AND `source.ts` IMPORT EACH OTHER, deliberately and narrowly: `loadPreseason` reads
 * `availabilityBySeason` from here, and `loadAvailabilityObservations` here runs the board harness
 * (`loadPreseason`, `boardOpportunity`) from there so the fit brackets on the board's own snap
 * share. Every edge is used inside a function body and nothing at module evaluation, which is the
 * only kind of cycle ES modules resolve without surprise.
 */

/** The weeks each player appeared in, one season, from the store's own opportunity rows. */
async function playedWeeksFor(db: ReadonlyDb, season: number, asOf: Date): Promise<ReadonlyMap<string, readonly number[]>> {
  const rows = await usageAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
  const weeks = new Map<string, number[]>();
  for (const row of rows) {
    const list = weeks.get(row.playerId) ?? [];
    list.push(row.week);
    weeks.set(row.playerId, list);
  }
  return weeks;
}

/**
 * Each player's availability record, per season: the weeks he played through the caller's own
 * gated read, the weeks he was unavailable through the designation archives (a completed prior
 * season's retrospective fact, so no gate; `season-record.ts`'s own docblock). Nothing here ever
 * reads the season being projected: every caller passes prior seasons only.
 */
export async function availabilityBySeason(
  db: ReadonlyDb,
  seasons: readonly number[],
  asOf: Date,
): Promise<{ readonly covered: ReadonlySet<number>; readonly bySeason: ReadonlyMap<number, ReadonlyMap<string, SeasonAvailability>> }> {
  const [covered, rosterRows, injuryRows] = await Promise.all([
    availabilityStoreCoverage(db, seasons),
    rosterWeeksBySeason(db, seasons),
    injuryReportsBySeason(db, seasons),
  ]);
  const bySeason = new Map<number, ReadonlyMap<string, SeasonAvailability>>();
  for (const season of seasons) {
    bySeason.set(
      season,
      seasonAvailabilityRecords({
        season,
        teamGames: teamGamesIn(season),
        covered: covered.has(season),
        playedWeeks: await playedWeeksFor(db, season, asOf),
        rosterRows: rosterRows.get(season) ?? new Map(),
        injuryRows: injuryRows.get(season) ?? new Map(),
      }),
    );
  }
  return { covered, bySeason };
}

/**
 * One season of availability labels: who was on a week-one roster, and how many games he then
 * played.
 *
 * The population is the week-one roster rather than everyone who appeared, and that is the whole
 * design. Fitting on players who appeared would condition on the outcome — a man who missed the
 * season would be absent from his own label — and the model would learn that everybody plays
 * fifteen games.
 */
export async function loadAvailabilityObservations(
  db: ReadonlyDb,
  seasons: readonly number[],
  priors: Pick<PreseasonPriors, "model" | "depth"> = { model: FITTED_MODEL, depth: FITTED_DEPTH_PRIORS },
): Promise<readonly AvailabilityObservation[]> {
  const positions = await allPositions(db);
  const earliest = Math.min(...seasons) - HISTORY_SEASONS;
  const latest = Math.max(...seasons);
  const spanSeasons = Array.from({ length: latest - earliest + 1 }, (_, index) => earliest + index);
  const { covered, bySeason: availability } = await availabilityBySeason(db, spanSeasons, FINAL_OUTCOME);

  const observations: AvailabilityObservation[] = [];
  for (const season of seasons) {
    const roster = await preseasonRostersAsOf(db, { season, asOf: FINAL_OUTCOME });
    // Role comes from the same preseason inputs a board would have had, never from the completed
    // season: a term fitted against a snap share the season itself produced would be fitted against
    // a quantity that does not exist in August. And it is THE BOARD'S OWN snap share, offseason and
    // depth chart applied (`boardOpportunity`), so the bracket a player is fitted in is the bracket
    // the board will later read him in. The depth priors are the committed ones: the depth fit runs
    // after this one in `scripts/preseason-fit.ts`, the same standing `FITTED_MODEL` has here.
    // THE STATUS IS THE SAME RESOLUTION THE BOARD READS (current-status round): the week-one
    // archive's code and detail at the season's own moment, through `withCurrentStatus`, so the
    // cell a man is fitted in is the cell the board will later read him in.
    const { inputs } = await withCurrentStatus(db, await loadPreseason(db, season));
    const { opportunity } = boardOpportunity(inputs, SHIPPED_PRESEASON_FEATURES, priors);
    for (const row of roster) {
      const position = positions.get(row.playerId);
      if (position === undefined) continue;
      const history: SeasonAvailability[] = [];
      for (let prior = season - HISTORY_SEASONS; prior <= season - 1; prior += 1) {
        const record = availability.get(prior)?.get(row.playerId);
        if (record !== undefined) history.push(record);
      }
      const label = availability.get(season)?.get(row.playerId);
      const current = inputs.currentStatus.get(row.playerId);
      observations.push({
        season,
        playerId: row.playerId,
        position,
        age: ageAtSeason(row.birthDate, season),
        status: availabilityStatusFor(current, row.status),
        designation: availabilityDesignationOf(current),
        projectedSnapShare: opportunity.get(row.playerId)?.snapShare ?? 0,
        history,
        baselineRate: null,
        // THE LABEL is still games played: the model predicts games, and a healthy scratch scores
        // nothing that week whatever his availability was.
        gamesPlayed: label?.gamesPlayed ?? 0,
        // A man on the week-one roster with no record in a covered season was neither played nor
        // unavailable in any week: available all year. Uncovered stays null.
        gamesUnavailable: label?.gamesUnavailable ?? (covered.has(season) ? 0 : null),
        gamesSuspended: label?.gamesSuspended ?? (covered.has(season) ? 0 : null),
      });
    }
  }
  return observations;
}
