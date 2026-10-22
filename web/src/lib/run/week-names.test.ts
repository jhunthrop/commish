// The Players page's one name in season (Lane 142, ruling 1): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { RAIL_KEYS, railInSeason } from '#lib/ui/nav.ts';
import { railShown } from '#lib/ui/rail-order.ts';
import { siteRailAt } from './site-season.ts';
import { PAGE_NAME_WORDS, playersCrumb, railItemLabel, weekNames } from './week-names.ts';

/** A season's kickoffs as the run's schedule carries them: week 1's Thursday, then the last game. */
const KICKOFFS = [
	'2026-09-11T00:20:00.000Z',
	'2026-10-23T00:15:00.000Z',
	'2027-01-10T21:25:00.000Z'
];
/** The page's clock at each point of the year. */
const CLOCK = {
	preseason: new Date('2026-08-20T12:00:00.000Z'),
	week7: new Date('2026-10-22T12:00:00.000Z'),
	offseason: new Date('2027-04-01T12:00:00.000Z')
};
const WEEK = 7;

/** The names at a clock, the way the layout and the front card build them. */
const namesAt = (now: Date, week: number | undefined) => weekNames(siteRailAt(now, KICKOFFS), week);

void test('in season the page is the week rankings, its rank head the week rank', () => {
	assert.deepEqual(namesAt(CLOCK.week7, WEEK), {
		rankings: 'Week 7 rankings',
		rank: 'Week 7 rank'
	});
	assert.equal(playersCrumb('Week 7 rankings'), 'Players / Week 7 rankings');
});

void test('before and after the season the page stays Players, whatever week the run names', () => {
	assert.equal(namesAt(CLOCK.preseason, WEEK), null);
	assert.equal(namesAt(CLOCK.offseason, WEEK), null);
	assert.equal(playersCrumb(undefined), PAGE_NAME_WORDS.players);
	// A run that ranks from no week names none, even in season.
	assert.equal(namesAt(CLOCK.week7, undefined), null);
});

void test('every season rail, a league followed or not, draws the week item and no Players item', () => {
	for (const key of RAIL_KEYS) {
		for (const league of [true, false]) {
			const keys = railShown(key, league).map((item) => item.key);
			if (railInSeason(key)) {
				assert.ok(keys.includes('week'), `${key} ${String(league)}`);
				assert.ok(!keys.includes('players'), `${key} ${String(league)}`);
			} else {
				assert.ok(keys.includes('players'), `${key} ${String(league)}`);
				assert.ok(!keys.includes('week'), `${key} ${String(league)}`);
			}
		}
	}
	// The followed league's rail names the week as the page heads it, never with Lineup's glyph.
	const followed = railShown('in_season', true);
	const week = followed.find((item) => item.key === 'week');
	assert.ok(week);
	assert.equal(railItemLabel(week, WEEK), 'Week 7 rankings');
	assert.equal(week.icon, 'players');
	assert.ok(!followed.some((item) => item.key !== 'lineup' && item.icon === 'lineup'));
});

void test('the names are clean copy', () => {
	for (const words of [
		PAGE_NAME_WORDS.players,
		PAGE_NAME_WORDS.rankings(WEEK),
		PAGE_NAME_WORDS.rank(WEEK),
		playersCrumb(PAGE_NAME_WORDS.rankings(WEEK))
	]) {
		assert.doesNotMatch(words, bannedPattern(), words);
		assert.doesNotMatch(words, /—/u, words);
	}
});
