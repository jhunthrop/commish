/**
 * Keeping the browser's sheet and the account's sheet one sheet. Pure steps over the API, so the
 * store decides when they run and this decides what they do.
 *
 * Which account sheet this browser follows, never guessed:
 * - The one it last saved to. If that sheet is gone (deleted on another device) and this browser
 *   holds a sheet, that sheet is created on the account as a new sheet and followed.
 * - On a browser's first sign-in, a sheet it holds is created on the account as a new sheet and
 *   followed. It is never merged into another account sheet. A browser holding nothing it ever
 *   edited opens the account's most recently changed sheet, which loses nothing because there is
 *   nothing here to merge.
 * - A followed sheet in another format than this browser's edited copy is an error the page shows,
 *   not a merge.
 *
 * Then reconcile makes the two one sheet:
 * - No unsaved edits here: the account's copy is the sheet.
 * - Unsaved edits here and the account unchanged since the last sync: this browser's copy is the
 *   sheet, written as it is.
 * - Both changed: merge.ts's three-way merge against the last-synced ancestor, written back
 *   guarded by the account's updated_at.
 *
 * push writes after an edit, guarded by the updated_at it last saw, and hands a refusal back to
 * reconcile. Sheets on the shelf (saved here while signed out or offline) are created on the
 * account first.
 */
import { ApiError, CLIENT_CODES } from '#lib/api/client.ts';
import { FORMAT_LABELS } from './format.ts';
import { mergeSheets, sameSheet } from './merge.ts';
import { emptySheet, type Sheet } from './model.ts';
import type { Account, RemoteSheet, SheetSummary, SheetsApi } from './remote.ts';
import type { StoredSheet } from './storage.ts';

const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const CONFLICT = 409;
/** A save refused this many times in a row stops and says so, rather than loop. */
const MAX_ATTEMPTS = 3;

export interface Synced {
	account: Account;
	stored: StoredSheet;
	sheets: readonly SheetSummary[];
	/** One line each for what the page should tell the drafter. */
	notices: readonly string[];
}

export type SyncOutcome =
	| ({ kind: 'synced' } & Synced)
	| { kind: 'signed-out' }
	| { kind: 'offline' }
	| { kind: 'failed'; message: string };

export function isUnauthorized(error: unknown): boolean {
	return error instanceof ApiError && error.status === UNAUTHORIZED;
}

export function isOffline(error: unknown): boolean {
	return error instanceof ApiError && error.code === CLIENT_CODES.offline;
}

export function isConflict(error: unknown): boolean {
	return error instanceof ApiError && error.status === CONFLICT;
}

export function isGone(error: unknown): boolean {
	return error instanceof ApiError && error.status === NOT_FOUND;
}

class FormatMismatch extends Error {}

/** The browser's copy once it agrees with the account's `remote`. */
export function syncedFrom(remote: RemoteSheet, stored: StoredSheet): StoredSheet {
	return {
		...stored,
		sheet: remote.sheet,
		dirty: false,
		sync: { sheetId: remote.id, updatedAt: remote.updatedAt },
		base: remote.sheet
	};
}

const holdsSomething = (stored: StoredSheet): boolean =>
	stored.dirty || stored.sheet.rows.length > 0;

interface Followed {
	remote: RemoteSheet;
	/** Made from this browser's copy just now, so the two already agree. */
	created: boolean;
	notices: string[];
}

async function followed(
	api: SheetsApi,
	stored: StoredSheet,
	sheets: readonly SheetSummary[]
): Promise<Followed> {
	const following = stored.sync
		? sheets.find((sheet) => sheet.id === stored.sync?.sheetId)
		: undefined;
	if (following) {
		const remote = await api.get(following.id);
		if (stored.dirty && remote.sheet.format !== stored.sheet.format) {
			throw new FormatMismatch(
				`This browser's sheet is ${FORMAT_LABELS[stored.sheet.format]} and the one on your account is ${FORMAT_LABELS[remote.sheet.format]}, so they were not merged`
			);
		}
		return { remote, created: false, notices: [] };
	}
	const notices: string[] = [];
	if (stored.sync && holdsSomething(stored)) {
		notices.push(
			'The sheet this browser followed was deleted on another device, so this one was saved as a new sheet'
		);
	}
	const latest = sheets[0];
	if (!holdsSomething(stored) && latest) {
		return { remote: await api.get(latest.id), created: false, notices };
	}
	return { remote: await api.create(stored.sheet), created: true, notices };
}

/** The sheet both sides become, and the notices the page owes the drafter. */
function settle(
	stored: StoredSheet,
	remote: RemoteSheet
): { sheet: Sheet; notices: readonly string[] } {
	if (!stored.dirty) return { sheet: remote.sheet, notices: [] };
	const unchanged =
		stored.sync?.sheetId === remote.id && stored.sync.updatedAt === remote.updatedAt;
	if (unchanged) return { sheet: { ...stored.sheet, format: remote.sheet.format }, notices: [] };
	const ancestor =
		stored.sync?.sheetId === remote.id && stored.base
			? stored.base
			: emptySheet(remote.sheet.format);
	return mergeSheets({ ancestor, local: stored.sheet, server: remote.sheet });
}

async function write(api: SheetsApi, remote: RemoteSheet, sheet: Sheet): Promise<RemoteSheet> {
	let written = remote;
	if (sheet.name !== remote.sheet.name) {
		const renamed = await api.rename(remote.id, sheet.name);
		written = {
			...remote,
			updatedAt: renamed.updatedAt,
			sheet: { ...remote.sheet, name: renamed.name }
		};
	}
	if (sameSheet(sheet, written.sheet)) return written;
	return api.replace(remote.id, sheet, written.updatedAt);
}

/** Creates every shelved sheet on the account, in order. A sheet that does not make it stays on
 * the shelf, and so does every one after a lost connection, so none is created twice. */
async function uploadShelf(
	api: SheetsApi,
	stored: StoredSheet
): Promise<{ stored: StoredSheet; notices: string[] }> {
	const left: Sheet[] = [];
	const notices: string[] = [];
	let reachable = true;
	for (const sheet of stored.shelf) {
		if (!reachable) {
			left.push(sheet);
			continue;
		}
		try {
			await api.create(sheet);
			notices.push(`${sheet.name} is saved to your account`);
		} catch (error) {
			reachable = !(isOffline(error) || isUnauthorized(error));
			if (reachable)
				notices.push(`${sheet.name} did not save to your account and stays in this browser`);
			left.push(sheet);
		}
	}
	return { stored: { ...stored, shelf: left }, notices };
}

async function reconcileOnce(api: SheetsApi, stored: StoredSheet): Promise<Synced> {
	const account = await api.me();
	const sheets = await api.list();
	const { remote, created, notices } = await followed(api, stored, sheets);
	const settled = created ? { sheet: remote.sheet, notices: [] } : settle(stored, remote);
	const written = created ? remote : await write(api, remote, settled.sheet);
	// The shelf goes last, so a failure above never leaves a shelved sheet created twice.
	const shelf = await uploadShelf(api, syncedFrom(written, stored));
	const changed = created || written !== remote || stored.shelf.length > 0;
	return {
		account,
		stored: shelf.stored,
		sheets: changed ? await api.list() : sheets,
		notices: [...notices, ...settled.notices, ...shelf.notices]
	};
}

function failure(error: unknown): SyncOutcome {
	if (isUnauthorized(error)) return { kind: 'signed-out' };
	if (isOffline(error)) return { kind: 'offline' };
	const message = error instanceof Error ? error.message : 'Your sheet did not save';
	return { kind: 'failed', message };
}

/** One sheet from the browser's copy and the account's. */
export async function reconcile(api: SheetsApi, stored: StoredSheet): Promise<SyncOutcome> {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		try {
			return { kind: 'synced', ...(await reconcileOnce(api, stored)) };
		} catch (error) {
			if ((isConflict(error) || isGone(error)) && attempt < MAX_ATTEMPTS) continue;
			return failure(error);
		}
	}
	return { kind: 'failed', message: 'This sheet keeps changing on another device' };
}

export type PushOutcome =
	| { kind: 'saved'; stored: StoredSheet }
	| { kind: 'reconcile' }
	| { kind: 'signed-out' }
	| { kind: 'offline' }
	| { kind: 'failed'; message: string };

/** Saves the browser's copy to the sheet it follows. */
export async function push(api: SheetsApi, stored: StoredSheet): Promise<PushOutcome> {
	if (!stored.sync || stored.shelf.length > 0) return { kind: 'reconcile' };
	try {
		const { sheetId } = stored.sync;
		let updatedAt = stored.sync.updatedAt;
		if (stored.sheet.name !== stored.base?.name) {
			updatedAt = (await api.rename(sheetId, stored.sheet.name)).updatedAt;
		}
		const written = await api.replace(sheetId, stored.sheet, updatedAt);
		return { kind: 'saved', stored: syncedFrom(written, stored) };
	} catch (error) {
		if (isConflict(error) || isGone(error)) return { kind: 'reconcile' };
		const outcome = failure(error);
		return outcome.kind === 'synced' ? { kind: 'reconcile' } : outcome;
	}
}
