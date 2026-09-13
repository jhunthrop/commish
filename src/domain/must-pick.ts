/**
 * THE MUST-PICK LINE — what the league says when a roster's bench is full and only certain
 * starting slots remain (the 2026-09-12 draft engine round, founder report: a room that read
 * "no room on your bench" when the honest sentence was "your next pick must be a K or a D/ST").
 *
 * One sentence, in the domain, because three surfaces say it and none may drift: the engine's
 * own refusal when a pick does not fit (`applyPick`), the advisor's card (`assistant/why.ts`)
 * and the clock's notice when it picks for an absent manager (`draft_auto_picked`). The dock
 * derives the same set client-side from `restrictedPositions` (`./roster-eligibility`) and
 * prints this line, so a client component may import it: no server value lives here.
 */
import type { Position } from "./player";
import { positionLabel } from "./position-words";

/** Spoken article for a badge read aloud: "an RB", "a WR", "a K". */
function withArticle(position: Position): string {
  const label = positionLabel(position);
  return `${position === "RB" ? "an" : "a"} ${label}`;
}

function joinWithOr(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

/** "Your next pick must be a K or a D/ST." for the positions the roster can still take. */
export function mustPickLine(positions: readonly Position[]): string {
  if (positions.length === 0) throw new Error("mustPickLine needs at least one position; a full roster has no next pick to name.");
  return `Your next pick must be ${joinWithOr(positions.map(withArticle))}.`;
}
