/** The account's attached leagues as the Account room reads them once (Lane 94 fix round 2): the
 * Leagues attached table and the Platforms table both draw from this one list, so a Detach moves
 * the platform's "N leagues followed" and its last read in the same instant as the table's row. */
import { leagueApi, type AttachedLeague } from './api.ts';

/** The list's reader, injected so a test can hand one in. */
export type ReadAttached = () => Promise<AttachedLeague[]>;

export class AttachedList {
	/** The leagues as read, null before the read lands or when it failed. */
	leagues = $state<AttachedLeague[] | null>(null);
	/** The instant the list was read, in milliseconds, so each last read is said against it. */
	readAt = $state(0);
	failed = $state(false);
	/** Leagues detached a moment ago, still on the table with their undo, by id. */
	detached = $state<readonly string[]>([]);

	/** The leagues still followed: the ones detached a moment ago left out, none before the read. */
	readonly live = $derived(
		this.leagues === null ? null : this.leagues.filter((l) => !this.detached.includes(l.id))
	);

	readonly #read: ReadAttached;

	constructor(read: ReadAttached = () => leagueApi.attached()) {
		this.#read = read;
	}

	/** Reads the list. */
	async load(): Promise<void> {
		try {
			const list = await this.#read();
			this.readAt = Date.now();
			this.leagues = list;
			this.failed = false;
		} catch {
			this.failed = true;
		}
	}

	/** Marks a league detached, its row kept for its undo. */
	markDetached(id: string): void {
		if (!this.detached.includes(id)) this.detached = [...this.detached, id];
	}

	/** Takes a detach back. */
	unmarkDetached(id: string): void {
		this.detached = this.detached.filter((x) => x !== id);
	}

	/** Drops a detached league from the list once its undo has passed. */
	drop(id: string): void {
		if (!this.detached.includes(id)) return;
		this.unmarkDetached(id);
		this.leagues = (this.leagues ?? []).filter((l) => l.id !== id);
	}
}
