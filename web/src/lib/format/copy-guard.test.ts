// The site's one copy guard (Lane 66q): one list of banned words and marks, the betting register a
// source scan reads drawn from it, and a guard's own words composed with it, never a second list. Run
// with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANNED_MARKS, BANNED_WORDS, BETTING_WORDS, bannedIn } from './copy-guard.ts';

void test('the list holds the betting, trading and platform words, whole words in any case', () => {
	for (const word of ['Odds', 'line', 'totals', 'over/under', 'Market', 'buy', 'hosts', 'Vegas'])
		assert.match(word, BANNED_WORDS, word);
	for (const word of ['Offline', 'Points', 'hostile', 'buyer'])
		assert.doesNotMatch(word, BANNED_WORDS);
	assert.match('a — b', BANNED_MARKS);
	assert.match('a; b', BANNED_MARKS);
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
	assert.equal(bannedIn('his stock rises'), null);
	assert.equal(bannedIn('his stock rises', /\bstock\b/i), 'stock');
});
