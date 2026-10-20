// Keeping the browser's sheet and the account's one sheet (B52): a visit with nothing in this
// browser and no sheet on the account writes nothing, and the first edit creates the sheet. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account, RemoteSheet, SheetSummary, SheetsApi } from './remote.ts';
import { EMPTY_STORED, type StoredSheet } from './storage.ts';
import { emptySheet, type Sheet, type SheetRow } from './model.ts';
import { push, reconcile } from './sync.ts';

const CHANGED = '2026-10-13T18:05:00.000Z';
const ROW: SheetRow = {
	id: 'gibbs',
	name: 'Jahmyr Gibbs',
	position: 'RB',
	team: 'DET',
	headshot: null,
	tier: null,
	tags: [],
	note: null
};

/** An account API over an in-memory list of sheets, recording each write. */
function fakeApi(start: readonly RemoteSheet[] = []): { api: SheetsApi; writes: string[] } {
	const sheets = [...start];
	const writes: string[] = [];
	const summary = (r: RemoteSheet): SheetSummary => ({
		id: r.id,
		name: r.sheet.name,
		format: r.sheet.format,
		rowCount: r.sheet.rows.length,
		updatedAt: r.updatedAt
	});
	const api: SheetsApi = {
		me: () => Promise.resolve({ email: 'jh@example.com' } as unknown as Account),
		list: () => Promise.resolve(sheets.map(summary)),
		get: (id) => {
			const found = sheets.find((s) => s.id === id);
			return found ? Promise.resolve(found) : Promise.reject(new Error(`no ${id}`));
		},
		create: (sheet: Sheet) => {
			writes.push(`create ${String(sheet.rows.length)}`);
			const made = { id: `s${String(sheets.length + 1)}`, updatedAt: CHANGED, sheet };
			sheets.unshift(made);
			return Promise.resolve(made);
		},
		remove: () => Promise.resolve(),
		replace: (id, sheet) => {
			writes.push(`replace ${id}`);
			return Promise.resolve({ id, updatedAt: CHANGED, sheet });
		},
		signInUrl: () => ''
	};
	return { api, writes };
}

void test('a visit with nothing here and no sheet on the account creates nothing', async () => {
	const { api, writes } = fakeApi();
	const outcome = await reconcile(api, EMPTY_STORED);
	assert.equal(outcome.kind, 'synced');
	assert.deepEqual(writes, []);
	assert.equal(outcome.stored.sync, null);
});

void test('a visit to an empty sheet on the account follows it and writes nothing', async () => {
	const remote: RemoteSheet = { id: 'mine', updatedAt: CHANGED, sheet: emptySheet() };
	const { api, writes } = fakeApi([remote]);
	const first = await reconcile(api, EMPTY_STORED);
	assert.equal(first.kind, 'synced');
	assert.deepEqual(first.stored.sync, { sheetId: 'mine', updatedAt: CHANGED });
	const again = await reconcile(api, first.stored);
	assert.deepEqual(writes, []);
	assert.equal(again.kind, 'synced');
	assert.equal(again.stored.sync?.updatedAt, CHANGED);
});

void test('a mark for a sheet deleted since is let go when nothing here is held', async () => {
	const { api, writes } = fakeApi();
	const stale: StoredSheet = { ...EMPTY_STORED, sync: { sheetId: 'gone', updatedAt: CHANGED } };
	const outcome = await reconcile(api, stale);
	assert.deepEqual(writes, []);
	assert.equal(outcome.kind, 'synced');
	assert.equal(outcome.stored.sync, null);
	assert.deepEqual(outcome.notices, []);
});

void test('the first edit after such a visit creates the account sheet', async () => {
	const { api, writes } = fakeApi();
	const visited = await reconcile(api, EMPTY_STORED);
	if (visited.kind !== 'synced') throw new Error('the visit did not sync');
	const edited: StoredSheet = {
		...visited.stored,
		sheet: { ...visited.stored.sheet, rows: [ROW] },
		dirty: true
	};
	assert.equal((await push(api, edited)).kind, 'reconcile');
	const saved = await reconcile(api, edited);
	assert.deepEqual(writes, ['create 1']);
	assert.equal(saved.kind, 'synced');
	assert.equal(saved.stored.sync?.sheetId, 's1');
});
