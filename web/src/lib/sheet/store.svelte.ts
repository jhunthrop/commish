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
	setTags,
	type BoardFormat,
	type Sheet,
	type SheetPlayer,
	type SheetRow
} from './model.ts';
import { queueSeed } from './queue.ts';
import { sheetsApi, type Account, type SheetSummary, type SheetsApi } from './remote.ts';
import { EMPTY_STORED, readStored, writeStored, type StoredSheet } from './storage.ts';
import { push, reconcile } from './sync.ts';
import { moveTierStart, removeTierAt, startTierAt } from './tiers.ts';

/** How long after the last edit a save goes out: a drag or a burst of typing is one save. */
export const SAVE_DELAY_MS = 900;
/** How many edits Undo can walk back. */
const UNDO_DEPTH = 50;

export type SyncStatus =
	'local' | 'checking' | 'saving' | 'saved' | 'offline' | 'failed' | 'storage-blocked';

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
	/** The API's sentence for the last save that failed. */
	problem = $state<string | null>(null);
	canUndo = $state(false);

	sheet = $derived(this.stored.sheet);
	ids: ReadonlySet<string> = $derived(new SvelteSet(this.stored.sheet.rows.map((row) => row.id)));
	signedIn = $derived(this.account !== null);

	readonly #deps: SheetStoreDeps;
	#undo: Sheet[] = [];
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

	setNote(playerId: string, note: string): void {
		this.#commit(setNote(this.sheet, playerId, note));
	}

	setTags(playerId: string, tags: readonly string[]): void {
		this.#commit(setTags(this.sheet, playerId, tags));
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
		const previous = this.#undo.pop();
		this.canUndo = this.#undo.length > 0;
		if (previous) this.#write(previous);
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
				this.#setStored({
					sheet: remote.sheet,
					editedAt: null,
					dirty: false,
					sync: { sheetId: remote.id, updatedAt: remote.updatedAt }
				});
				this.status = 'saved';
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
				this.#setStored({
					sheet: created.sheet,
					editedAt: null,
					dirty: false,
					sync: { sheetId: created.id, updatedAt: created.updatedAt }
				});
				this.sheets = await this.#deps.api.list();
				this.status = 'saved';
			} catch (error) {
				this.#fail(error);
			}
		});
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

	#commit(next: Sheet): void {
		if (next === this.sheet) return;
		this.#undo.push(this.sheet);
		if (this.#undo.length > UNDO_DEPTH) this.#undo.shift();
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
		this.canUndo = false;
	}

	#schedule(): void {
		if (!this.signedIn && this.status !== 'offline') return;
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
			this.status = this.signedIn ? 'saving' : 'checking';
			const edits = this.#edits;
			const outcome = await reconcile(this.#deps.api, this.stored);
			switch (outcome.kind) {
				case 'synced':
					this.account = outcome.account;
					this.sheets = outcome.sheets;
					this.problem = null;
					if (this.#edits === edits) {
						this.#setStored(outcome.stored);
						this.status = 'saved';
					} else {
						// You edited while the merge ran. Your copy is still marked unsaved, so the
						// next pass merges it with what was just written and nothing is lost.
						void this.#reconcile();
					}
					return;
				case 'signed-out':
					this.account = null;
					this.status = 'local';
					return;
				case 'offline':
					this.status = 'offline';
					return;
				case 'failed':
					this.status = 'failed';
					this.problem = outcome.message;
			}
		});
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
						this.status = 'saved';
					} else {
						this.#setStored({ ...this.stored, sync: outcome.stored.sync });
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
					this.status = 'offline';
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
		events: pageEvents
	};
}

/** The one sheet store every page shares. */
export const sheetStore = new SheetStore(browserDeps());
