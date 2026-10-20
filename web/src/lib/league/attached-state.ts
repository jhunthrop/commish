/** The account's attached leagues as the Account room holds them (Lane 94 fix round 2, B72): the
 * list as read, when it was read, whether the read failed, and the leagues detached a moment ago
 * that keep their row for its undo. Pure and immutable, so the steps a Detach, its Undo and the
 * drop after it take are tested here (attached-state.test.ts); attached-list.svelte.ts holds one
 * of these for both Account tables. */
import type { AttachedLeague } from './api.ts';

export interface AttachedState {
	/** The leagues as read, null before the read lands or when it failed. */
	readonly leagues: readonly AttachedLeague[] | null;
	/** The instant the list was read, in milliseconds, so each last read is said against it. */
	readonly readAt: number;
	readonly failed: boolean;
	/** Leagues detached a moment ago, still on the table with their undo, by id. */
	readonly detached: readonly string[];
}

export const UNREAD_ATTACHED: AttachedState = {
	leagues: null,
	readAt: 0,
	failed: false,
	detached: []
};

/** The leagues still followed: the ones detached a moment ago left out, none before the read. */
export function liveLeagues(state: AttachedState): readonly AttachedLeague[] | null {
	return state.leagues === null
		? null
		: state.leagues.filter((league) => !state.detached.includes(league.id));
}

/** The list as a read answered it at `readAt`; a detach still waiting on its undo stays marked. */
export function readList(
	state: AttachedState,
	leagues: readonly AttachedLeague[],
	readAt: number
): AttachedState {
	return { ...state, leagues, readAt, failed: false };
}

/** A read that did not answer: what was read before stays. */
export function readFailed(state: AttachedState): AttachedState {
	return { ...state, failed: true };
}

/** A league detached, its row kept for its undo. */
export function markDetached(state: AttachedState, id: string): AttachedState {
	return state.detached.includes(id) ? state : { ...state, detached: [...state.detached, id] };
}

/** A detach taken back. */
export function unmarkDetached(state: AttachedState, id: string): AttachedState {
	return { ...state, detached: state.detached.filter((x) => x !== id) };
}

/** A detached league off the list once its undo has passed; one taken back stays. */
export function dropDetached(state: AttachedState, id: string): AttachedState {
	if (!state.detached.includes(id)) return state;
	const kept = unmarkDetached(state, id);
	return { ...kept, leagues: (state.leagues ?? []).filter((league) => league.id !== id) };
}
