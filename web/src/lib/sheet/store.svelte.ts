/**
 * Your sheet as the pages share it: the board's rail, the player page's verb, the sheet page, its
 * print view and the rooms all read and write this one store. Every edit lands in this browser at
 * once (storage.ts) and, when you are signed in, is saved to your account a moment later
 * (sync.ts), so the sheet works the same signed out, offline or on a slow phone.
 */
import { SvelteSet } from 'svelte/reactivity';
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient } from '#lib/api/client.ts';
import { browserStorage, type StorageGetter } from '#lib/ui/theme.ts';
import type { Position } from '#lib/types/player.ts';
import {
	addPlayer,
	emptySheet,
	movePlayer,
	nudgePlayer,
	removePlayer,
	renameSheet,
	replaceRows,
	setNote,
	toggleTag,
	type BoardFormat,
	type Sheet,
	type SheetPlayer,
	type SheetRow
} from './model.ts';
import { queueSeed } from './queue.ts';
import { sheetsApi, type Account, type SheetSummary, type SheetsApi } from './remote.ts';
import { EMPTY_STORED, SHELF_LIMIT, readStored, writeStored, type StoredSheet } from './storage.ts';
import { awaitsAccount, reconcilingStatus, unreachedStatus, type SyncStatus } from './status.ts';
import { isOffline, keepEdits, push, reconcile, syncedFrom, writesOnReconcile } from './sync.ts';
import { moveTierStart, removeTierAt, startTierAt } from './tiers.ts';

/** How long after the last edit a save goes out: a drag or a burst of typing is one save. */
export const SAVE_DELAY_MS = 900;
/** How many edits Undo can walk back. */
const UNDO_DEPTH = 50;

export type { SyncStatus } from './status.ts';

/** What a tap on a tag did: on or off, or nothing because his row holds as many as it can. */
export type TagToggle = 'done' | 'full';

/** What the store does when the page's world changes. */
export interface PageEvents {
	/** The connection came back. */
	online: () => void;
	/** The tab is in front again. */
	visible: () => void;
	/** The page is going away. */
	leaving: () => void;
}

export interface SheetStoreDeps {
	api: SheetsApi;
	storage: StorageGetter;
	now: () => Date;
	/** Whether the browser says it has a connection. Only this ever makes the sheet say Offline. */
	online: () => boolean;
	/** Wires the store to the page's events. Absent where there is no page. */
	events?: (handlers: PageEvents) => void;
}

export class SheetStore {
	stored = $state.raw<StoredSheet>(EMPTY_STORED);
	/** False until the browser copy is read, so a page never shows an empty sheet that is not. */
	loaded = $state(false);
	account = $state.raw<Account | null>(null);
	sheets = $state.raw<readonly SheetSummary[]>([]);
	status = $state<SyncStatus>('local');
	/** The instant the account last answered a sync, the clock the status line's day is said on. */
	answeredAt = $state.raw<Date | null>(null);
	/** The API's sentence for the last save that failed. */
	problem = $state<string | null>(null);
	canUndo = $state(false);
	/** True once the first reach for the account has settled, whatever it found: until then
	 * nobody can tell a signed-out drafter from a signed-in one whose answer is on its way. */
	resolved = $state(false);
	/** Lines the page owes the drafter: a conflict the account's copy won, a shelf sheet saved. */
	notices = $state.raw<readonly string[]>([]);

	sheet = $derived(this.stored.sheet);
	/** When the account's copy last changed (its updated_at), the sheet's one changed date: a
	 * visit that writes nothing leaves it where it was (B52). */
	changedAt = $derived(this.stored.sync?.updatedAt ?? null);
	ids: ReadonlySet<string> = $derived(new SvelteSet(this.stored.sheet.rows.map((row) => row.id)));
	signedIn = $derived(this.account !== null);

	readonly #deps: SheetStoreDeps;
	#undo: Sheet[] = [];
	/** The edit the last undo entry covers, when it is one that keeps growing (his note as you
	 * type it), so a burst of typing is one undo. */
	#growing: string | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#edits = 0;
	#busy: Promise<void> = Promise.resolve();
	#started = false;

	constructor(deps: SheetStoreDeps) {
		this.#deps = deps;
	}

	/** Reads the browser copy, then reaches for the account. Safe to call from every page. */
	load(): void {
		if (this.#started) return;
		this.#started = true;
		this.stored = readStored(this.#deps.storage);
		this.loaded = true;
		this.#deps.events?.({
			online: () => void this.#reconcile(),
			visible: () => this.refresh(),
			leaving: () => void this.flush()
		});
		void this.#reconcile();
	}

	has(playerId: string): boolean {
		return this.ids.has(playerId);
	}

	add(player: SheetPlayer): void {
		this.#commit(addPlayer(this.sheet, player));
	}

	remove(playerId: string): void {
		this.#commit(removePlayer(this.sheet, playerId));
	}

	move(playerId: string, to: number, tierFrom: 'above' | 'below' = 'above'): void {
		this.#commit(movePlayer(this.sheet, playerId, to, tierFrom));
	}

	nudge(playerId: string, delta: number, visible: readonly string[]): void {
		this.#commit(nudgePlayer(this.sheet, playerId, delta, visible));
	}

	/** Called as you type: every keystroke lands, and a burst of typing on one note is one undo. */
	setNote(playerId: string, note: string): void {
		this.#commit(setNote(this.sheet, playerId, note), `note:${playerId}`);
	}

	/** One tap on a tag, read against his row as the sheet holds it at the tap. */
	toggleTag(playerId: string, tag: string): TagToggle {
		const next = toggleTag(this.sheet, playerId, tag);
		if (next === null) return 'full';
		this.#commit(next);
		return 'done';
	}

	startTier(playerId: string): void {
		this.#commit({ ...this.sheet, rows: startTierAt(this.sheet.rows, playerId) });
	}

	removeTier(playerId: string): void {
		this.#commit({ ...this.sheet, rows: removeTierAt(this.sheet.rows, playerId) });
	}

	moveTier(playerId: string, to: number): void {
		this.#commit({ ...this.sheet, rows: moveTierStart(this.sheet.rows, playerId, to) });
	}

	rename(name: string): void {
		const next = renameSheet(this.sheet, name);
		if (next === this.sheet) return;
		this.#commit(next);
	}

	/** Makes these rows the sheet: an import, a pasted list, a saved draft, our board. */
	replace(rows: readonly SheetRow[], format?: BoardFormat): void {
		const base = format && this.stored.sync === null ? { ...this.sheet, format } : this.sheet;
		this.#commit(replaceRows(base, rows));
	}

	undo(): void {
		this.#growing = null;
		const previous = this.#undo.pop();
		this.canUndo = this.#undo.length > 0;
		if (previous) this.#write(previous);
	}

	/** Keeps a sheet in this browser beside the one you have open, never replacing it. It goes to
	 * your account as a new sheet at the next sync. */
	shelve(sheet: Sheet): void {
		if (this.stored.shelf.length >= SHELF_LIMIT) {
			this.notices = [...this.notices, 'This browser holds as many sheets as it can'];
			return;
		}
		this.#setStored({ ...this.stored, shelf: [...this.stored.shelf, sheet] });
		void this.#reconcile();
	}

	/** Opens a sheet from this browser's shelf, putting the open one on the shelf in its place.
	 * Signed out only: signed in, the shelf is on your account already. */
	openShelved(index: number): void {
		const chosen = this.stored.shelf[index];
		if (!chosen || this.signedIn) return;
		const rest = this.stored.shelf.filter((_, at) => at !== index);
		const shelf = this.sheet.rows.length > 0 ? [this.sheet, ...rest] : rest;
		this.#resetUndo();
		this.#edits += 1;
		this.#setStored({
			sheet: chosen,
			editedAt: this.#deps.now().toISOString(),
			dirty: true,
			sync: null,
			base: null,
			shelf
		});
	}

	dismissNotice(index: number): void {
		this.notices = this.notices.filter((_, at) => at !== index);
	}

	/** The queue a room opens with: your top players still available. */
	queueFor(available: ReadonlySet<string>, size?: number): readonly string[] {
		return queueSeed(this.sheet, available, size);
	}

	/** The rows at one position, in your order. */
	rowsAt(position: Position): readonly SheetRow[] {
		return this.sheet.rows.filter((row) => row.position === position);
	}

	signInUrl(returnTo: string): string {
		return this.#deps.api.signInUrl(returnTo);
	}

	/** Opens another of your account's sheets, saving this one first. */
	async open(sheetId: string): Promise<void> {
		await this.flush();
		await this.#serial(async () => {
			try {
				const remote = await this.#deps.api.get(sheetId);
				this.#resetUndo();
				this.#setStored(syncedFrom(remote, { ...this.stored, editedAt: null }));
				this.#saved();
			} catch (error) {
				this.#fail(error);
			}
		});
	}

	/** Starts a new sheet on your account, or starts over in this browser when signed out. */
	async startNew(format: BoardFormat, rows: readonly SheetRow[] = []): Promise<void> {
		const fresh = replaceRows(emptySheet(format), rows);
		if (!this.signedIn) {
			this.#commit(fresh);
			return;
		}
		await this.flush();
		await this.#serial(async () => {
			try {
				const created = await this.#deps.api.create(fresh);
				this.#resetUndo();
				this.#setStored(syncedFrom(created, { ...this.stored, editedAt: null }));
				this.sheets = await this.#deps.api.list();
				this.#saved();
			} catch (error) {
				this.#fail(error);
			}
		});
	}

	/** Saves a sheet beside the one you have open, never in its place: a new account sheet when
	 * the account answers, this browser's shelf when it does not (signed out or offline), from
	 * where the next sync puts it on the account. Call it once `resolved` is true. */
	async saveAsNew(sheet: Sheet): Promise<'account' | 'browser'> {
		if (!this.signedIn) {
			this.shelve(sheet);
			return 'browser';
		}
		const outcome = { saved: false };
		await this.#serial(async () => {
			try {
				await this.#deps.api.create(sheet);
				this.sheets = await this.#deps.api.list();
				outcome.saved = true;
			} catch (error) {
				if (!isOffline(error)) this.#fail(error);
			}
		});
		if (outcome.saved) return 'account';
		this.shelve(sheet);
		return 'browser';
	}

	/** Deletes one of your account's sheets, opening the next one when it is this one. */
	async deleteSheet(sheetId: string): Promise<void> {
		await this.#serial(async () => {
			try {
				await this.#deps.api.remove(sheetId);
				this.sheets = await this.#deps.api.list();
			} catch (error) {
				this.#fail(error);
			}
		});
		if (this.stored.sync?.sheetId !== sheetId) return;
		const next = this.sheets[0];
		if (next) await this.open(next.id);
		else await this.startNew(this.sheet.format);
	}

	/** Sends a pending save now, as a page closes or before a sheet switch. */
	async flush(): Promise<void> {
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
			await this.#save();
		}
		await this.#busy;
	}

	/** Called when the tab comes back: picks up edits made on another device. */
	refresh(): void {
		if (!this.signedIn || this.stored.dirty || this.#timer !== null) return;
		void this.#reconcile();
	}

	/** `growing` names an edit that extends the one before it with the same name (typing), which
	 * then shares that edit's undo entry. */
	#commit(next: Sheet, growing: string | null = null): void {
		if (next === this.sheet) return;
		if (growing === null || growing !== this.#growing) {
			this.#undo.push(this.sheet);
			if (this.#undo.length > UNDO_DEPTH) this.#undo.shift();
		}
		this.#growing = growing;
		this.canUndo = true;
		this.#write(next);
	}

	#write(next: Sheet): void {
		this.#edits += 1;
		this.#setStored({
			...this.stored,
			sheet: next,
			editedAt: this.#deps.now().toISOString(),
			dirty: true
		});
		this.#schedule();
	}

	#setStored(next: StoredSheet): void {
		this.stored = next;
		if (!writeStored(this.#deps.storage, next)) this.status = 'storage-blocked';
	}

	#resetUndo(): void {
		this.#undo = [];
		this.#growing = null;
		this.canUndo = false;
	}

	/** A request that never reached the account: Offline only when the browser says so. */
	#unreached(): void {
		const knowsAccount = this.account !== null || this.stored.sync !== null;
		this.status = unreachedStatus(this.#deps.online(), knowsAccount);
	}

	#saved(): void {
		this.status = 'saved';
		this.answeredAt = this.#deps.now();
	}

	#schedule(): void {
		if (!this.signedIn && !awaitsAccount(this.status)) return;
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.#save();
		}, SAVE_DELAY_MS);
	}

	/** One sync step at a time, so a save never races a reconcile. */
	#serial(step: () => Promise<void>): Promise<void> {
		const next = this.#busy.then(step);
		this.#busy = next.catch(() => undefined);
		return next;
	}

	#fail(error: unknown): void {
		this.status = 'failed';
		this.problem = error instanceof Error ? error.message : 'Your sheet did not save';
	}

	#reconcile(): Promise<void> {
		return this.#serial(async () => {
			await this.#reconcileStep();
			this.resolved = true;
		});
	}

	async #reconcileStep(): Promise<void> {
		this.status = reconcilingStatus(this.status, this.signedIn, writesOnReconcile(this.stored));
		const edits = this.#edits;
		const started = this.stored.sheet;
		const outcome = await reconcile(this.#deps.api, this.stored);
		switch (outcome.kind) {
			case 'synced':
				this.account = outcome.account;
				this.sheets = outcome.sheets;
				this.problem = null;
				if (outcome.notices.length > 0) this.notices = [...this.notices, ...outcome.notices];
				if (this.#edits === edits) {
					this.#setStored(outcome.stored);
					this.#saved();
				} else {
					this.#keepEditsOver(outcome.stored, started);
				}
				return;
			case 'signed-out':
				this.account = null;
				this.status = 'local';
				return;
			case 'offline':
				this.#unreached();
				return;
			case 'failed':
				this.status = 'failed';
				this.problem = outcome.message;
		}
	}

	/**
	 * You edited while a reconcile was out. What it settled stands (the sheet it followed or
	 * created, the new ancestor, the shelf it emptied), so nothing is created or uploaded twice.
	 * Your edits are laid over the sheet it wrote: the copy reconcile started from is the
	 * ancestor, so each edit you made since is this side's change and every player the merge
	 * brought in stays. Only the sheet is left unsaved, and the next save writes it guarded.
	 */
	#keepEditsOver(settled: StoredSheet, started: Sheet): void {
		const kept = keepEdits(settled, started, this.stored);
		if (kept.notices.length > 0) this.notices = [...this.notices, ...kept.notices];
		this.#setStored(kept.stored);
		this.#schedule();
	}

	#save(): Promise<void> {
		if (!this.signedIn) return this.#reconcile();
		return this.#serial(async () => {
			this.status = 'saving';
			const edits = this.#edits;
			const outcome = await push(this.#deps.api, this.stored);
			switch (outcome.kind) {
				case 'saved':
					this.problem = null;
					if (this.#edits === edits) {
						this.#setStored(outcome.stored);
						this.#saved();
					} else {
						// Edits landed while this one was out: the account now holds what was sent,
						// so that is the new ancestor, and the newer edits stay unsaved.
						this.#setStored({
							...this.stored,
							sync: outcome.stored.sync,
							base: outcome.stored.base
						});
					}
					return;
				case 'reconcile':
					void this.#reconcile();
					return;
				case 'signed-out':
					this.account = null;
					this.status = 'local';
					return;
				case 'offline':
					this.#unreached();
					return;
				case 'failed':
					this.status = 'failed';
					this.problem = outcome.message;
			}
		});
	}
}

function pageEvents(handlers: PageEvents): void {
	window.addEventListener('online', handlers.online);
	window.addEventListener('pagehide', handlers.leaving);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') handlers.visible();
		else handlers.leaving();
	});
}

function browserDeps(): SheetStoreDeps {
	return {
		api: sheetsApi(apiClient(PUBLIC_API_URL)),
		storage: browserStorage,
		now: () => new Date(),
		online: () => navigator.onLine,
		events: pageEvents
	};
}

/** The one sheet store every page shares. */
export const sheetStore = new SheetStore(browserDeps());
