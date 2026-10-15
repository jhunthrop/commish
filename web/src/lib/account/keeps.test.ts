// The signed-out account page's words: five hosts named, the connect verbs, the copy guard. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEEPS, LEAGUE_HOSTS_LINE, MEMBER_HOSTS } from './keeps.ts';

const WORDS = [
	...KEEPS.flatMap((k) => [k.lead, k.text]),
	...MEMBER_HOSTS.flatMap((h) => [h.lead, h.text, h.verb])
];

void test('the leagues line names all five hosts', () => {
	for (const host of ['Sleeper', 'MyFantasyLeague', 'FFPC', 'Yahoo', 'ESPN']) {
		assert.ok(LEAGUE_HOSTS_LINE.includes(host), host);
	}
	assert.ok(KEEPS.some((k) => k.text.includes(LEAGUE_HOSTS_LINE)));
});

void test('a connect verb for Yahoo and for ESPN', () => {
	assert.deepEqual(
		MEMBER_HOSTS.map((h) => h.verb),
		['Connect Yahoo', 'Connect ESPN']
	);
});

void test('the copy has no em-dash, no semicolon, no doubled word and no trading words', () => {
	for (const words of WORDS) {
		assert.doesNotMatch(words, /[—;]/, words);
		assert.doesNotMatch(words, /\b([a-z]+)\s+\1\b/i, words);
		assert.doesNotMatch(words, /\b(market|price|buy|sell)\b/i, words);
	}
});
