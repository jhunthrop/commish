/**
 * LINEUP PROBLEM DETECTION AND THE FIX PLAN — the diagnosis behind law 3's lineup-fix sheet.
 *
 * A problem is a starting slot that will produce nothing on Sunday while it can still be
 * changed: an empty slot, a starter on bye (his NFL team absent from the week's fixture map),
 * or a starter ruled out. The plan ranks the bench replacements the way the sheet presents
 * them — best current-week projection first — and prices the swap so the delta is stated
 * before the user commits.
 *
 * Everything here is honest arithmetic over what the services already produce: the week's
 * per-player projections (which can legitimately be an empty map on a stale snapshot — the
 * plan then falls back to ADP order and states no totals), the fixture labels, and the injury
 * designations already riding on the lineup rows. No rest-of-season numbers, no win
 * probability: nothing invents what the backend did not compute.
 */
import type { Position } from "@/domain/player";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import type { FixtureLabel } from "@/league-service/nfl-schedule";
import type { WeekStatus } from "@/league/week-status";
import type { LineupBody, LineupSlotView } from "../contract";

export type LineupProblemReason = "empty" | "bye" | "out";

/** empty > bye > out: an empty slot is certain zero, a bye is certain zero the user may not
 *  have noticed, an out designation can still flip before kickoff. */
export const PROBLEM_SEVERITY: Readonly<Record<LineupProblemReason, number>> = {
  empty: 3,
  bye: 2,
  out: 1,
};

/** Designations that read as "will not play". Questionable ("Q") is not a problem. */
const OUT_DESIGNATIONS: ReadonlySet<string> = new Set(["O", "IR", "PUP", "NFI", "SUS"]);

export interface LineupProblem {
  readonly slot: RosterSlot["slot"];
  readonly slotIndex: number;
  readonly reason: LineupProblemReason;
  readonly severity: number;
  readonly playerId: string | null;
  readonly playerName: string | null;
  readonly position: Position | null;
}

export interface LineupCandidate {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly nflTeam: string | null;
  readonly projection: number | null;
  readonly adp: number | null;
  readonly fixture: FixtureLabel | null;
  /** Candidate projection over the broken slot's current output (always 0: empty, bye, or
   *  ruled out all produce nothing). Null when no projection exists for the candidate. */
  readonly delta: number | null;
}

export interface LineupFixPlan {
  readonly problem: LineupProblem;
  /** Ranked best-first; the recommendation is the head. Empty when the bench has no
   *  playable fit — the sheet then says so instead of inventing one. */
  readonly candidates: readonly LineupCandidate[];
  /** Whether the week's projection snapshot was present; totals are only stated when true. */
  readonly hasProjections: boolean;
  readonly totalBefore: number | null;
  readonly totalAfter: number | null;
}

export interface LineupProblemsInput {
  readonly lineup: LineupBody;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly fixturesByNflTeam: ReadonlyMap<string, FixtureLabel>;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
  readonly weekStatus: WeekStatus;
}

function reasonFor(
  slot: LineupSlotView,
  fixtures: ReadonlyMap<string, FixtureLabel>,
): LineupProblemReason | null {
  if (slot.playerId === null) return "empty";
  if (slot.nflTeam !== null && !fixtures.has(slot.nflTeam)) return "bye";
  const designation = slot.injuryDesignation ?? null;
  if (designation !== null && OUT_DESIGNATIONS.has(designation)) return "out";
  return null;
}

function problemOf(slot: LineupSlotView, reason: LineupProblemReason): LineupProblem {
  return {
    slot: slot.slot,
    slotIndex: slot.slotIndex,
    reason,
    severity: PROBLEM_SEVERITY[reason],
    playerId: slot.playerId,
    playerName: slot.playerName,
    position: slot.position,
  };
}

/**
 * Every unlocked problem in the starting lineup, severity order. Nothing is reported once the
 * week is final (there is nothing left to fix) or for a slot whose occupant already kicked off
 * (the per-player lock; the fix would be refused anyway).
 */
export function lineupProblems(input: LineupProblemsInput): readonly LineupProblem[] {
  if (input.weekStatus === "final") return [];
  const locked = new Set(input.lineup.lockedPlayerIds);
  return input.lineup.starters
    .filter((slot) => slot.playerId === null || !locked.has(slot.playerId))
    .flatMap((slot) => {
      const reason = reasonFor(slot, input.fixturesByNflTeam);
      return reason === null ? [] : [problemOf(slot, reason)];
    })
    .slice().sort((a, b) => b.severity - a.severity || a.slotIndex - b.slotIndex);
}

function eligiblePositionsFor(
  slot: RosterSlot["slot"],
  rosterSlots: readonly RosterSlotConfig[],
): readonly Position[] {
  return rosterSlots.find((config) => config.slot === slot)?.eligiblePositions ?? [];
}

function candidateSort(a: LineupCandidate, b: LineupCandidate): number {
  const aProjection = a.projection ?? Number.NEGATIVE_INFINITY;
  const bProjection = b.projection ?? Number.NEGATIVE_INFINITY;
  if (aProjection !== bProjection) return bProjection - aProjection;
  // No projections: earlier ADP is the better player.
  return (a.adp ?? Number.POSITIVE_INFINITY) - (b.adp ?? Number.POSITIVE_INFINITY);
}

/**
 * The bench players who could actually fill the broken slot Sunday: position fits the slot's
 * eligibility, not on bye, not ruled out, and their own game has not started (a kicked-off
 * player cannot be inserted; the service refuses the swap).
 */
export function fixCandidates(problem: LineupProblem, input: LineupProblemsInput): readonly LineupCandidate[] {
  const eligible = new Set(eligiblePositionsFor(problem.slot, input.rosterSlots));
  const candidates = input.lineup.bench.flatMap((slot) => {
    if (slot.playerId === null || slot.playerName === null || slot.position === null) return [];
    if (!eligible.has(slot.position)) return [];
    const fixture = slot.nflTeam === null ? null : (input.fixturesByNflTeam.get(slot.nflTeam) ?? null);
    if (fixture === null) return []; // on bye: swapping one zero for another is no fix
    if (fixture.status !== "scheduled") return []; // already kicked off, cannot be inserted
    const designation = slot.injuryDesignation ?? null;
    if (designation !== null && OUT_DESIGNATIONS.has(designation)) return [];
    const projection = input.projectionsByPlayerId.get(slot.playerId) ?? null;
    const candidate: LineupCandidate = {
      playerId: slot.playerId,
      playerName: slot.playerName,
      position: slot.position,
      nflTeam: slot.nflTeam,
      projection,
      adp: slot.adp,
      fixture,
      delta: projection,
    };
    return [candidate];
  });
  return candidates.slice().sort(candidateSort);
}

function starterTotal(input: LineupProblemsInput): number {
  return input.lineup.starters.reduce(
    (total, slot) => total + (slot.playerId === null ? 0 : (input.projectionsByPlayerId.get(slot.playerId) ?? 0)),
    0,
  );
}

/** The full sheet inputs for every current problem, ranked the way the stage deals them. */
export function lineupFixPlans(input: LineupProblemsInput): readonly LineupFixPlan[] {
  const hasProjections = input.projectionsByPlayerId.size > 0;
  const before = hasProjections ? starterTotal(input) : null;
  return lineupProblems(input).map((problem) => {
    const candidates = fixCandidates(problem, input);
    const recommended = candidates[0];
    const totalAfter =
      before === null || recommended === undefined || recommended.projection === null
        ? null
        : before + recommended.projection;
    return { problem, candidates, hasProjections, totalBefore: before, totalAfter };
  });
}

/**
 * The PUT payload for committing a fix: the starting slots with the chosen player in the
 * broken slot. Starters only — the bench is derived server-side (`setLineup`'s own rule).
 * If the chosen player currently occupies another starting slot (not the case for bench
 * candidates, but stated for safety) the swap is refused by the service, not silently mangled
 * here.
 */
export function startersWithFix(
  lineup: LineupBody,
  problem: LineupProblem,
  candidatePlayerId: string,
): readonly RosterSlot[] {
  return lineup.starters.map((slot) =>
    slot.slot === problem.slot && slot.slotIndex === problem.slotIndex
      ? { slot: slot.slot, slotIndex: slot.slotIndex, playerId: candidatePlayerId }
      : { slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId },
  );
}
