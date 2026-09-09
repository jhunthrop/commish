import type { Position } from "@/domain/player";
import type { BoardCandidate, BoardReason } from "../preseason/board";
import { isCappedRosterStatus } from "../preseason/roster-status";
import { isCurvePosition, type ImpliedGamesByPosition } from "./curve";

/**
 * THE AVAILABILITY ADMISSION — clause (b) of the blend's `admittedDelta` (`blend.ts`), in its own
 * module: how a gap between the model's expected games and the market's own implied games becomes
 * season points, and when that number is allowed to stand uncapped.
 *
 * THE GAP (I3+I5 fix round, 2026-08-31). The market's own number is an empirical average over REAL
 * player-seasons at that ADP rank, most of which missed some real games; the curve already prices
 * that attrition in. So the gap is measured against `impliedGamesByPosition[position]`, the market
 * curve's own train population's mean games played at that position, NEVER a naive full-season
 * assumption that nearly every real player falls short of and that would drag the whole board below
 * market. The gap is converted to points at the market's OWN implied per-game rate
 * (`anchorPoints / impliedGames`), the only rate anchored to THIS player's own price rather than a
 * positional average, and capped at `availabilityCapPoints`. Positive when the model expects more
 * games than the market's population typically saw; negative when fewer.
 *
 * THE CAP IS FOR A MODEL'S OPINION, NOT FOR AN OBSERVED FACT (founder report 2026-09-08). The
 * fitted cap bounds how far the availability MODEL, a fitted prior a few games wide, may move a
 * player off his market price. A candidate carrying a `roster_status` reason with a reserve
 * designation (`roster-status-gate.ts` stamps it, `isCappedRosterStatus` names the kinds) is a
 * different case: somebody observed him on injured reserve, PUP, NFI, suspended or exempt at the
 * cutdown, the gate has already capped his games distribution to that fact, and the market's
 * number for him is an average over players who were healthy at his ADP. Josh Jacobs on the
 * 2026 board: anchor 162.9, three expected games, term -123.5, admitted -20, blended 135. For him
 * the term is admitted in full, and `totalAdmittedDelta` keeps the outer total cap off it too, so
 * his price is his anchor scaled to his games: 162.9 times 3 over 12.4, about 39. The law channel
 * keeps every bound it has; only the availability term is released, and only for him.
 */

/** A structural view of the blend constants this module reads, so it never imports `blend.ts`. */
export interface AvailabilityAdmissionConstants {
  readonly availabilityCapPoints: number;
  readonly impliedGamesByPosition: ImpliedGamesByPosition;
}

/** The admitted availability term, and whether the fitted caps bound it. */
export interface AvailabilityAdmission {
  readonly delta: number;
  /** `true` for the ordinary case (the per-term cap applied here, the total cap applied over it in
   *  `totalAdmittedDelta`); `false` for an observed reserve designation, where neither cap applies. */
  readonly bounded: boolean;
}

export function clampAbs(value: number, cap: number): number {
  return Math.min(cap, Math.max(-cap, value));
}

/** `impliedGamesByPosition`, safely narrowed and looked up for one candidate's own `Position` —
 *  throws for a position the table carries no entry for (`K`/`DEF`), which the shipped pipeline
 *  never emits a candidate at but a hand-built fixture could, and a silent `undefined` divide would
 *  be a worse failure than a clear one. */
export function impliedGamesFor(position: Position, table: ImpliedGamesByPosition): number {
  if (!isCurvePosition(position)) {
    throw new Error(`market/availability-admission.ts: no implied-games entry for position "${position}" — the blend only ever runs for QB/RB/WR/TE.`);
  }
  return table[position];
}

function isRosterStatusReason(reason: BoardReason): reason is Extract<BoardReason, { code: "roster_status" }> {
  return reason.code === "roster_status";
}

/** Whether the gate stamped this candidate with a reserve designation somebody observed. */
export function hasObservedReserveDesignation(candidate: BoardCandidate): boolean {
  return candidate.reasons.some((reason) => isRosterStatusReason(reason) && isCappedRosterStatus(reason.status));
}

/** Clause (b). See the module docblock for the arithmetic and for when the cap is lifted. */
export function admitAvailability(candidate: BoardCandidate, anchorPoints: number, constants: AvailabilityAdmissionConstants): AvailabilityAdmission {
  const impliedGames = impliedGamesFor(candidate.position, constants.impliedGamesByPosition);
  const gapPoints = ((candidate.games.expected - impliedGames) * anchorPoints) / impliedGames;
  if (hasObservedReserveDesignation(candidate)) return { delta: gapPoints, bounded: false };
  return { delta: clampAbs(gapPoints, constants.availabilityCapPoints), bounded: true };
}

/**
 * The blend's total admitted delta: the law channel plus the availability term, under the outer
 * `totalCapPoints`. A bounded availability term shares that cap with the laws, exactly as the blend
 * always has; an unbounded one is added in full after the laws alone have been capped.
 */
export function totalAdmittedDelta(lawTotal: number, availability: AvailabilityAdmission, totalCapPoints: number): number {
  if (availability.bounded) return clampAbs(lawTotal + availability.delta, totalCapPoints);
  return clampAbs(lawTotal, totalCapPoints) + availability.delta;
}
