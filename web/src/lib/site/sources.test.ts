// Where the numbers come from: each feed's credit and the copy guard. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	CC_BY_4,
	CC_BY_SA_4,
	DATA_PAGE_TITLE,
	RECURRING_FEEDS,
	SOURCES,
	SOURCES_LEAD,
	SOURCES_TITLE,
	sourceSentence,
	type Source
} from './sources.ts';

const SENTENCES = SOURCES.map(sourceSentence);

/** The research package's own list of recurring feeds: the first cell of each row of its table. */
function documentedFeeds(): string[] {
	const doc = readFileSync(
		new URL('../../../../docs/research/data-sources.md', import.meta.url),
		'utf8'
	);
	const table = doc.split('## Recurring feeds')[1]?.split('\n## ')[0] ?? '';
	return table
		.split('\n')
		.filter((line) => line.startsWith('| ') && !line.startsWith('| Feed'))
		.map((line) => (line.split('|')[1] ?? '').replaceAll('**', '').trim());
}

/** A betting word in a credit (the coordinator's ruling of 2026-10-15): the vendor's proper name
 * is fine, the common nouns never, and "lines" only as stat lines. */
const BETTING =
	/\b(props?|bets?|betting|wagers?|sportsbooks?|vegas)\b|\bodds\b(?! API)|(?<!stat )\blines?\b/i;

/** The words the site never uses: the trading register (founder ruling 2026-09-07). */
const TRADING = /\b(market|prices?|priced|buy|buys|buying|sell|sells|selling|stock|assets?)\b/i;

void test('each credit is the one its publisher asks for', () => {
	const credits = SOURCES.map((source) => source.credit);
	assert.ok(credits.includes('nflverse'));
	// nflverse's note on FTN's charting: "attribution must be made to FTN Data via nflverse".
	assert.ok(credits.includes('FTN Data via nflverse'));
	assert.ok(credits.includes('the NFL via nflverse'));
	assert.ok(credits.includes('Pro Football Reference via nflverse'));
	assert.ok(credits.includes('Fantasy Football Calculator'));
	assert.ok(credits.some((credit) => credit.includes('Tank01')));
});

void test("the registry is the data-sources doc's recurring feeds, each credited on the page once", () => {
	assert.deepEqual([...RECURRING_FEEDS].sort(), documentedFeeds().sort());
	const credited = SOURCES.flatMap((source) => source.feeds);
	for (const feed of RECURRING_FEEDS) {
		assert.equal(credited.filter((each) => each === feed).length, 1, feed);
	}
});

void test("the board's season win expectations and player expectations are credited in fantasy words", () => {
	const sentence = (credit: string): string => {
		const source = SOURCES.find((each) => each.credit === credit);
		assert.ok(source, credit);
		return sourceSentence(source);
	};
	assert.match(sentence('nfelo'), /season win expectation that the board reads/);
	assert.match(sentence('The Odds API'), /consensus expectations for each player/);
	for (const words of SENTENCES) assert.doesNotMatch(words, BETTING, words);
	assert.match('Player props from a book', BETTING);
	assert.match('the odds he scores', BETTING);
	assert.doesNotMatch('from The Odds API.', BETTING);
});

void test('a licence is named and linked where the feed has one, with the note that we changed it', () => {
	const find = (credit: string): Source => {
		const source = SOURCES.find((each) => each.credit === credit);
		assert.ok(source, credit);
		return source;
	};
	const nflverse = find('nflverse');
	const ftn = find('FTN Data via nflverse');
	assert.deepEqual(nflverse.licence, CC_BY_4);
	assert.deepEqual(ftn.licence, CC_BY_SA_4);
	assert.equal(CC_BY_4.href, 'https://creativecommons.org/licenses/by/4.0/');
	assert.equal(CC_BY_SA_4.href, 'https://creativecommons.org/licenses/by-sa/4.0/');
	const changed = /licence, and our rates are worked out from their counts\.$/;
	assert.match(sourceSentence(nflverse), /shared under the CC BY 4\.0 licence/);
	assert.match(sourceSentence(nflverse), changed);
	assert.match(sourceSentence(ftn), /shared under the CC BY-SA 4\.0 licence/);
	assert.match(sourceSentence(ftn), changed);
	// A licensed feed always says it was changed, and a feed with no licence names none.
	for (const source of SOURCES) {
		assert.equal(source.modified === true, source.licence !== undefined, source.credit);
	}
	assert.doesNotMatch(sourceSentence(find('the NFL via nflverse')), /licence/);
});

void test("every credit links to its publisher's page over https, each publisher once", () => {
	const hrefs = SOURCES.map((source) => source.href);
	for (const href of hrefs) assert.match(href, /^https:\/\/[a-z0-9.-]+\.[a-z]+/, href);
	assert.equal(new Set(hrefs).size, hrefs.length);
});

void test('copy guard: one sentence each, with no dash, semicolon, doubled word, trading word or tip', () => {
	for (const words of [DATA_PAGE_TITLE, SOURCES_TITLE, SOURCES_LEAD, ...SENTENCES]) {
		assert.doesNotMatch(words, /[–—;]/, words);
		assert.doesNotMatch(words, /\b([a-z]+)\s+\1\b/i, words);
		assert.doesNotMatch(words, TRADING, words);
		assert.doesNotMatch(words, /\b(tip|note that|keep in mind)\b/i, words);
	}
	for (const sentence of SENTENCES) {
		assert.match(sentence, /^[A-Z].*\.$/, sentence);
		assert.doesNotMatch(sentence, /[.!?]\s/, sentence);
	}
});
