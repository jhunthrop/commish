// The site's one copy guard (Lane 66q): one list of banned words and marks, the betting register a
// source scan reads drawn from it, and a guard's own words composed with it, never a second list. Run
// with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BANNED_MARKS,
	BANNED_WORDS,
	BETTING_WORDS,
	bannedIn,
	bannedInCopy,
	dataStrings
} from './copy-guard.ts';

void test('the list holds the betting, trading and platform words, whole words in any case', () => {
	for (const word of ['Odds', 'line', 'totals', 'over/under', 'Market', 'buy', 'hosts', 'Vegas'])
		assert.match(word, BANNED_WORDS, word);
	for (const word of ['Offline', 'Points', 'hostile', 'buyer'])
		assert.doesNotMatch(word, BANNED_WORDS);
	assert.match('a — b', BANNED_MARKS);
	assert.match('a; b', BANNED_MARKS);
	assert.match('a – b', BANNED_MARKS);
});

void test("the trading inflections and the betting register's other words are on the one list (review 66q 1)", () => {
	for (const word of [
		'stock',
		'buys',
		'buying',
		'sells',
		'selling',
		'priced',
		'books',
		'props',
		'moneyline'
	])
		assert.match(`his ${word} here`, BANNED_WORDS, word);
	// Code says $props and a source file may say "book", so neither is in the source scan's register.
	assert.doesNotMatch('let props = $props();', BETTING_WORDS);
	assert.match('the moneyline', BETTING_WORDS);
});

void test('the betting register a source scan reads is the list without the words code says too', () => {
	for (const word of ['odds', 'wagers', 'sportsbook', 'favourite', 'underdog']) {
		assert.match(word, BETTING_WORDS, word);
		assert.match(word, BANNED_WORDS, word);
	}
	for (const word of ['lines', 'total', 'price', 'host']) assert.doesNotMatch(word, BETTING_WORDS);
});

void test('bannedIn names the first banned word or mark, a guard composing its own words', () => {
	assert.equal(bannedIn('Our rest-of-season order from week 7.'), null);
	assert.equal(bannedIn('He is favored by 3'), 'favored');
	assert.equal(bannedIn('one; two'), ';');
	assert.equal(bannedIn('his value rises'), null);
	assert.equal(bannedIn('his value rises', /\bvalue\b/i), 'value');
});

void test('the guard scans copy, not data: a name the page was handed is skipped, a sentence never (ruling R3)', () => {
	const data = dataStrings({
		players: [{ name: 'Jadarian Price', team: 'Las Vegas Raiders' }],
		heads: ['Totals'],
		basis: 'Our board reads the spreads.'
	});
	assert.ok(data.has('Jadarian Price'));
	assert.ok(data.has('Las Vegas Raiders'));
	// A sentence the API wrote is copy, so it is never data.
	assert.ok(!data.has('Our board reads the spreads.'));
	// A run's phrase is copy too, stop or none: more words than a name carries.
	const phrase = "the average of its opponents' published season win totals";
	assert.ok(!dataStrings({ method: phrase }).has(phrase));
	assert.ok(dataStrings({ team: 'Keeper? I Hardly Know Her' }).has('Keeper? I Hardly Know Her'));
	assert.equal(bannedInCopy('Jadarian Price, RB, Las Vegas Raiders. Proj 12.4', data), null);
	// A data string that is only a banned word excuses nothing: "Totals" as a head is still caught.
	assert.equal(bannedInCopy('Totals 104.2', data), 'Totals');
	assert.equal(bannedInCopy('Price is a reach here', data), 'Price');
	assert.equal(bannedInCopy('Our board reads the spreads.', data), 'spreads');
	assert.equal(bannedInCopy('Jadarian Price; Proj 12.4', data), ';');
	assert.equal(bannedInCopy('his value rises', data, /\bvalue\b/i), 'value');
});

void test("the field's own lines are football, not a betting line: goal line, offensive line, line of scrimmage", () => {
	for (const said of [
		'not close to the goal line',
		'behind a weak offensive line',
		'the defensive line',
		'past the line of scrimmage'
	])
		assert.equal(bannedIn(said), null, said);
	for (const said of ['the line moved', 'his stat lines', 'a betting line'])
		assert.notEqual(bannedIn(said), null, said);
});

void test('data strings come from any JSON, nested in arrays and objects, numbers and keys left out', () => {
	assert.deepEqual(
		[...dataStrings([{ a: 'Las Vegas Raiders', n: 3, nested: [['Ja Price']] }, null, 'Done.'])],
		['Las Vegas Raiders', 'Ja Price']
	);
});
