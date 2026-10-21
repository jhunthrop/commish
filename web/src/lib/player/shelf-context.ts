/** The player shelf's seam (Lane 113): a league screen, Players or Rest of season provides it, and a
 * box row's name opens the player's card over the screen instead of leaving for his page. Alone and
 * free of run-time imports beyond Svelte's context, so every box row carries only this. */
import { getContext, setContext } from 'svelte';
import type { BoxRow } from '#lib/league/box/box.ts';

/** What a row's name asks of the screen it is on. */
export interface ShelfOpener {
	/** Opens his card over the screen with the row as drawn and the line its game cell says in place
	 * of the game (an IR bench row's words); leaves the link to his page for a modified click. */
	open: (event: MouseEvent, row: BoxRow, note: string | null) => void;
	/** Starts loading the shelf's script: a finger or the focus is on a name. */
	warm: () => void;
}

const KEY = Symbol('player shelf');

/** Called by the screen that holds the shelf, in its own setup. */
export function provideShelfOpener(opener: ShelfOpener): void {
	setContext(KEY, opener);
}

/** The screen's shelf, undefined where no screen provides one (the link goes to his page). */
export function shelfOpener(): ShelfOpener | undefined {
	return getContext<ShelfOpener | undefined>(KEY);
}
