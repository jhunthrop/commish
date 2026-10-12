import type { Position } from "@research/domain/player";

/**
 * WHAT THE SINGLE 2025 JUDGMENT DECIDED, PER POSITION (the 2026-09-05 kicker and team defence
 * round).
 *
 * A COMMITTED CONSTANT AND NOT A DATABASE READ, deliberately. A board must never be quietly
 * re-decided by a query: the judgment was taken once, against gates written down before the season
 * was read, and its answer is a fact about that run rather than a property of whatever rows happen
 * to be in a store today. Changing either value below is a decision a human makes after reading a
 * new results document, and the diff says so.
 *
 * BOTH POSITIONS SHIP IN MARKET ORDER. Neither passed all four gates. The numbers, from
 * `docs/research/2026-09-05-kicker-defense-preregistration-results.md`:
 *
 * - **K** — G1 FAILED on the margin: the model ordered kickers at 0.5181 against last season's
 *   points order at 0.5007, which beat the baseline by +0.0174 against a bar of +0.05. G2 FAILED
 *   outright: on the nineteen kickers the market covered, the market's own draft order correlated
 *   0.4179 against the model's 0.3240. G3 (60.0% band coverage) and G4 passed.
 * - **DEF** — G1 FAILED by -0.1371, and in the OPPOSITE direction from the development check: on
 *   2024 last season's defence points correlated -0.2109 with the outcome and on 2025 they
 *   correlated +0.1926. A defence's year-to-year persistence is not a stable quantity. G2 passed
 *   (+0.1245) with both arms near zero in absolute terms, and G3 (53.1%) and G4 passed.
 *
 * WHAT "MARKET ORDER" MEANS HERE, and it is the strong reading rather than the weak one: the engine
 * publishes NOTHING for the position. No projected points, no tier, no band, and no row in the
 * projection store at all. The alternative — writing rows carrying zero points so the position still
 * appears — would put a fabricated number in front of every reader and every consumer that sorts by
 * points, and a zero is not "we have no opinion", it is "we project nothing", which is a different
 * and false claim. The board surface reads this constant, says plainly that the position is listed
 * in draft order, and shows the market's own order, which it already holds.
 *
 * AUTOPICK IS UNAFFECTED BY THIS CONSTANT, by design. Its late-round policy is the spec's UX rider
 * and shipped before the judgment was taken: whatever the measurement says, a seat finishes every
 * draft with a kicker and a team defence filled, and reaches for neither early.
 */
export type KdefVerdict = "projected" | "market_order";

export const KDEF_DECISION: Readonly<Record<"K" | "DEF", KdefVerdict>> = {
  K: "market_order",
  DEF: "market_order",
};

/** The two positions this decision governs. */
export const KDEF_POSITIONS: readonly Position[] = ["K", "DEF"];

/** Whether this round publishes a measured projection for `position`. Anything that is not one of
 *  the two positions is unaffected and answers `true`, because this constant has nothing to say
 *  about a quarterback. */
export function shipsProjectedRows(position: Position): boolean {
  if (position !== "K" && position !== "DEF") return true;
  return KDEF_DECISION[position] === "projected";
}

/** The positions that fell back, for a surface that needs to say so once rather than per row. */
export function marketOrderPositions(): readonly Position[] {
  return KDEF_POSITIONS.filter((position) => !shipsProjectedRows(position));
}
