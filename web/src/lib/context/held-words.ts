/** The selected league's rosters in words: the mark a row carries. Its own module, so the pages
 * without rows carry none of it. */

/** The selected league's rosters as the pages mark them: who holds each player by our board id. */
export interface Held {
	/** The drafter's own roster. */
	me: number;
	/** Each team's name by its roster id. */
	teams: Readonly<Record<number, string>>;
	/** The roster holding each held player, by his board id. */
	by: Readonly<Record<string, number>>;
}

/** A row's league mark (HeldMark): the two that tell a reader something in October, when nearly every
 * top row is taken. */
export interface LeagueMark {
	/** Its accessible name: "On Grand Illusion BG 3", "Free agent in your league". */
	words: string;
	/** Yours (the accent, and the row takes your wash) or free to pick up. */
	kind: 'mine' | 'free';
}

export const FREE_WORDS = 'Free agent in your league';

/** A row's mark, null with no rosters read or for a player another team holds: on your roster,
 * named by your team ("On Grand Illusion BG 3"), or a free agent. */
export function heldMark(held: Held | null, boardId: string): LeagueMark | null {
	if (held === null) return null;
	const roster = held.by[boardId];
	if (roster === undefined) return { words: FREE_WORDS, kind: 'free' };
	if (roster !== held.me) return null;
	const team = held.teams[roster] ?? '';
	return { words: team === '' ? 'On your roster' : `On ${team}`, kind: 'mine' };
}
