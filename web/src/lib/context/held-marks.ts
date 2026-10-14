/** The roster marks in words, loaded with the rosters (held.ts) and never before: a row's mark and
 * whose roster a player is on. */
import type { Held, LeagueMark, Marks, ShownMark } from './held-words.ts';

const FREE_WORDS = 'Free agent in your league';

/** A row's mark, null with no rosters read or for a player another team holds: on your roster,
 * named by your team ("On Grand Illusion BG 3"), or a free agent. */
export function heldMark(held: Held, boardId: string): LeagueMark | null {
	const roster = held.by[boardId];
	if (roster === undefined) return { words: FREE_WORDS, kind: 'free' };
	if (roster !== held.me) return null;
	const team = held.teams[roster] ?? '';
	return { words: team === '' ? 'On your roster' : `On ${team}`, kind: 'mine' };
}

/** Whose roster a player is on, as his page says it: "On your roster", "Rostered by Gmoneyman" ("On
 * a roster in your league" for a team with no name read), or a free agent. */
export function holderWords(held: Held, boardId: string): string {
	const roster = held.by[boardId];
	if (roster === undefined) return FREE_WORDS;
	if (roster === held.me) return 'On your roster';
	const team = held.teams[roster] ?? '';
	return team === '' ? 'On a roster in your league' : `Rostered by ${team}`;
}

/** The store's lookups for a read's rosters, each row's mark with the component that draws it. */
export function marksOf(held: Held, Mark: ShownMark['Mark']): Marks {
	return {
		mark: (boardId) => {
			const mark = heldMark(held, boardId);
			return mark === null ? null : { ...mark, Mark };
		},
		holder: (boardId) => holderWords(held, boardId)
	};
}
