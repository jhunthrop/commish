// The signed-out account page's words: five hosts named, the connect verbs, the copy guard. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEAGUE_HOSTS_LINE } from '#lib/league/hosts.ts';
import { KEEPS, MEMBER_HOSTS } from './keeps.ts';

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

void test('connecting ESPN is for any ESPN league and says what the session is kept for', () => {
	const espn = MEMBER_HOSTS.find((h) => h.lead === 'ESPN')?.text ?? '';
	assert.match(espn, /public or private/);
	assert.match(espn, /so your league stays in sync and, when you ask, to make your moves\./);
	assert.doesNotMatch(espn, /a private ESPN league/);
});

void test('the copy has no em-dash, no semicolon, no doubled word and no trading words', () => {
	for (const words of WORDS) {
		assert.doesNotMatch(words, /[—;]/, words);
		assert.doesNotMatch(words, /\b([a-z]+)\s+\1\b/i, words);
		assert.doesNotMatch(words, /\b(market|price|buy|sell)\b/i, words);
	}
});
