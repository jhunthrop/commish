import type { ReadonlyDb } from "@/db/client";
import { kickingWeekRowsForSeasons } from "../nflverse/kicking-weeks";
import { SCHEDULE_METRICS } from "../nflverse/schedule";
import { teamDefenseWeekRowsForSeasons } from "../nflverse/team-defense-weeks";
import { LAST_POSSIBLE_WEEK } from "../store";
import { teamObservationsAsOf } from "../team-store";
import { kickerSeasonsFrom, type KickerSeason } from "./kicker";
import { defenseGamesFrom, pointsAllowedKey, type DefenseGame } from "./team-defense";

/**
 * THE ONE READ BOTH THE FIT AND THE BOARD GO THROUGH (the 2026-09-05 kicker and team defence round).
 *
 * A kicker's and a team defence's history come from three places — the kicking archive, the team
 * defence archive, and the schedule's own points-allowed metric — and the join between the last two
 * is the kind that is easy to get subtly wrong in two different ways in two different callers. It is
 * written once here, so the fit script and the board builder can never disagree about what a club's
 * history is.
 *
 * `asOf` GATES THE SCORES AND NOT THE ARCHIVES, and the asymmetry is deliberate. The two archives
 * hold completed seasons only and the CALLER decides which seasons to ask for, which is where the
 * point-in-time discipline lives for them (`kickingWeekRowsFor`'s own docblock says the same). The
 * schedule's points-allowed rows are `afterTheGame`-stamped team observations that a live board
 * could otherwise see for the season it is projecting, so those go through the ordinary `asOf` gate
 * every other team fact does.
 */

export interface KdefHistory {
  readonly kickerSeasons: readonly KickerSeason[];
  readonly defenseGames: readonly DefenseGame[];
  /** Archived defence rows whose game score the store could not supply. Reported, never zeroed — see
   *  `defenseGamesFrom`, which drops them rather than inventing a shutout. */
  readonly defenseGamesWithoutScore: number;
}

/**
 * Every club's points allowed, keyed `"<season>|<week>|<team>"`, as `defenseGamesFrom` needs it.
 *
 * BOTH SIDES OF THIS JOIN ARE NORMALISED THROUGH `productTeamCode`, and that is not defensive
 * tidiness — it is the whole reason `team-codes.ts` exists. The two feeds spell the same club
 * differently in the covered span: the `stats_team` release normalises every club to its CURRENT
 * code (the 2013 Rams read `LA`), while `games.csv`, which the schedule observations are built from,
 * uses the CONTEMPORARY code (the same club reads `STL`). Keying on the raw codes silently dropped
 * exactly 224 club-games from a 2013-2023 fit: St. Louis's three seasons, San Diego's four and
 * Oakland's seven, 16 games each, every one of them a real defensive season that simply vanished
 * from the sample. It was visible only because `defenseGamesFrom` COUNTS what it drops rather than
 * swallowing it.
 */
async function pointsAllowedByKey(
  db: ReadonlyDb,
  seasons: readonly number[],
  asOf: Date,
): Promise<ReadonlyMap<string, number>> {
  const byKey = new Map<string, number>();
  for (const season of seasons) {
    const rows = await teamObservationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
    for (const row of rows) {
      if (row.metric !== SCHEDULE_METRICS.pointsAllowed) continue;
      byKey.set(pointsAllowedKey(row.season, row.week, row.team), row.value);
    }
  }
  return byKey;
}

/** Both positions' history for the given seasons, read through one gate. */
export async function loadKdefHistory(db: ReadonlyDb, seasons: readonly number[], asOf: Date): Promise<KdefHistory> {
  const kickingRows = await kickingWeekRowsForSeasons(db, seasons);
  const defenseRows = await teamDefenseWeekRowsForSeasons(db, seasons);
  const scores = await pointsAllowedByKey(db, seasons, asOf);
  const defenseGames = defenseGamesFrom(defenseRows, scores);
  return {
    kickerSeasons: kickerSeasonsFrom(kickingRows),
    defenseGames,
    defenseGamesWithoutScore: defenseRows.length - defenseGames.length,
  };
}
