// The Players page's one name in season (Lane 142, ruling 1): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { PAGE_PURPOSE, playersLead } from '#lib/order/words.ts';
import { HELD_WEEK_LABEL, RAIL_KEYS, railInSeason } from '#lib/ui/nav.ts';
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

void test('in season the page is Rankings, the week in its head and never in its name (Lane 164, D11)', () => {
	assert.deepEqual(namesAt(CLOCK.week7, WEEK), { rankings: 'Rankings' });
	assert.equal(playersCrumb('Rankings'), 'Players / Rankings');
	// The head says whose order it is and where the week sits.
	assert.equal(
		PAGE_PURPOSE.rankings(WEEK),
		"Our rest-of-season order, with week 7's game beside each player"
	);
	assert.doesNotMatch(PAGE_NAME_WORDS.rankings, /\d|week/iu);
});

void test('the three states by the clock: Players before the season, Rankings in it, Players the Tuesday after the last game', () => {
	const tuesdayAfterLastGame = new Date('2027-01-12T12:00:00.000Z');
	const nameAt = (now: Date) => namesAt(now, WEEK)?.rankings ?? PAGE_NAME_WORDS.players;
	assert.equal(nameAt(CLOCK.preseason), 'Players');
	assert.equal(nameAt(CLOCK.week7), 'Rankings');
	assert.equal(nameAt(tuesdayAfterLastGame), 'Players');
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
	assert.equal(railItemLabel(week, WEEK), 'Rankings');
	assert.equal(week.icon, 'players');
	assert.ok(!followed.some((item) => item.key !== 'lineup' && item.icon === 'lineup'));
});

void test('a league drafted before week 1 sits on the in-season rail, its week item Players, the page it opens (fix round 1)', () => {
	// The league's phase puts it on the in-season rail while the site's clock is before the first kickoff.
	const names = namesAt(CLOCK.preseason, WEEK);
	assert.equal(names, null);
	const week = railShown('in_season', true).find((item) => item.key === 'week');
	assert.ok(week);
	// No week is named, so the shell draws the item with none.
	const label = railItemLabel(week, null);
	assert.equal(label, PAGE_NAME_WORDS.players);
	// The page it opens heads and crumbs the same name.
	assert.equal(playersCrumb(undefined), label);
	// The first kickoff's instant names the week.
	const kickoff = new Date(KICKOFFS[0] ?? '');
	assert.equal(namesAt(kickoff, 1)?.rankings, 'Rankings');
});

void test('the season ends with the last regular-season game, never the NFL postseason (Lane 143, B126)', () => {
	// The last game day, the evening after its last kickoff on the Eastern clock: week 18 is still ranked.
	const lastGameEvening = new Date('2027-01-11T03:30:00.000Z');
	assert.equal(namesAt(lastGameEvening, 18)?.rankings, 'Rankings');
	// The first instant after the last game day is the NFL's postseason: the page is Players again,
	// whatever week the run still carries.
	const postseason = new Date('2027-01-11T05:00:00.000Z');
	assert.equal(siteRailAt(postseason, KICKOFFS), 'playoffs');
	assert.equal(namesAt(postseason, 18), null);
	assert.equal(namesAt(new Date('2027-01-20T12:00:00.000Z'), 18), null);
	// The site's postseason rail still draws the week item, labelled the page it opens.
	const week = railShown('playoffs', false).find((item) => item.key === 'week');
	assert.ok(week);
	assert.equal(railItemLabel(week, null), PAGE_NAME_WORDS.players);
	assert.equal(playersCrumb(undefined), PAGE_NAME_WORDS.players);
});

void test('the held label is the longer of its two names, so its room holds either (Lane 143 fix round 1)', () => {
	const forms = [PAGE_NAME_WORDS.players, PAGE_NAME_WORDS.rankings];
	assert.equal(HELD_WEEK_LABEL.length, Math.max(...forms.map((form) => form.length)));
	assert.ok(forms.includes(HELD_WEEK_LABEL));
	// Each is one word, so the label wraps nowhere at any rail width.
	for (const form of forms) assert.ok(!form.includes(' '), form);
});

void test('the names are clean copy', () => {
	for (const words of [
		PAGE_NAME_WORDS.players,
		PAGE_NAME_WORDS.rankings,
		PAGE_PURPOSE.rankings(WEEK),
		playersCrumb(PAGE_NAME_WORDS.rankings)
	]) {
		assert.doesNotMatch(words, bannedPattern(), words);
		assert.doesNotMatch(words, /—/u, words);
	}
});

void test('the head sentence follows the clock state, the chip and the board week the table shows (Lane 164)', () => {
	const tuesdayAfterLastGame = new Date('2027-01-12T12:00:00.000Z');
	const inSeasonAt = (now: Date) => namesAt(now, WEEK) !== null;
	const lead = (now: Date, onWeekChip: boolean, boardWeek: number | null) =>
		playersLead(inSeasonAt(now), onWeekChip, boardWeek);
	// In season on our order's chips: the board week the table shows, named once.
	assert.equal(lead(CLOCK.week7, false, 7), PAGE_PURPOSE.rankings(7));
	assert.equal(lead(CLOCK.week7, false, 8), PAGE_PURPOSE.rankings(8));
	// The K and D/ST chips keep their own basis line only.
	assert.equal(lead(CLOCK.week7, true, 7), undefined);
	// Before the season and the Tuesday after the last game: the page's purpose, no week named.
	assert.equal(lead(CLOCK.preseason, false, 7), PAGE_PURPOSE.players);
	assert.equal(lead(tuesdayAfterLastGame, false, 7), PAGE_PURPOSE.players);
});
