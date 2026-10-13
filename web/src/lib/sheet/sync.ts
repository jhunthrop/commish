/**
 * Keeping the browser's sheet and the account's sheet one sheet. Pure steps over the API, so the
 * store decides when they run and this decides what they do:
 *
 * - reconcile: on sign-in, on load, and after a refused save. Finds the account sheet this browser
 *   follows (the one it last saved to, else the account's most recently changed, else a new one
 *   made from this browser's copy), merges by merge.ts's rule, and writes the merge back only when
 *   it differs, guarded by the sheet's updated_at.
 * - push: after an edit. Writes the whole sheet guarded by the updated_at it last saw, and hands a
 *   refusal back to reconcile, which merges and writes again.
 */
import { ApiError, CLIENT_CODES } from '#lib/api/client.ts';
import { mergeSheets, sameSheet } from './merge.ts';
import type { Sheet } from './model.ts';
import type { RemoteSheet, SheetSummary, SheetsApi, Account } from './remote.ts';
import type { StoredSheet } from './storage.ts';

const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const CONFLICT = 409;
/** A save refused this many times in a row stops and says so, rather than loop. */
const MAX_ATTEMPTS = 3;

export type SyncOutcome =
	| { kind: 'signed-out' }
	| { kind: 'offline' }
	| { kind: 'synced'; account: Account; stored: StoredSheet; sheets: readonly SheetSummary[] }
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

function syncedFrom(remote: RemoteSheet, editedAt: string | null): StoredSheet {
	return {
		sheet: remote.sheet,
		editedAt,
		dirty: false,
		sync: { sheetId: remote.id, updatedAt: remote.updatedAt }
	};
}

/** The account sheet this browser follows, made from the browser's copy when there is none. */
async function followed(
	api: SheetsApi,
	stored: StoredSheet,
	sheets: readonly SheetSummary[]
): Promise<{ remote: RemoteSheet; created: boolean }> {
	const mine = stored.sync ? sheets.find((sheet) => sheet.id === stored.sync?.sheetId) : undefined;
	const target = mine ?? sheets[0];
	if (target) return { remote: await api.get(target.id), created: false };
	return { remote: await api.create(stored.sheet), created: true };
}

async function writeMerged(
	api: SheetsApi,
	remote: RemoteSheet,
	merged: Sheet
): Promise<RemoteSheet> {
	let written = remote;
	if (merged.name !== remote.sheet.name) {
		const renamed = await api.rename(remote.id, merged.name);
		written = {
			...remote,
			updatedAt: renamed.updatedAt,
			sheet: { ...remote.sheet, name: renamed.name }
		};
	}
	if (sameSheet(merged, written.sheet)) return written;
	return api.replace(remote.id, merged, written.updatedAt);
}

async function reconcileOnce(
	api: SheetsApi,
	stored: StoredSheet
): Promise<{ account: Account; stored: StoredSheet; sheets: readonly SheetSummary[] }> {
	const account = await api.me();
	const sheets = await api.list();
	const { remote, created } = await followed(api, stored, sheets);
	const merged = created
		? remote.sheet
		: mergeSheets({
				local: stored.sheet,
				localEditedAt: stored.editedAt,
				localDirty: stored.dirty,
				server: remote.sheet,
				serverUpdatedAt: remote.updatedAt
			});
	const written = await writeMerged(api, remote, merged);
	const list = created || written !== remote ? await api.list() : sheets;
	return { account, stored: syncedFrom(written, stored.editedAt), sheets: list };
}

function failure(error: unknown): SyncOutcome {
	if (isUnauthorized(error)) return { kind: 'signed-out' };
	if (isOffline(error)) return { kind: 'offline' };
	const message = error instanceof Error ? error.message : 'Your sheet did not save';
	return { kind: 'failed', message };
}

/** One sheet from the browser's copy and the account's. */
export async function reconcile(api: SheetsApi, stored: StoredSheet): Promise<SyncOutcome> {
	let current = stored;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		try {
			return { kind: 'synced', ...(await reconcileOnce(api, current)) };
		} catch (error) {
			if (isGone(error) && current.sync) {
				current = { ...current, sync: null };
				continue;
			}
			if (isConflict(error) && attempt < MAX_ATTEMPTS) continue;
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
	if (!stored.sync) return { kind: 'reconcile' };
	try {
		const written = await api.replace(stored.sync.sheetId, stored.sheet, stored.sync.updatedAt);
		return { kind: 'saved', stored: syncedFrom(written, stored.editedAt) };
	} catch (error) {
		if (isConflict(error) || isGone(error)) return { kind: 'reconcile' };
		const outcome = failure(error);
		return outcome.kind === 'synced' ? { kind: 'reconcile' } : outcome;
	}
}
