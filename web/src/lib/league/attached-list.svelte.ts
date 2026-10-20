/** The account's attached leagues as the Account room reads them once (Lane 94 fix round 2): the
 * Leagues attached table and the Platforms table both draw from this one list, so a Detach moves
 * the platform's "N leagues followed" and its last read in the same instant as the table's row.
 * Each step is attached-state.ts's, tested there; this holds the state and reads the clock. */
import { leagueApi, type AttachedLeague } from './api.ts';
import {
	UNREAD_ATTACHED,
	dropDetached,
	liveLeagues,
	markDetached,
	readFailed,
	readList,
	unmarkDetached,
	type AttachedState
} from './attached-state.ts';

/** The list's reader, injected so a test can hand one in. */
export type ReadAttached = () => Promise<AttachedLeague[]>;

export class AttachedList {
	#state = $state.raw<AttachedState>(UNREAD_ATTACHED);

	/** The leagues as read, null before the read lands or when it failed. */
	readonly leagues = $derived(this.#state.leagues);
	/** The instant the list was read, in milliseconds, so each last read is said against it. */
	readonly readAt = $derived(this.#state.readAt);
	readonly failed = $derived(this.#state.failed);
	/** Leagues detached a moment ago, still on the table with their undo, by id. */
	readonly detached = $derived(this.#state.detached);
	/** The leagues still followed: the ones detached a moment ago left out, none before the read. */
	readonly live = $derived(liveLeagues(this.#state));

	readonly #read: ReadAttached;

	constructor(read: ReadAttached = () => leagueApi.attached()) {
		this.#read = read;
	}

	/** Reads the list. */
	async load(): Promise<void> {
		try {
			const list = await this.#read();
			this.#state = readList(this.#state, list, Date.now());
		} catch {
			this.#state = readFailed(this.#state);
		}
	}

	/** Marks a league detached, its row kept for its undo. */
	markDetached(id: string): void {
		this.#state = markDetached(this.#state, id);
	}

	/** Takes a detach back. */
	unmarkDetached(id: string): void {
		this.#state = unmarkDetached(this.#state, id);
	}

	/** Drops a detached league from the list once its undo has passed. */
	drop(id: string): void {
		this.#state = dropDetached(this.#state, id);
	}
}
