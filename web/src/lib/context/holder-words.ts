/** Whose roster a player is on, as his page says it. Apart from the rows' mark (held-words.ts), so
 * his page carries only this. */
import { FREE_WORDS, type Held } from './held-words.ts';

/** Whose roster a player is on, as his page says it: "On your roster", "Rostered by Gmoneyman" ("On
 * a roster in your league" for a team with no name read), or a free agent. */
export function holderWords(held: Held, boardId: string): string {
	const roster = held.by[boardId];
	if (roster === undefined) return FREE_WORDS;
	if (roster === held.me) return 'On your roster';
	const team = held.teams[roster] ?? '';
	return team === '' ? 'On a roster in your league' : `Rostered by ${team}`;
}
