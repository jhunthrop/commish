// The kickers' and defenses' tabs' head in season (Lane 66w): this week's, never the rest of the
// season. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardWords } from '#lib/site/season-words.ts';
import type { RailKey } from '#lib/ui/nav.ts';
import { weekBoardWords, weekHeading, weekPositionOf } from './week-head.ts';

const REST = { season: 2026, rosFromWeek: 6, label: 'PPR' };
const PRESEASON = { season: 2026, label: 'PPR' };

function words(rail: RailKey, board: typeof PRESEASON, position: string | null) {
	const asked = { ...board, position };
	return weekBoardWords(boardWords(rail, asked, false), rail, asked);
}

void test("in season the kickers' and defenses' tabs are this week's, never the rest of the season", () => {
	for (const board of [REST, PRESEASON]) {
		const k = words('in_season', board, 'K');
		assert.equal(k.heading, "This week's kickers");
		assert.equal(k.bar, 'K this week');
		assert.equal(k.title, 'K PPR this week');
		assert.equal(k.verb, 'follow');
		const dst = words('playoffs', board, 'DST');
		assert.equal(dst.heading, "This week's defenses");
		assert.equal(dst.bar, 'DST this week');
		for (const said of [k, dst]) {
			assert.doesNotMatch(`${said.heading} ${said.bar} ${said.title}`, /[Rr]est of|[–—;]/);
		}
	}
});

void test('every other tab, and the tabs out of season, keep the board words', () => {
	assert.deepEqual(
		words('in_season', REST, 'RB'),
		boardWords('in_season', { ...REST, position: 'RB' }, false)
	);
	assert.equal(words('pre_draft', PRESEASON, 'K').heading, '2026 Board');
	assert.equal(words('offseason', PRESEASON, 'DST').bar, 'DST Board');
});

void test('the head once the week is read, and the positions', () => {
	assert.equal(weekHeading('K', 6), 'Week 6 kickers');
	assert.equal(weekHeading('DEF', null), "This week's defenses");
	assert.equal(weekPositionOf('DST'), 'DEF');
	assert.equal(weekPositionOf('WR'), null);
});
