import type { Matchup, Week } from "@/domain/schedule";
import { LEAGUE_CONFIG } from "./config";

export interface GenerateScheduleInput {
  readonly leagueId: string;
  /** In a stable order — the schedule is a pure function of it. */
  readonly teamIds: readonly string[];
  readonly weeks: number;
}

export type ScheduleResult =
  | { readonly ok: true; readonly weeks: readonly Week[]; readonly matchups: readonly Matchup[] }
  | { readonly ok: false; readonly reason: string };

/** Stands in for the absent team when the league has an odd number of them. */
const BYE = "BYE";

/**
 * The circle method: team 0 stays put while everyone else rotates one place per round, so
 * `n - 1` rounds cover every distinct pairing exactly once and then the rotation repeats.
 * With an odd number of teams a sentinel makes the count even, and the pair containing it is
 * simply dropped — that team has its bye that week.
 *
 * Home and away alternate by ROUND, not by position in the wheel. That distinction is the
 * whole trick: a rotating team's wheel index falls by one every round, so any rule mixing the
 * index into the parity cancels out and pins that team to one side of the ball for a whole
 * half-cycle. Alternating on the round alone keeps the imbalance small — bounded, not
 * perfectly even: across the supported league sizes and season lengths no team drifts more
 * than a few games from parity (the invariant suite pins |home − away| ≤ 4), and a rematch
 * always swaps sides (a cycle is an odd number of rounds, so the parity is opposite the
 * second time through).
 */
function pairingsForRound(order: readonly string[], round: number): readonly (readonly [string, string])[] {
  const rest = order.slice(1);
  const offset = round % rest.length;
  const wheel = [order[0]!, ...rest.slice(offset), ...rest.slice(0, offset)];
  const half = wheel.length / 2;
  const firstIsHome = round % 2 === 0;
  return Array.from({ length: half }, (_, i) => {
    const first = wheel[i]!;
    const second = wheel[wheel.length - 1 - i]!;
    return (firstIsHome ? [first, second] : [second, first]) as readonly [string, string];
  });
}

/**
 * A full round-robin season. Pure and deterministic: the same teams in the same order always
 * produce the same schedule, which is what makes a seeded league reproducible and a
 * regenerated schedule idempotent.
 */
export function generateSchedule({ leagueId, teamIds, weeks }: GenerateScheduleInput): ScheduleResult {
  if (teamIds.length < 2) return { ok: false, reason: "A league needs at least two teams before we can build a schedule." };
  if (new Set(teamIds).size !== teamIds.length) return { ok: false, reason: "Every team may appear only once." };
  if (weeks < 1) return { ok: false, reason: "A season needs at least one week." };
  if (weeks > LEAGUE_CONFIG.maxWeeks) return { ok: false, reason: `A season can run for at most ${LEAGUE_CONFIG.maxWeeks} weeks.` };

  const order = teamIds.length % 2 === 0 ? teamIds : [...teamIds, BYE];
  const weekRows: Week[] = [];
  const matchupRows: Matchup[] = [];

  for (let weekNumber = 1; weekNumber <= weeks; weekNumber++) {
    weekRows.push({ leagueId, weekNumber });
    for (const [homeTeamId, awayTeamId] of pairingsForRound(order, weekNumber - 1)) {
      if (homeTeamId === BYE || awayTeamId === BYE) continue;
      matchupRows.push({ leagueId, weekNumber, homeTeamId, awayTeamId, homeScore: null, awayScore: null });
    }
  }

  return { ok: true, weeks: weekRows, matchups: matchupRows };
}

/**
 * The week the league is currently living in: the earliest one that has not been scored,
 * or the final week once the whole season is in the books. Pure — the wall clock has no say,
 * because in this phase a week becomes "done" when a commissioner scores it, not when a
 * calendar says so.
 */
export function currentWeekNumber(matchups: readonly Matchup[], totalWeeks: number): number {
  // No schedule at all: the league sits on week one, whatever the season length says. Without
  // this, "nothing scored" and "nothing to score" would both look finished and jump to the end.
  if (matchups.length === 0) return 1;
  const unscored = matchups.filter((m) => m.homeScore === null || m.awayScore === null).map((m) => m.weekNumber);
  return unscored.length === 0 ? Math.max(1, totalWeeks) : Math.min(...unscored);
}
