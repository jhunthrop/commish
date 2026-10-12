import type { Position } from "@research-ts/domain/player";
import { shipsProjectedRows } from "@research-ts/projections/preseason/kdef-decision";

/**
 * WHAT A POSITION WITH NO PROJECTION SAYS FOR ITSELF (the 2026-09-05 kicker and team defence round).
 *
 * The single 2025 judgment failed both the kicker and the team defence against gates preregistered
 * before the season was read, so under the spec's own decision rule they ship in market order: the
 * engine publishes no points, no tier and no band for either. That is the honest outcome and it is
 * NOT a blank a reader should have to interpret. A position tab with rows and no numbers, and no
 * sentence saying why, reads as a bug, and a manager who thinks the board is broken trusts the rest
 * of it less.
 *
 * THE COPY SAYS WHAT IS TRUE AND NOTHING ELSE. It does not apologise, it does not promise a fix, and
 * it is not a tip. It names the ordering the rows actually carry (ADP, in fantasy's own word, never
 * "market order": founder ruling 2026-09-07) and the reason there is no number beside them.
 *
 * Returns `null` for every position that DOES carry a projection, which is the four skill positions
 * today and either of these two the day a later round's judgment passes. Nothing here hardcodes
 * which: it asks `KDEF_DECISION`.
 */
const POSITION_NOUN: Readonly<Record<string, string>> = {
  K: "Kickers",
  DEF: "Team defenses",
};

export function marketOrderNoteFor(position: Position): string | null {
  if (shipsProjectedRows(position)) return null;
  const noun = POSITION_NOUN[position] ?? position;
  return `${noun} are ranked by ADP because we do not project this position. The model did not clear its own accuracy bar for it.`;
}
