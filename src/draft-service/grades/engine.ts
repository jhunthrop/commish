/**
 * THE PURE GRADE ENGINE (spec §9, `docs/superpowers/specs/2026-09-04-draft-hq-design.md`) —
 * after any draft, every team earns a letter and the component facts that letter cites. Pure by
 * construction: no I/O, no clock, no randomness. Task 9 stores this module's output for a real
 * draft via a job; Task 11 calls it at read time for a mock debrief. Both hand it the same
 * shape, `GradeDraftInput`, built here rather than left as inline object-shorthand so neither
 * caller can drift from the other's field names or types (controller ruling R-pf1).
 *
 * WHAT EACH COMPONENT MEANS AND WHERE IT COMES FROM:
 *
 * - `valueCaptured`: sum, over a team's own picks, of (that pick's `valueByPlayerId` entry MINUS
 *   the highest `valueByPlayerId` entry among every player still undrafted — any position,
 *   anywhere on the board — the instant before that pick happened). The idea is the same
 *   "best-available" comparison `@/draft-room/state/pick-review.ts`'s `PickReview.bestAvailableDelta`
 *   makes, restated in board VALUE terms instead of RANK terms — this module does not import
 *   `reviewPicks`/`boardRanks` because those take a ranked `Player[]` snapshot and recompute
 *   ranks themselves, while `GradeDraftInput` already comes in pre-valued
 *   (`valueByPlayerId: ReadonlyMap<string, number>`, the board's own value-over-replacement
 *   numbers) — reusing them would mean re-deriving a rank this module has no use for just to
 *   throw it away. A pick can never beat the best player available at that moment (it draws from
 *   the same pool), so every term is `<= 0` and the sum is `<= 0`: 0 means every single pick took
 *   the board's own most valuable player left, and more negative means more value left on the
 *   table. Never floored, never hidden — a team that punted value shows the negative number
 *   as-is (see the "punted value" test).
 *
 * - `projectedPoints` / `startingSlotsFilled` / `startingSlotsTotal`: all three come from the
 *   SAME single greedy assignment, `assignStartingLineup` (`@/draft-service/sim/lineup-score.ts`,
 *   extracted from that module's existing `bestStartingLineupPoints` so this engine and the sim
 *   score a roster identically rather than by two separately-written passes). A player absent
 *   from `pointsByPlayerId` — no evidence-board entry — contributes 0 to `projectedPoints` and is
 *   never invented a score; that honesty rule is `assignStartingLineup`'s own, inherited here.
 *
 * - `byeCollisions`: how many DISTINCT weeks have 3 or more of a team's STARTERS (the same
 *   `assignStartingLineup` output, never the whole bench) sharing an NFL bye. Deliberately NOT
 *   `@/draft-room/state/debrief.ts`'s `byeStackWeek`: that function is scoped to naming the
 *   single MOST-stacked week (gated on `DRAFT_ROOM_CONFIG.debrief.byeStackMin`, whose own
 *   docblock states plainly "`./debrief` reads these and nothing else does") and returns at most
 *   one week — `byeCollisions` needs a COUNT of every qualifying week, a different aggregate over
 *   the same idea, so forcing the import would mean calling it repeatedly while discarding all
 *   but its top answer. The bucket-and-threshold shape is intentionally the same, restated here
 *   as `countByeCollisions` against this module's own fixed threshold (`BYE_COLLISION_THRESHOLD`
 *   = 3, the brief's own literal number, independent of the debrief surface's configurable one).
 *
 * - `letter`: room-relative quartiles of `valueCaptured` (A = top quartile of the room's own
 *   teams, D = bottom — there is no F; the bottom quartile already carries the worst word this
 *   copy law allows), ties broken by `projectedPoints`. For a team count not divisible by four,
 *   a rank's quartile is `Math.ceil(4 * rank / teamCount)` (rank 1-based, 1 = best) — clamped
 *   into 1..4 — which is what puts a 10-team room at A×2, B×3, C×2, D×3 rather than an even
 *   2.5-per-letter split that cannot exist. Pinned exactly in `engine.test.ts`'s 10-team fixture.
 *
 * - `projectedRank`: 1-based rank by `projectedPoints` alone within the room, ties broken by
 *   `teamId` for a total order. Computed independently of `letter` — a team can rank near the
 *   top on points while grading poorly on value, or the reverse; `engine.test.ts` pins a fixture
 *   where this is true, so the two facts can never be mistaken for restatements of one another.
 */
import type { Position } from "@/domain/player";
import type { RosterSlotConfig } from "@/domain/roster";
import { assignStartingLineup, type RosteredPlayer } from "@/draft-service/sim/lineup-score";

/** The minimal facts this module needs from a completed pick — see `CompletedPick`
 *  (`@/draft-engine`) for the full committed shape a real draft's log carries; a mock debrief
 *  (Task 11) may not have every field `CompletedPick` does, so this stays deliberately narrow. */
export interface GradePick {
  readonly pickNumber: number;
  readonly teamId: string;
  readonly playerId: string;
}

/**
 * Everything `gradeDraft` needs, and nothing it derives itself: every number below is evidence
 * or configuration the caller already has, never re-fetched or re-computed here.
 */
export interface GradeDraftInput {
  /** Every pick of the draft, any team — value-captured for one team depends on what every seat,
   *  not just that one, had already taken off the board by the time it picked. */
  readonly picks: readonly GradePick[];
  /** One entry per team in the room; the team's own final roster (matches
   *  `RunOneDraftResult.rosters`'s per-team shape, `@/draft-service/sim/run.ts`). */
  readonly rosters: ReadonlyMap<string, readonly { readonly playerId: string; readonly position: Position }[]>;
  /** The league's own roster shape — which slots exist and how many, `@/domain/roster`. */
  readonly slotConfig: readonly RosterSlotConfig[];
  /** Evidence-board projected points. A player absent contributes 0, never invented. */
  readonly pointsByPlayerId: ReadonlyMap<string, number>;
  /** The board's own value-over-replacement numbers — what `valueCaptured` is measured in. */
  readonly valueByPlayerId: ReadonlyMap<string, number>;
  /** NFL team code → bye week, the real schedule read (mirrors `byeStackWeek`'s own `byeWeeks`
   *  parameter, `@/draft-room/state/debrief.ts`). */
  readonly byeWeeks: ReadonlyMap<string, number>;
  /** playerId → NFL team code, the resolver `byeWeeks` needs to mean anything for a roster. */
  readonly nflTeamByPlayerId: ReadonlyMap<string, string>;
}

export interface GradeComponents {
  /** Sum over this team's own picks of (pick's board value minus the best-available board value
   *  at that pick). `<= 0` always; 0 is a perfect value draft. Never floored. */
  readonly valueCaptured: number;
  /** How many of the team's startable slot instances a legal starter actually filled. */
  readonly startingSlotsFilled: number;
  /** How many startable slot instances this league's `slotConfig` defines (bench excluded). */
  readonly startingSlotsTotal: number;
  /** Weeks where 3 or more of this team's STARTERS (not bench) share an NFL bye. */
  readonly byeCollisions: number;
  /** The best legal starting lineup's total projected points under the league's own slots. */
  readonly projectedPoints: number;
}

export interface TeamGrade {
  readonly teamId: string;
  readonly letter: "A" | "B" | "C" | "D";
  readonly components: GradeComponents;
  /** 1-based rank by `projectedPoints` within the room; 1 is highest. */
  readonly projectedRank: number;
}

/** The brief's own fixed rule: 3 or more shared starters' byes is a collision. Independent of
 *  `DRAFT_ROOM_CONFIG.debrief.byeStackMin` (`@/draft-room/state/config.ts`), which that module's
 *  own docblock reserves for the debrief surface alone. */
const BYE_COLLISION_THRESHOLD = 3;

const LETTERS = ["A", "B", "C", "D"] as const;

/** `valueByPlayerId` restricted to a `RosteredPlayer`-shaped map key set is not needed — the
 *  formula only ever looks a player up by id, so any iterable of ids works as "the pool". */
function computeValueCaptured(
  picks: readonly GradePick[],
  valueByPlayerId: ReadonlyMap<string, number>,
  teamId: string,
): number {
  const ordered = [...picks].sort((a, b) => a.pickNumber - b.pickNumber);
  const remaining = new Set(valueByPlayerId.keys());
  let total = 0;
  for (const pick of ordered) {
    if (pick.teamId === teamId) {
      const pickValue = valueByPlayerId.get(pick.playerId) ?? 0;
      let bestAvailable = -Infinity;
      for (const playerId of remaining) {
        const value = valueByPlayerId.get(playerId)!;
        if (value > bestAvailable) bestAvailable = value;
      }
      // No valued player remains on the board at all (an exhausted or entirely unvalued pool):
      // there is nothing to have captured less than, so this pick contributes 0 rather than a
      // fabricated comparison against negative infinity.
      if (bestAvailable === -Infinity) bestAvailable = pickValue;
      total += pickValue - bestAvailable;
    }
    remaining.delete(pick.playerId);
  }
  return total;
}

function countByeCollisions(
  starterIds: readonly string[],
  nflTeamByPlayerId: ReadonlyMap<string, string>,
  byeWeeks: ReadonlyMap<string, number>,
): number {
  const countByWeek = new Map<number, number>();
  for (const playerId of starterIds) {
    const nflTeam = nflTeamByPlayerId.get(playerId);
    if (nflTeam === undefined) continue;
    const week = byeWeeks.get(nflTeam);
    if (week === undefined) continue;
    countByWeek.set(week, (countByWeek.get(week) ?? 0) + 1);
  }
  let collisions = 0;
  for (const count of countByWeek.values()) {
    if (count >= BYE_COLLISION_THRESHOLD) collisions += 1;
  }
  return collisions;
}

function letterForRank(rank: number, teamCount: number): TeamGrade["letter"] {
  const quartile = Math.ceil((4 * rank) / teamCount);
  const clamped = Math.min(4, Math.max(1, quartile));
  return LETTERS[clamped - 1]!;
}

export function gradeDraft(input: GradeDraftInput): readonly TeamGrade[] {
  const teamIds = [...input.rosters.keys()].sort((a, b) => a.localeCompare(b));
  const teamCount = teamIds.length;

  const componentsByTeam = new Map<string, GradeComponents>();
  for (const teamId of teamIds) {
    const roster: readonly RosteredPlayer[] = input.rosters.get(teamId) ?? [];
    const { starterIds, startingSlotsTotal } = assignStartingLineup(roster, input.slotConfig, input.pointsByPlayerId);
    const projectedPoints = starterIds.reduce((sum, playerId) => sum + (input.pointsByPlayerId.get(playerId) ?? 0), 0);
    componentsByTeam.set(teamId, {
      valueCaptured: computeValueCaptured(input.picks, input.valueByPlayerId, teamId),
      startingSlotsFilled: starterIds.length,
      startingSlotsTotal,
      byeCollisions: countByeCollisions(starterIds, input.nflTeamByPlayerId, input.byeWeeks),
      projectedPoints,
    });
  }

  const byProjectedPointsDescending = [...teamIds].sort((a, b) => {
    const diff = componentsByTeam.get(b)!.projectedPoints - componentsByTeam.get(a)!.projectedPoints;
    return diff !== 0 ? diff : a.localeCompare(b);
  });
  const projectedRankByTeam = new Map(byProjectedPointsDescending.map((teamId, index) => [teamId, index + 1]));

  const byValueCapturedDescending = [...teamIds].sort((a, b) => {
    const valueDiff = componentsByTeam.get(b)!.valueCaptured - componentsByTeam.get(a)!.valueCaptured;
    if (valueDiff !== 0) return valueDiff;
    const pointsDiff = componentsByTeam.get(b)!.projectedPoints - componentsByTeam.get(a)!.projectedPoints;
    return pointsDiff !== 0 ? pointsDiff : a.localeCompare(b);
  });
  const letterByTeam = new Map(
    byValueCapturedDescending.map((teamId, index) => [teamId, letterForRank(index + 1, teamCount)]),
  );

  return teamIds.map((teamId) => ({
    teamId,
    letter: letterByTeam.get(teamId)!,
    components: componentsByTeam.get(teamId)!,
    projectedRank: projectedRankByTeam.get(teamId)!,
  }));
}
