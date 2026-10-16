// The boot script that marks the page before its first paint: the basis line's room and the rail's
// phase (spec 2026-10-16 §2, first paint). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CONTEXT_KEY,
	LEAGUE_ATTR,
	LINES_KEY,
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
