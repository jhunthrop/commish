// The front door's and the board's words follow the season the rail shows (Lane 59, H1 and M4): in
// season the bar says so, the heading names the rest of the season, and the one solid verb follows
// your league; before the draft and after the season the draft words stay. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RAIL_KEYS, railInSeason, type RailKey } from '#lib/ui/nav.ts';
import { railOfKey } from '#lib/ui/rail-order.ts';
import { PAGE_VERBS, boardWords, frontWords } from './season-words.ts';

const IN_SEASON: readonly RailKey[] = ['in_season', 'playoffs', 'playoffs_waivers'];
const BEFORE_OR_AFTER: readonly RailKey[] = ['pre_draft', 'draft_day', 'offseason'];
const REST = { season: 2026, rosFromWeek: 6, label: 'PPR' };
const PRESEASON = { season: 2026, label: 'PPR' };

/** The copy rules: no em-dash or en-dash, no semicolon. */
function clean(line: string): void {
	assert.doesNotMatch(line, /[–—;]/, line);
}

void test('the season is the rails that hold the in-season screens', () => {
	for (const key of RAIL_KEYS) {
		const lineup = railOfKey(key).some((item) => item.key === 'lineup');
		assert.equal(railInSeason(key), lineup, key);
	}
});

for (const rail of IN_SEASON) {
	void test(`the front door in ${rail} follows your league`, () => {
		const words = frontWords(rail, REST, false);
		assert.equal(words.title, 'In season');
		assert.equal(
			words.heading,
			'Our board for the rest of the 2026 season from week 6, for your league'
		);
		assert.equal(words.verb, 'follow');
		assert.equal(PAGE_VERBS[words.verb], 'Follow your league');
		assert.deepEqual(words.quiet, ['mock']);
	});
}

void test('a member who follows a league opens it from the front door in season', () => {
	const words = frontWords('in_season', REST, true);
	assert.equal(words.verb, 'open_league');
	assert.equal(PAGE_VERBS[words.verb], 'Open your league');
	assert.deepEqual(words.quiet, ['mock']);
});

void test('in season on a board that still ranks the full season, the heading claims no rest of season', () => {
	assert.equal(
		frontWords('in_season', PRESEASON, false).heading,
		'Our 2026 board, for your league'
	);
});

for (const rail of BEFORE_OR_AFTER) {
	void test(`the front door in ${rail} keeps the draft words`, () => {
		const words = frontWords(rail, PRESEASON, false);
		assert.equal(words.title, 'Draft prep');
		assert.equal(words.heading, 'Our 2026 board, for your draft and your league');
		assert.equal(words.verb, 'mock');
		assert.equal(PAGE_VERBS[words.verb], 'Start a mock draft');
		assert.deepEqual(words.quiet, ['follow', 'sheet']);
		assert.deepEqual(frontWords(rail, PRESEASON, true).quiet, ['open_league', 'sheet']);
	});
}

void test('the board in season takes the rail word for its bar, and the rest of the season for its heading', () => {
	const rest = railOfKey('in_season').find((item) => item.key === 'rest')?.label;
	const words = boardWords('in_season', { ...REST, position: null }, false);
	assert.equal(words.bar, rest);
	assert.equal(words.bar, 'Rest of season');
	assert.equal(words.heading, 'Rest of 2026');
	assert.equal(words.title, 'PPR rest of season');
	assert.equal(words.verb, 'follow');
	const wr = boardWords('playoffs', { ...REST, position: 'WR' }, true);
	assert.equal(wr.bar, 'WR rest of season');
	assert.equal(wr.title, 'WR PPR rest of season');
	assert.equal(wr.verb, 'open_league');
});

void test('the board before the draft and after the season keeps its name and the mock draft', () => {
	for (const rail of BEFORE_OR_AFTER) {
		const words = boardWords(rail, { ...PRESEASON, position: null }, false);
		assert.equal(words.bar, 'Board');
		assert.equal(words.heading, '2026 Board');
		assert.equal(words.title, 'PPR Board');
		assert.equal(words.verb, 'mock');
	}
	assert.equal(boardWords('pre_draft', { ...PRESEASON, position: 'RB' }, false).bar, 'RB Board');
});

void test('in season on a board that still ranks the full season, the heading stays the season board', () => {
	assert.equal(
		boardWords('in_season', { ...PRESEASON, position: null }, false).heading,
		'2026 Board'
	);
});

void test('every word keeps the copy rules', () => {
	for (const rail of RAIL_KEYS) {
		for (const board of [REST, PRESEASON]) {
			const front = frontWords(rail, board, false);
			clean(front.title);
			clean(front.heading);
			const boardPage = boardWords(rail, { ...board, position: 'TE' }, false);
			clean(boardPage.bar);
			clean(boardPage.heading);
		}
	}
	for (const verb of Object.values(PAGE_VERBS)) clean(verb);
});
