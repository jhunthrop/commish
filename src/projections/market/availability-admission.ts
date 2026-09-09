import type { Position } from "@/domain/player";
import type { BoardCandidate } from "../preseason/board";
import { isCurvePosition, type ImpliedGamesByPosition } from "./curve";

/**
 * THE AVAILABILITY ADMISSION — clause (b) of the blend's `admittedDelta` (`blend.ts`), in its own
 * module: how a gap between the model's expected games and the market's own implied games becomes
 * season points, and the cap that bounds it.
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
 * THE CAP STANDS FOR A RESERVE-DESIGNATED PLAYER TOO, MEASURED (founder report 2026-09-08, the
 * availability-cap-and-suspension round). The proposed rule admitted the term in full for a
 * candidate the roster-status gate had stamped with a reserve designation. On the archive it was
 * worse on the held-out seasons: the LISTED reserve-designated skill players of 2023-2024 (eleven
 * of them; the other ninety-nine were unlisted and untouched by any cap) actually scored 97 points
 * a man, the capped blend put them at 118 and the uncapped one at 39, mean absolute error 46
 * against 75, seven of eleven closer capped. A player the market drafted despite a reserve list is
 * one the market expects back, and the model's three games for him come from a cutdown-status
 * multiplier fitted over a reserve population that is mostly season-long and unlisted. The cap
 * was bounding a wrong claim, not a right one, so it stays until that multiplier is fixed. The
 * round's ledger carries the table.
 */

/** A structural view of the blend constants this module reads, so it never imports `blend.ts`. */
export interface AvailabilityAdmissionConstants {
  readonly availabilityCapPoints: number;
  readonly impliedGamesByPosition: ImpliedGamesByPosition;
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

/** Clause (b): the admitted availability term, in season points, capped. See the module docblock. */
export function admitAvailability(candidate: BoardCandidate, anchorPoints: number, constants: AvailabilityAdmissionConstants): number {
  const impliedGames = impliedGamesFor(candidate.position, constants.impliedGamesByPosition);
  const gapPoints = ((candidate.games.expected - impliedGames) * anchorPoints) / impliedGames;
  return clampAbs(gapPoints, constants.availabilityCapPoints);
}
