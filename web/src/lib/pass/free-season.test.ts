// The free season's clock rule and the API's optional flag (Lane 150, ruling 3). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedIn } from '#lib/format/copy-guard.ts';
import { LEAGUE_HOSTS } from '#lib/league/hosts.ts';
import { hostWords } from '#lib/league/names.ts';
import { FREE_SEASON_ENDS, freeSeasonAt, freeSeasonFlag, readFreeSeason } from './free-season.ts';
import { ALWAYS_FREE, FREE_WORDS, freeLine, freeSeasonLines } from './words.ts';

const WEEK_7 = new Date('2026-10-22T16:00:00Z');
const ENDS = new Date(FREE_SEASON_ENDS);
const ALL_OPEN = { ffpc: true, yahoo: true, espn: true };

void test('the season is free to its end, the end itself not', () => {
	assert.equal(freeSeasonAt(WEEK_7), true);
	assert.equal(freeSeasonAt(new Date(ENDS.getTime() - 1)), true);
	assert.equal(freeSeasonAt(ENDS), false);
});

void test("the API's flag wins either way, and the clock rule speaks only while it is absent (fix round 1)", () => {
	// The founder ends the free season from the one setting: false before the boundary is not free.
	assert.equal(freeSeasonAt(WEEK_7, false), false);
	// And a season the founder extends: true after the boundary is free.
	assert.equal(freeSeasonAt(ENDS, true), true);
	// Absent, an API before Lane 149: the clock.
	assert.equal(freeSeasonAt(WEEK_7, undefined), true);
	assert.equal(freeSeasonAt(ENDS, undefined), false);
});

void test('the page and the account page read the flag through one function, the clock on a failed read', async () => {
	assert.equal(await readFreeSeason(() => Promise.resolve({ free_season: false }), WEEK_7), false);
	assert.equal(await readFreeSeason(() => Promise.resolve({ free_season: true }), ENDS), true);
	assert.equal(await readFreeSeason(() => Promise.resolve({ season: 2027 }), WEEK_7), true);
	assert.equal(await readFreeSeason(() => Promise.reject(new Error('down')), WEEK_7), true);
	assert.equal(await readFreeSeason(() => Promise.reject(new Error('down')), ENDS), false);
});

void test('the not-free state says what stays free and promises no price', () => {
	assert.equal(FREE_WORDS.always.title, 'Free on Commish');
	assert.equal(
		FREE_WORDS.always.lead,
		'The board, every player, our record, mock drafts and your cheat sheet are free for every account.'
	);
	assert.deepEqual(
		ALWAYS_FREE.map((line) => line.lead),
		[
			'The board',
			'Every player',
			'ADP and our record',
			'Mock drafts',
			'Your cheat sheet',
			'One league'
		]
	);
	for (const words of [
		...Object.values(FREE_WORDS.always),
		...ALWAYS_FREE.flatMap((line) => [line.lead, line.text])
	])
		assert.doesNotMatch(
			words,
			/\$|\bprices?\b|\bpaid\b|Draft Pass|Membership|checkout|\blater\b/i,
			words
		);
});

void test('the flag is read only when present and a boolean, so an API before Lane 149 parses', () => {
	assert.equal(freeSeasonFlag({ season: 2027, checkout_open: false }), undefined);
	assert.equal(freeSeasonFlag({ free_season: true }), true);
	assert.equal(freeSeasonFlag({ free_season: false }), false);
	assert.equal(freeSeasonFlag({ free_season: 'yes' }), undefined);
	assert.equal(freeSeasonFlag(null), undefined);
});

void test("the free season's list leads with every league, named from the platforms module", () => {
	const lines = freeSeasonLines(ALL_OPEN);
	assert.deepEqual(
		lines.map((line) => line.lead),
		[
			'Every league you play in',
			"Your league's exact scoring",
			'Your lineup, waivers and trades',
			"The week's rankings",
			'Our call in your real draft',
			'The board',
			'Every player',
			'ADP and our record',
			'Mock drafts',
			'Your cheat sheet'
		]
	);
	const leagues = lines[0]?.text ?? '';
	for (const host of LEAGUE_HOSTS) assert.ok(leagues.includes(hostWords(host)), host);
	// A platform whose switch is shut here is never promised.
	assert.doesNotMatch(
		freeSeasonLines({ ffpc: false, yahoo: false, espn: true })[0]?.text ?? '',
		/FFPC|Yahoo/
	);
});

void test('every word on the free page passes the copy guard and names no price or product', () => {
	const said = [
		...Object.values(FREE_WORDS.season),
		...Object.values(FREE_WORDS.always),
		FREE_WORDS.note,
		FREE_WORDS.signIn,
		FREE_WORDS.follow,
		FREE_WORDS.later,
		freeLine(),
		...[...freeSeasonLines(ALL_OPEN), ...ALWAYS_FREE].flatMap((line) => [line.lead, line.text])
	];
	for (const words of said) {
		assert.equal(bannedIn(words), null, words);
		assert.doesNotMatch(words, /\$|Draft Pass|Membership|checkout|subscri|upgrade/i, words);
	}
	assert.equal(
		FREE_WORDS.season.lead,
		'Every tool on Commish is free through the 2026 season, for every account.'
	);
	assert.equal(
		freeLine(),
		'The board, every player, ADP and our record, mock drafts and your cheat sheet stay free.'
	);
});
