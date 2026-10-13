import type { Position } from "@research-ts/domain/player";
import type { RosterPlayer, ShareMove } from "../features/redistribution";
import { REDISTRIBUTION_CONFIG } from "../features/redistribution";
import type { PlayerWeekTeam } from "../team-store";
import { latestTeams } from "../team-context";
import type { PlayerWeekUsage } from "../usage";

/**
 * WHO LEFT AND WHO ARRIVED, from snap counts alone.
 *
 * The engine subscribes to no transaction wire, so a trade is knowable here exactly one week after
 * it happened: the Sunday a man takes a snap for somebody else. That is later than a human would
 * know it and it is the earliest this data can honestly say it, which is the trade the whole
 * point-in-time store exists to make. `playerTeamsAsOf` enforces it; nothing in this file can
 * reach past it.
 *
 * A DEPARTURE IS BROADER THAN A TRADE and deliberately so. Three things produce an identical
 * situation for the players left behind — a trade, a release, and an injury that ends a season —
 * and all three are visible the same way: a man who was taking a share of this offence's work has
 * stopped. The feature does not need to know which it was, and pretending to distinguish them from
 * snap counts would be inventing a fact.
 *
 * OFFSEASON MOVES COUNT TOO. The window spans the prior season, so a receiver who left in March is
 * a departure from the moment his replacement plays a down for somebody else — which matters more
 * than a midseason trade, because in September layer 1 is leaning hardest on a prior-season mean
 * that was accumulated alongside him. Week 1 cannot see it: nobody has played yet, so there is no
 * evidence of anybody's new team. That is a real limit and it is where a transaction feed would pay.
 */

export const TRANSACTION_CONFIG = {
  /** The fewest weeks with a team before a player's absence counts as a departure from it. */
  minWeeksWithTeam: 3,
  /** How many of the team's own games a player must have missed before he counts as gone. */
  absenceTeamGames: 2,
  /** How many of a player's most recent weeks with a team his vacated share is measured over. */
  shareWindowWeeks: 6,
  /** The most weeks with a new team a player can have and still count as having just arrived. */
  maxWeeksToCountAsArrival: 2,
  /**
   * The smallest combined target-plus-carry share whose departure is worth redistributing.
   *
   * Without a floor here the detector fires on nearly every team-week in the league: a fifth
   * receiver who took 1% of the targets for three weeks last season and is now gone is a departure
   * by every structural test, and there are dozens of him. Measured on the fit seasons, an
   * unfiltered detector found a departure in 1,080 of 1,152 team-weeks and the estimated absorption
   * collapsed to 0.015 — not because redistribution does not happen, but because the signal was
   * averaged against a thousand non-events. Ten percent is roughly a genuine second receiver, and
   * was chosen by a sweep on the fit seasons alone.
   */
  minVacatedShare: 0.1,
  /**
   * How many of the team's own games a departure stays relevant for.
   *
   * The feature exists to say in week 7 what layer 1's recency weighting works out by week 10. By
   * week 11 the model has four games of evidence about the new distribution and does not need to be
   * told; applying a redistribution then would be adding a correction on top of a correction. A
   * departure detected long ago is therefore NOT a departure as far as this feature is concerned,
   * and the window is the same one the founder asked the ablation to measure over.
   *
   * TWO, chosen on the fit seasons. Swept there over one to four games and 6, 10 and 15% of vacated
   * share, the absorption falls monotonically as the window widens — 0.065 at two games against
   * 0.044 at four — which is what one would expect: by the third game layer 1's own recency
   * weighting has seen the new distribution and no longer needs telling. Two is the narrowest
   * window that can admit a RELEASE at all, since an absence takes two missed games to prove.
   *
   * THE SWEEP NEVER FOUND AN ABSORPTION ABOVE 0.09 AT ANY SETTING, and that is the headline result
   * of this task rather than a footnote about a constant.
   */
  relevantForTeamGames: 2,
} as const;

/** One offence's transactions, and the roster left to absorb them. */
export interface TeamTransactions {
  readonly team: string;
  readonly roster: readonly RosterPlayer[];
  readonly departures: readonly ShareMove[];
  readonly arrivals: readonly ShareMove[];
}

/** Everything the detector needs, all of it already through the as-of gate. */
export interface TransactionInput {
  readonly usage: readonly PlayerWeekUsage[];
  readonly playerTeams: readonly PlayerWeekTeam[];
  readonly positions: ReadonlyMap<string, Position>;
  /** Layer 1's predicted snap share per player — the depth chart the weights are read through. */
  readonly snapShares: ReadonlyMap<string, number>;
}

/** One player-week's shares, keyed for the joins below. */
interface PlayerWeek {
  readonly season: number;
  readonly week: number;
  readonly playerId: string;
  readonly team: string;
  readonly targetShare: number;
  readonly carryShare: number;
}

/** Ordering that makes "the last six weeks" mean the same thing across a season boundary. */
function chronologically(a: { season: number; week: number }, b: { season: number; week: number }): number {
  return a.season - b.season || a.week - b.week;
}

function meanOfLast(weeks: readonly PlayerWeek[], field: "targetShare" | "carryShare"): number {
  const recent = [...weeks].sort(chronologically).slice(-TRANSACTION_CONFIG.shareWindowWeeks);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, week) => sum + week[field], 0) / recent.length;
}

/**
 * Joins usage to the team each player was actually in that week.
 *
 * A null share becomes zero HERE and only here, and it is safe only because of what is being
 * measured: this is "how much of this offence's work did he take", and a week where his team threw
 * no passes really is a week in which he took none of them. Everywhere else in the engine null is
 * not zero, so the exception is spelled out rather than left to a reader to notice.
 */
function playerWeeks(input: TransactionInput): readonly PlayerWeek[] {
  const teamOf = new Map(input.playerTeams.map((edge) => [`${edge.season}|${edge.week}|${edge.playerId}`, edge.team] as const));
  const rows: PlayerWeek[] = [];
  for (const row of input.usage) {
    const team = teamOf.get(`${row.season}|${row.week}|${row.playerId}`);
    if (team === undefined) continue;
    rows.push({
      season: row.season,
      week: row.week,
      playerId: row.playerId,
      team,
      targetShare: row.targetShare ?? 0,
      carryShare: row.carryShare ?? 0,
    });
  }
  return rows;
}

/**
 * How much more of the work a teammate took in the weeks the departing player was absent.
 *
 * Direct evidence, and the reason it outranks the depth chart: a coordinator's actual answer to
 * "who plays when he does not" beats any inference from snap counts. `null` unless the history
 * contains enough such weeks to mean something — one game is a coin flip.
 */
function upliftWhenAbsent(
  teammate: readonly PlayerWeek[],
  departedWeeks: ReadonlySet<string>,
): number | null {
  const apart = teammate.filter((week) => !departedWeeks.has(`${week.season}|${week.week}`));
  const together = teammate.filter((week) => departedWeeks.has(`${week.season}|${week.week}`));
  if (apart.length < REDISTRIBUTION_CONFIG.minGamesApartForEvidence || together.length === 0) return null;
  const mean = (weeks: readonly PlayerWeek[]): number =>
    weeks.reduce((sum, week) => sum + week.targetShare + week.carryShare, 0) / weeks.length;
  return mean(apart) - mean(together);
}

/**
 * Every offence's departures, arrivals and remaining roster.
 *
 * Absence is counted in the TEAM's own games rather than in calendar weeks, so a bye does not read
 * as an injury. That distinction costs three lines and would otherwise mark a third of the league
 * as having lost its best receiver every October.
 */
export function detectTransactions(input: TransactionInput): readonly TeamTransactions[] {
  const rows = playerWeeks(input);
  const currentTeam = latestTeams({ playerTeams: input.playerTeams, teamObservations: [] });

  const byTeam = new Map<string, PlayerWeek[]>();
  for (const row of rows) (byTeam.get(row.team) ?? byTeam.set(row.team, []).get(row.team)!).push(row);

  const results: TeamTransactions[] = [];
  for (const team of [...byTeam.keys()].sort()) {
    const teamRows = byTeam.get(team)!;
    const teamGames = [...new Set(teamRows.map((row) => `${row.season}|${row.week}`))]
      .map((key) => {
        const [season, week] = key.split("|");
        return { season: Number(season), week: Number(week) };
      })
      .sort(chronologically);
    const recentGames = new Set(
      teamGames.slice(-TRANSACTION_CONFIG.absenceTeamGames).map((game) => `${game.season}|${game.week}`),
    );
    /**
     * How many of the team's own games have been played since a given one — the measure the
     * relevance window is counted in.
     *
     * Counted from HIS LAST GAME WITH THE TEAM rather than by asking whether he appears in the last
     * few, which is the version that reads naturally and is wrong: a departure is defined by an
     * ABSENCE from the recent games, so a test that required him to be present in them could never
     * fire for a release or an injury and would silently reduce the whole feature to trades.
     */
    const gameIndex = new Map(teamGames.map((game, index) => [`${game.season}|${game.week}`, index] as const));
    const teamGamesSince = (weeks: readonly PlayerWeek[]): number => {
      const last = Math.max(...weeks.map((week) => gameIndex.get(`${week.season}|${week.week}`) ?? -1));
      return last < 0 ? Number.POSITIVE_INFINITY : teamGames.length - 1 - last;
    };

    const byPlayer = new Map<string, PlayerWeek[]>();
    for (const row of teamRows) (byPlayer.get(row.playerId) ?? byPlayer.set(row.playerId, []).get(row.playerId)!).push(row);

    const departures: ShareMove[] = [];
    const roster: RosterPlayer[] = [];
    const departedWeekSets: { move: ShareMove; weeks: ReadonlySet<string> }[] = [];

    for (const [playerId, weeks] of [...byPlayer.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const position = input.positions.get(playerId);
      if (position === undefined) continue;
      const playedRecently = weeks.some((week) => recentGames.has(`${week.season}|${week.week}`));
      const gone = currentTeam.get(playerId) !== team || !playedRecently;
      if (gone) {
        const move: ShareMove = {
          playerId,
          position,
          targetShare: meanOfLast(weeks, "targetShare"),
          carryShare: meanOfLast(weeks, "carryShare"),
        };
        // Three filters, all of which have to pass. Enough tenure that his share means something,
        // enough share that redistributing it is worth doing, and recent enough that layer 1 has not
        // already learned the answer from the weeks since.
        const worthActingOn =
          weeks.length >= TRANSACTION_CONFIG.minWeeksWithTeam &&
          move.targetShare + move.carryShare >= TRANSACTION_CONFIG.minVacatedShare &&
          teamGamesSince(weeks) <= TRANSACTION_CONFIG.relevantForTeamGames;
        if (worthActingOn) {
          departures.push(move);
          departedWeekSets.push({ move, weeks: new Set(weeks.map((week) => `${week.season}|${week.week}`)) });
        }
        continue;
      }
      roster.push({
        playerId,
        position,
        snapShare: input.snapShares.get(playerId) ?? 0,
        upliftWhenAbsent: null,
      });
    }

    // The uplift is measured against the LARGEST departure only. Measuring it against each in turn
    // and averaging would blur two different absences together, and the largest is the one whose
    // vacated share the weights are actually splitting.
    const largest = [...departedWeekSets].sort((a, b) => b.move.targetShare - a.move.targetShare)[0];
    const withUplift =
      largest === undefined
        ? roster
        : roster.map((player) => ({
            ...player,
            upliftWhenAbsent: upliftWhenAbsent(byPlayer.get(player.playerId) ?? [], largest.weeks),
          }));

    const arrivals: ShareMove[] = [];
    for (const [playerId, team_] of currentTeam) {
      if (team_ !== team) continue;
      const withThisTeam = (byPlayer.get(playerId) ?? []).length;
      if (withThisTeam > TRANSACTION_CONFIG.maxWeeksToCountAsArrival) continue;
      const position = input.positions.get(playerId);
      if (position === undefined) continue;
      const elsewhere = rows.filter((row) => row.playerId === playerId && row.team !== team);
      if (elsewhere.length < TRANSACTION_CONFIG.minWeeksWithTeam) continue;
      arrivals.push({
        playerId,
        position,
        targetShare: meanOfLast(elsewhere, "targetShare"),
        carryShare: meanOfLast(elsewhere, "carryShare"),
      });
    }

    if (departures.length === 0 && arrivals.length === 0) continue;
    results.push({ team, roster: withUplift, departures, arrivals });
  }
  return results;
}
