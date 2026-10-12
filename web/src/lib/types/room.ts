import type { PlayerRef } from './player.ts';

/** A pick made between two of your turns. */
export interface WentPick {
	player: PlayerRef;
	/** The overall pick number. */
	pick: number;
	/** He was in your queue when he went. */
	queued: boolean;
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

/** The call's one action: Draft on your turn, Queue off it. */
export interface CallAction {
	/** Named with what it does: "Draft Williams". */
	label: string;
	key?: string;
	onclick?: (event: MouseEvent) => void;
}
