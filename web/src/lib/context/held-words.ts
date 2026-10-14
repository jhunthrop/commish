/** The selected league's rosters as the pages read them: the data a read keeps, and the marks the
 * store holds once it is read. Types only: the words are held-marks.ts, which arrives with the
 * rosters (held.ts), so no page's first load carries them. */
import type { Component } from 'svelte';

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

/** A mark as a row draws it: its words and kind, and the component that draws it (HeldMark), which
 * arrives with the rosters (held.ts), so no page's first load carries it. */
export interface ShownMark extends LeagueMark {
	Mark: Component<{ words: string; kind: LeagueMark['kind']; inline?: boolean }>;
}

/** The rosters' two lookups, built where the rosters are read (held-marks.ts). */
export interface Marks {
	/** A row's mark: yours, a free agent, or null for another team's player. */
	mark(boardId: string): ShownMark | null;
	/** Whose roster he is on, as his page says it. */
	holder(boardId: string): string;
}
