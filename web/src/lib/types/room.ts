import type { PlayerRef } from './player.ts';

/** A pick made between two of your turns. */
export interface WentPick {
	player: PlayerRef;
	/** The overall pick number. */
	pick: number;
	/** He was in your queue when he went. */
	queued: boolean;
}

/** One face on a strip of picks: what went since your pick, or picks as they land in a lobby. */
export interface StripPick {
	key: number;
	player: PlayerRef;
	/** The lines under the name: the pick, "queued", who took him. */
	lines: readonly string[];
	/** accent rings a player from your queue, ink marks the newest pick. */
	ring?: 'accent' | 'ink';
	/** The line after the name set in ink, for a pick a person made. */
	strong?: boolean;
}

/** One line of your roster: a starting slot or the bench, filled or open. */
export interface TeamSlot {
	/** QB, RB, WR, TE, FLEX, BN. */
	slot: string;
	player: PlayerRef | null;
	/** The overall pick you took him with, null while the slot is open. */
	pick: number | null;
}

/** A key and what it does, for the keyboard legend. */
export interface KeyBinding {
	keys: string;
	does: string;
}

/** One of our top choices as the call card prints it (Lane 66o): the API's tenths as given, and the
 * chance the card recorded for him. */
export interface CallRow {
	player: PlayerRef;
	projected: number | null;
	vor: number | null;
	adp: number | null;
	chance: number | null;
}

/** The call's one action: Draft on your turn, Queue off it. */
export interface CallAction {
	/** Named with what it does: "Draft him". */
	label: string;
	key?: string;
	onclick?: (event: MouseEvent) => void;
}
