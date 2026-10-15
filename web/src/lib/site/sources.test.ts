// Where the numbers come from: each feed's credit and the copy guard. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DATA_PAGE_TITLE,
	SOURCES,
	SOURCES_LEAD,
	SOURCES_TITLE,
	sourceSentence
} from './sources.ts';

const SENTENCES = SOURCES.map(sourceSentence);

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

void test('a licence is named where the feed has one', () => {
	const sentence = (credit: string): string => {
		const source = SOURCES.find((each) => each.credit === credit);
		assert.ok(source, credit);
		return sourceSentence(source);
	};
	assert.match(sentence('nflverse'), /CC BY 4\.0 licence/);
	assert.match(sentence('FTN Data via nflverse'), /CC BY-SA 4\.0 licence/);
	assert.doesNotMatch(sentence('the NFL via nflverse'), /licence/);
});

void test("every credit links to its publisher's page over https, each once", () => {
	for (const { href } of SOURCES) assert.match(href, /^https:\/\/[a-z0-9.-]+\.[a-z]+/, href);
	assert.equal(new Set(SOURCES.map((source) => source.href)).size, SOURCES.length);
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
