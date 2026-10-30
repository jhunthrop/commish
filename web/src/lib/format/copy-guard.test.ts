// The site's one copy guard (Lane 66q): one list of banned words and marks, the betting register a
// source scan reads drawn from it, and a guard's own words composed with it, never a second list. Run
// with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import LIST_FILE from '../../../../shared/words/banned-words.json' with { type: 'json' };
import {
	BANNED_LIST,
	BANNED_MARKS,
	BANNED_WORDS,
	BETTING_WORDS,
	bannedIn,
	bannedInCopy,
	dataStrings,
	frameData
} from './copy-guard.ts';

const LIST_EXAMPLES = LIST_FILE.examples;

void test('the list holds the betting, trading and platform words, whole words in any case', () => {
	for (const word of ['Odds', 'line', 'totals', 'over/under', 'Market', 'buy', 'hosts', 'Vegas'])
		assert.match(word, BANNED_WORDS, word);
	for (const word of ['Offline', 'Points', 'hostile', 'buyer'])
		assert.doesNotMatch(word, BANNED_WORDS);
	assert.match('a — b', BANNED_MARKS);
	assert.match('a; b', BANNED_MARKS);
	assert.match('a – b', BANNED_MARKS);
});

void test("the guard reads the one list file the writer reads too, every word it shows caught (the sweep's C7)", () => {
	const shown = [
		...Object.values(BANNED_LIST.bettingOnly),
		...Object.values(BANNED_LIST.bettingShared),
		BANNED_LIST.line.shown,
		...Object.values(BANNED_LIST.trading),
		...Object.values(BANNED_LIST.platform)
	];
	for (const word of shown) assert.equal(bannedIn(`We ${word} him.`), word, word);
	for (const mark of BANNED_LIST.marks) assert.equal(bannedIn(`a ${mark} b`), mark, mark);
	assert.equal(bannedIn('15 total touchdowns'), 'total');
	assert.equal(bannedIn('holding this line'), 'line');
	assert.equal(bannedIn('behind the offensive line, inside the goal line, on the O-line'), null);
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

/** An API answer as a page is handed it: names under their name fields, copy under every other. */
const ANSWER = {
	headline: 'Connect your host',
	chips: [{ label: 'Buy low now' }, { label: 'Sell high' }],
	caption: 'Bet on him',
	note: 'Fade the line',
	players: [
		{ name: 'Jadarian Price', first_name: 'Jadarian', last_name: 'Price' },
		{ name: 'Marvin Price Jr.' }
	],
	clubs: [{ city: 'Las Vegas', nickname: 'Raiders', name: 'Las Vegas Raiders' }],
	teams: [{ team_name: 'Odds Are We Lose Again Tonight!' }]
};

void test('the guard scans copy, not data: only the name fields are data, by field not by shape (ruling R3)', () => {
	const data = dataStrings(ANSWER);
	for (const name of [
		'Jadarian Price',
		'Marvin Price Jr.',
		'Las Vegas Raiders',
		'Odds Are We Lose Again Tonight!'
	])
		assert.ok(data.has(name), name);
	// Short copy an answer carries under any other field is never data, whatever its shape.
	for (const [said, word] of [
		['Connect your host', 'host'],
		['Buy low now', 'Buy'],
		['Sell high', 'Sell'],
		['Bet on him', 'Bet'],
		['Fade the line', 'line']
	] as const) {
		assert.ok(!data.has(said), said);
		assert.equal(bannedInCopy(said, data), word, said);
	}
	assert.equal(
		bannedInCopy(
			'Jadarian Price, RB, Las Vegas Raiders. Marvin Price Jr. Odds Are We Lose Again Tonight! Proj 12.4',
			data
		),
		null
	);
	// A name field that is only a banned word excuses nothing: "Price" alone is still caught.
	assert.equal(bannedInCopy('Price is a reach here', data), 'Price');
	assert.equal(bannedInCopy('Totals 104.2', data), 'Totals');
	assert.equal(bannedInCopy('Jadarian Price; Proj 12.4', data), ';');
	assert.equal(bannedInCopy('his value rises', data, /\bvalue\b/i), 'value');
});

void test("the field's own lines are football, not a betting line: goal line, offensive line, line of scrimmage", () => {
	for (const said of [
		'not close to the goal line',
		'a goal-line back',
		'behind a weak offensive line',
		'the defensive line',
		'the O-line held',
		'past the line of scrimmage',
		// Lane 303: lining up is football too.
		'whoever lines up opposite him',
		'Line up a fill-in',
		'he lined up in the slot'
	])
		assert.equal(bannedIn(said), null, said);
	for (const said of [
		'the line moved',
		'The line',
		'his stat lines',
		'a betting line',
		'the line upset bettors'
	])
		assert.notEqual(bannedIn(said), null, said);
});

void test('data strings come from name fields at any depth, numbers and other fields left out', () => {
	assert.deepEqual(
		[
			...dataStrings([
				{ name: 'Las Vegas Raiders', n: 3, nested: [[{ team_name: 'Ja Price' }]] },
				null,
				'Done.',
				{ title: 'Sell now' }
			])
		],
		['Las Vegas Raiders', 'Ja Price']
	);
});

void test("the room's socket frames are data by their fields, as an answer is (the sweep's C8)", () => {
	const frame = JSON.stringify({
		type: 'update',
		state: { picks: [{ handle: 'helperA', player: { name: 'Jadarian Price', position: 'RB' } }] }
	});
	const data = frameData(frame);
	assert.deepEqual([...data].sort(), ['Jadarian Price', 'helperA']);
	assert.equal(bannedInCopy('Jadarian Price, RB, taken by helperA', data), null);
	assert.equal(bannedInCopy('Price drops', data), 'Price');
	assert.equal(frameData('not json').size, 0);
});

void test("the list's own examples: the site catches each caught one and spares each spared one, as the writer does", () => {
	for (const text of LIST_EXAMPLES.caught) assert.notEqual(bannedIn(text), null, text);
	for (const text of LIST_EXAMPLES.spared) assert.equal(bannedIn(text), null, text);
});
