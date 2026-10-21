// The empty sheet a visit saved before Lane 105 goes on the next read of the account, once (Lane 117,
// B84). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ApiClient } from '#lib/api/client.ts';
import { SESSION_CSRF_COOKIE } from '#lib/api/session.ts';
import { accountApi } from './account-api.ts';
import { VISIT_SAVES_ENDED_AT, visitSaved, withoutVisitSaved } from './visit-saved.ts';

/** The founder's sheet as the account lists it: "My sheet", saved by a visit on Oct 13. */
const VISIT_SAVED = {
	id: 'sheet-oct-13',
	name: 'My sheet',
	format: 'ppr' as const,
	row_count: 0,
	created_at: '2026-10-13T19:41:00Z',
	updated_at: '2026-10-13T19:41:00Z'
};
const KEPT = { ...VISIT_SAVED, id: 'sheet-kept', name: 'Draft day', row_count: 42 };
/** Made empty on purpose after the fix: never touched. */
const EMPTIED_SINCE = {
	...VISIT_SAVED,
	id: 'sheet-new',
	created_at: '2026-10-21T15:00:00Z',
	updated_at: '2026-10-21T15:00:00Z'
};

void test('a sheet is visit-saved when it holds no player and was not written since the fix', () => {
	assert.equal(visitSaved(VISIT_SAVED), true);
	assert.equal(visitSaved(KEPT), false);
	assert.equal(visitSaved(EMPTIED_SINCE), false);
	assert.equal(visitSaved({ ...VISIT_SAVED, updated_at: VISIT_SAVES_ENDED_AT }), false);
});

void test('the visit-saved sheet is deleted and left off the list; a failed delete keeps it listed', async () => {
	const removed: string[] = [];
	const kept = await withoutVisitSaved([VISIT_SAVED, KEPT, EMPTIED_SINCE], (id) => {
		removed.push(id);
		return Promise.resolve(null);
	});
	assert.deepEqual(removed, [VISIT_SAVED.id]);
	assert.deepEqual(
		kept.map((s) => s.id),
		[KEPT.id, EMPTIED_SINCE.id]
	);
	const failed = await withoutVisitSaved([VISIT_SAVED, KEPT], () =>
		Promise.reject(new Error('offline'))
	);
	assert.deepEqual(
		failed.map((s) => s.id),
		[VISIT_SAVED.id, KEPT.id]
	);
});

void test("the account's read removes it through the API, and a second read asks nothing more", async () => {
	Object.defineProperty(globalThis, 'document', {
		value: { cookie: `${SESSION_CSRF_COOKIE}=csrf-1` },
		configurable: true
	});
	let stored = [VISIT_SAVED, KEPT];
	const asked: string[] = [];
	const client = {
		call: (path: string, init?: { method?: string }) => {
			asked.push(`${init?.method ?? 'GET'} ${path}`);
			if (init?.method === 'DELETE') {
				stored = stored.filter((s) => !path.endsWith(s.id));
				return Promise.resolve(null);
			}
			if (path === '/me') return Promise.resolve({ id: 'me' });
			if (path.startsWith('/sheets')) return Promise.resolve(stored);
			return Promise.resolve([]);
		}
	} as unknown as ApiClient;
	const first = await accountApi(client, () => true).load();
	assert.ok(first.kind === 'signed-in');
	assert.deepEqual(
		first.sheets.map((s) => s.id),
		[KEPT.id]
	);
	assert.ok(asked.includes(`DELETE /sheets/${VISIT_SAVED.id}`));
	asked.length = 0;
	await accountApi(client, () => true).load();
	assert.ok(!asked.some((a) => a.startsWith('DELETE')));
});
