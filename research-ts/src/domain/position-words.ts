/**
 * THE PLAIN WORDS FOR A POSITION — "back", "receivers", never a tier letter or the engine's
 * vocabulary. Named once in the domain so the server that writes the why (`draft-service/
 * assistant/why.ts`) and the client that writes the strip's chips (`draft-room/advisor/format.ts`)
 * say the same word for the same position: a client component may not value-import
 * `@/draft-service/**`, and a word that lived only on one side would drift.
 */
import type { Position } from "./player";

const POSITION_WORDS: Readonly<Record<Position, readonly [string, string]>> = {
  QB: ["quarterback", "quarterbacks"],
  RB: ["back", "backs"],
  WR: ["receiver", "receivers"],
  TE: ["tight end", "tight ends"],
  K: ["kicker", "kickers"],
  DEF: ["defense", "defenses"],
};

export function positionWord(position: Position, plural: boolean): string {
  return POSITION_WORDS[position][plural ? 1 : 0];
}

/** The badge abbreviation a row prints: the position's own letters, the team defense as D/ST.
 *  Named once so the dock, the sheet columns and the must-pick line cannot spell it two ways. */
export function positionLabel(position: Position): string {
  return position === "DEF" ? "D/ST" : position;
}

/**
 * A position in the words a manager would use, PLURAL — the shape a population takes in a
 * sentence ("Top 8% of running backs this season"). Extracted from the player page when the
 * bottom-sheet peek became this view's second consumer (founder, 2026-08-30: the name opens a
 * drawer wherever it appears).
 */
export const POSITION_PLURAL: Readonly<Record<Position, string>> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};
