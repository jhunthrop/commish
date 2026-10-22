// The rail's styles show exactly each phase's rail, in the order the shell draws it, the phone's five
// along the bottom (spec 2026-10-16 §2). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RAIL_ITEMS, RAIL_KEYS, WORD_SETS, railInSeason, wordSetOf, type RailKey } from './nav.ts';
import { RAIL_WITHOUT_LEAGUE, railOfKey } from './rail-order.ts';
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

/** A rail's root as the styles name it: a season rail's with a league selected. */
const rootOf = (key: RailKey): string =>
	railInSeason(key) ? `:root[data-rail=${key}][data-league]` : `:root[data-rail=${key}]`;

for (const key of RAIL_KEYS) {
	void test(`the ${key} rail shows its items in its order, the phone its five`, () => {
		const rail = railOfKey(key);
		const root = rootOf(key);
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

for (const key of RAIL_KEYS.filter(railInSeason)) {
	void test(`the ${key} rail with no league selected draws no league tabs (Lane 83)`, () => {
		const root = `:root[data-rail=${key}]:not([data-league]):not([data-league-pending])`;
		const labels = (keys: string[]): string[] =>
			keys.map((k) => RAIL_ITEMS.find((item) => item.key === k)?.label ?? k);
		// The week's order is Players under the week's name (Lane 140, C19 and fix round 1).
		const five = ['League', 'Rest of season', "This week's rankings", 'Mock draft', 'Our record'];
		assert.deepEqual(labels(shown(root, false)), five);
		assert.deepEqual(labels(shown(root, true)), five);
		assert.deepEqual(
			shown(root, false),
			RAIL_WITHOUT_LEAGUE.map((entry) => entry.key)
		);
	});
}

for (const key of RAIL_KEYS.filter(railInSeason)) {
	void test(`the ${key} rail before the context answers draws only League, the other slots held blank`, () => {
		const root = `:root[data-rail=${key}][data-league-pending]`;
		const rail = railOfKey(key).map((entry) => entry.key);
		// The league's rail holds the slots, so nothing moves when the context answers.
		assert.deepEqual(shown(root, false), rail);
		const blank = css
			.split('}')
			.filter((rule) => rule.includes('{visibility:hidden'))
			.flatMap((rule) => (rule.split('{')[0] ?? '').split(','));
		const drawn = rail.filter((item) => !blank.includes(selector(root, item)));
		// League is the one slot both rails draw alike: every other is blank until /me answers.
		assert.deepEqual(drawn, ['league']);
	});
}

void test('with no rail named, the site before its draft shows', () => {
	assert.deepEqual(
		shown(':root:not([data-rail])', false),
		railOfKey('pre_draft').map((entry) => entry.key)
	);
});

/** The word sets a root shows: the rules that turn a set's wrapper back on (display:contents). */
function wordSetsShown(root: string): string[] {
	return WORD_SETS.filter((set) =>
		wideRules.split('}').some((rule) => {
			const [selectors = '', body = ''] = rule.split('{');
			return (
				body.includes('display:contents') &&
				selectors.split(',').includes(`${root} [data-words=${set}]`)
			);
		})
	);
}

void test('the page words are hidden until a rail shows their set', () => {
	assert.ok(css.includes('[data-words]{display:none}'));
});

for (const key of RAIL_KEYS) {
	void test(`the ${key} rail shows exactly one set of page words, the one its season has`, () => {
		assert.deepEqual(wordSetsShown(`:root[data-rail=${key}]`), [wordSetOf(key)]);
	});
}

void test('with no rail named, the draft words show', () => {
	assert.deepEqual(wordSetsShown(':root:not([data-rail])'), ['draft']);
});
