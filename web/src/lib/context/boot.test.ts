// The boot script that marks the page before its first paint: the basis line's room and the rail's
// phase (spec 2026-10-16 §2, first paint). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CONTEXT_KEY,
	LEAGUE_ATTR,
	LEAGUE_PENDING_ATTR,
	LINES_KEY,
	ACCOUNT_RAIL_KEY,
	RAIL_ATTR,
	SITE_RAIL_KEY,
	contextBootScript
} from './boot.ts';

const TOKEN = 'csrf-1';

class Store {
	readonly map = new Map<string, string>();
	getItem(key: string): string | null {
		return this.map.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.map.set(key, value);
	}
}

interface Run {
	attrs: Map<string, string>;
	local: Store;
}

/** Runs the script against a page with these cookies and storage, and answers the root's marks. */
function boot(
	build: Parameters<typeof contextBootScript>[0],
	{
		cookie = '',
		kept = null,
		local = new Store()
	}: { cookie?: string; kept?: unknown; local?: Store } = {}
): Run {
	const attrs = new Map<string, string>();
	const session = new Store();
	if (kept !== null) session.setItem(CONTEXT_KEY, JSON.stringify(kept));
	const document = {
		cookie,
		documentElement: { setAttribute: (name: string, value: string) => attrs.set(name, value) }
	};
	// eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script is ours, run as the page runs it
	const run = new Function(
		'document',
		'localStorage',
		'sessionStorage',
		contextBootScript(build)
	) as (document: unknown, localStorage: Store, sessionStorage: Store) => void;
	run(document, local, session);
	return { attrs, local };
}

void test("a first visit shows the build's rail and keeps it for the pages the Worker draws", () => {
	const run = boot('in_season');
	assert.equal(run.attrs.get(RAIL_ATTR), 'in_season');
	assert.equal(run.local.getItem(SITE_RAIL_KEY), 'in_season');
	// A page with no build of its own (a league page) reads the rail the last build kept.
	assert.equal(boot(null, { local: run.local }).attrs.get(RAIL_ATTR), 'in_season');
	assert.equal(boot(null).attrs.has(RAIL_ATTR), false);
});

void test("a signed-in visit shows the session copy's rail before the first paint", () => {
	const cookie = `theme=dark; commish_csrf=${TOKEN}`;
	const run = boot('pre_draft', { cookie, kept: { session: TOKEN, rail: 'playoffs_waivers' } });
	assert.equal(run.attrs.get(RAIL_ATTR), 'playoffs_waivers');
	// Another session's copy is never read: the build's rail stands.
	const other = boot('pre_draft', { cookie, kept: { session: 'csrf-0', rail: 'in_season' } });
	assert.equal(other.attrs.get(RAIL_ATTR), 'pre_draft');
	// Signed out, a copy is never read either.
	const out = boot('pre_draft', { kept: { session: null, rail: 'in_season' } });
	assert.equal(out.attrs.get(RAIL_ATTR), 'pre_draft');
});

void test('a word that is not a rail is never set', () => {
	const cookie = `commish_csrf=${TOKEN}`;
	const run = boot(null, { cookie, kept: { session: TOKEN, rail: 'x" onload="' } });
	assert.equal(run.attrs.has(RAIL_ATTR), false);
});

void test('the basis line keeps its room for a session, as before', () => {
	const local = new Store();
	local.setItem(LINES_KEY, '2');
	assert.equal(boot(null, { cookie: `commish_csrf=${TOKEN}`, local }).attrs.get(LEAGUE_ATTR), '2');
	assert.equal(boot(null, { local }).attrs.has(LEAGUE_ATTR), false);
});

void test("a new tab with a session and no session copy paints the account's kept rail", () => {
	const local = new Store();
	local.setItem(ACCOUNT_RAIL_KEY, 'in_season');
	const cookie = `commish_csrf=${TOKEN}`;
	assert.equal(boot('pre_draft', { cookie, local }).attrs.get(RAIL_ATTR), 'in_season');
	// Signed out, the account's rail is never read.
	assert.equal(boot('pre_draft', { local }).attrs.get(RAIL_ATTR), 'pre_draft');
	// The session copy, when it is this session's, stands over the kept rail.
	const kept = { session: TOKEN, rail: 'playoffs' };
	assert.equal(boot('pre_draft', { cookie, kept, local }).attrs.get(RAIL_ATTR), 'playoffs');
});

void test("a session copy's rail that is not a rail key leaves the build's", () => {
	const cookie = `commish_csrf=${TOKEN}`;
	const run = boot('in_season', { cookie, kept: { session: TOKEN, rail: 'x" onload="' } });
	assert.equal(run.attrs.get(RAIL_ATTR), 'in_season');
	const local = new Store();
	local.setItem(ACCOUNT_RAIL_KEY, 'bogus');
	assert.equal(boot('in_season', { cookie, local }).attrs.get(RAIL_ATTR), 'in_season');
});

void test('the first page after a sign-in marks the league pending until the context answers', () => {
	const cookie = `commish_csrf=${TOKEN}`;
	// A session with nothing kept: whether a league is selected is not known before /me (Lane 83).
	const first = boot('in_season', { cookie });
	assert.equal(first.attrs.get(LEAGUE_PENDING_ATTR), '');
	assert.equal(first.attrs.has(LEAGUE_ATTR), false);
	// Signed out, no league is ever selected: nothing is pending.
	assert.equal(boot('in_season').attrs.has(LEAGUE_PENDING_ATTR), false);
	// The lines kept say a league; this session's copy or the account's kept rail say what it was.
	const local = new Store();
	local.setItem(LINES_KEY, '1');
	assert.equal(boot('in_season', { cookie, local }).attrs.has(LEAGUE_PENDING_ATTR), false);
	const kept = { session: TOKEN, rail: 'in_season' };
	assert.equal(boot('in_season', { cookie, kept }).attrs.has(LEAGUE_PENDING_ATTR), false);
	const account = new Store();
	account.setItem(ACCOUNT_RAIL_KEY, 'in_season');
	assert.equal(boot('in_season', { cookie, local: account }).attrs.has(LEAGUE_PENDING_ATTR), false);
	// Another session's copy says nothing of this one.
	const other = { session: 'csrf-0', rail: 'in_season' };
	assert.equal(boot('in_season', { cookie, kept: other }).attrs.get(LEAGUE_PENDING_ATTR), '');
});
