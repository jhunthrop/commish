// The rail's styles show exactly each phase's rail, in the order the shell draws it, the phone's five
// along the bottom (spec 2026-10-16 §2). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RAIL_ITEMS, RAIL_KEYS } from './nav.ts';
import { railOfKey } from './rail-order.ts';
import { PHONE_MAX_PX, railCss } from './rail-css.ts';

const css = railCss();

/** The rules outside the phone's media query, and inside it. */
const [wideRules = '', phoneRules = ''] = css.split(`@media (max-width:${String(PHONE_MAX_PX)}px)`);

const selector = (root: string, item: string): string => `${root} .rail .item[data-k=${item}]`;

function showsOnDesk(root: string, item: string): boolean {
	return wideRules.split('}').some((rule) => {
		const [selectors = '', body = ''] = rule.split('{');
		return body.includes('display:flex') && selectors.split(',').includes(selector(root, item));
	});
}

/** The rail a root shows, in the shell's drawing order (the order a reader tabs through), on a
 * desk or a phone. */
function shown(root: string, phone: boolean): string[] {
	return RAIL_ITEMS.map((item) => item.key).filter(
		(key) => showsOnDesk(root, key) && !(phone && phoneRules.includes(selector(root, key)))
	);
}

void test('every item is hidden until a rail shows it', () => {
	assert.ok(css.startsWith('.rail .item[data-k]{display:none}'));
});

for (const key of RAIL_KEYS) {
	void test(`the ${key} rail shows its items in its order, the phone its five`, () => {
		const rail = railOfKey(key);
		const root = `:root[data-rail=${key}]`;
		assert.deepEqual(
			shown(root, false),
			rail.map((entry) => entry.key)
		);
		assert.deepEqual(
			shown(root, true),
			rail.filter((entry) => !entry.wideOnly).map((entry) => entry.key)
		);
	});
}

void test('with no rail named, the site before its draft shows', () => {
	assert.deepEqual(
		shown(':root:not([data-rail])', false),
		railOfKey('pre_draft').map((entry) => entry.key)
	);
});
