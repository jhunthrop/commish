import { BOARD_SOURCE, BOARD_SOURCE_V7_SHADOW } from "../preseason/board-store";

/**
 * WHICH BOARDS THE REGISTER TRACKS — the dual-track ruling (Round D), in one list.
 *
 * The register was built to record what ONE board said about a week. The serve-v9 ruling made that
 * insufficient: v9 is served because it carries three ruled corrections v7 does not, and v7 is the
 * configuration whose held-out verdict actually cleared, and the fit round could not settle between
 * them without spending the held-out season on the question. Freezing BOTH every week settles it
 * prospectively instead, on a season neither board has seen, at no cost to any gate.
 *
 * ORDER IS MEANING, not presentation. The SERVED board is first and is the one the product actually
 * shows a manager; a SHADOW is a board nobody is served, recorded beside it for comparison. The
 * freeze refuses outright when the served board is empty and merely reports a shadow that is, the
 * scoreboard prints the served board's benchmark columns and only the board column for a shadow, and
 * every one of those asymmetries reads its answer from `role` here rather than restating the rule.
 *
 * A SHADOW'S ROWS MUST BE READ THROUGH THE SAME PATH AS THE SERVED BOARD'S, pinned at its own source
 * — `preseasonProjectionsAsOf`, the call the drafts-players route and the player screen make — and
 * never rebuilt. v7's stored rows are the last artefact of a configuration this tree cannot
 * reproduce (which is why `FROZEN_BOARD_SOURCES` protects exactly it), so a shadow claim is only
 * honest if it is READ. `freeze.ts` takes both boards through one function for that reason.
 *
 * WHEN THE 2027 ROUND BUMPS `BOARD_SOURCE`: the name it bumps away from becomes a shadow here and
 * joins `FROZEN_BOARD_SOURCES` there, and the two lists stay in step because both are written in
 * terms of the same constants.
 */
export type RegisterBoardRole = "served" | "shadow";

export interface RegisterBoardSource {
  readonly source: string;
  readonly role: RegisterBoardRole;
}

export const REGISTER_BOARD_SOURCES: readonly RegisterBoardSource[] = [
  { source: BOARD_SOURCE, role: "served" },
  { source: BOARD_SOURCE_V7_SHADOW, role: "shadow" },
];

/** The one board a manager is actually shown — the product read path's own source. */
export const SERVED_BOARD_SOURCE = BOARD_SOURCE;

/** A source's role, or `null` for a source the register does not track (a board frozen under an
 *  older ruling, read back from the store long after the list moved on). Callers reading HISTORY
 *  need this: a stored row's source is a fact, and the list is only ever the current intent. */
export function roleOf(source: string): RegisterBoardRole | null {
  return REGISTER_BOARD_SOURCES.find((tracked) => tracked.source === source)?.role ?? null;
}
