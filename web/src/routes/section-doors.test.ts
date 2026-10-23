// The bare section addresses answer the page the rail links, never the 404 (Lane 166, D18): each
// door's one decision is the nav constant it redirects to, so the rail and the doors cannot drift.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COMPANION_START, MOCK_SETUP } from '#lib/ui/nav.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const DOORS = [
	{ door: './lobby/+page.ts', target: 'MOCK_SETUP', href: MOCK_SETUP },
	{ door: './mock/+page.ts', target: 'MOCK_SETUP', href: MOCK_SETUP },
	{ door: './companion/+page.ts', target: 'COMPANION_START', href: COMPANION_START }
] as const;

for (const { door, target, href } of DOORS) {
	void test(`${door} redirects to ${href} by the rail's own constant`, () => {
		const source = read(door);
		assert.match(source, new RegExp(`redirect\\(307, resolve\\(${target}\\)\\)`));
		assert.doesNotMatch(source, /['"]\/(mock|companion)\/new['"]/);
	});

	void test(`${href} is a page of its own`, () => {
		assert.ok(readFileSync(new URL(`.${href}/+page.svelte`, import.meta.url)).length > 0);
	});
}
