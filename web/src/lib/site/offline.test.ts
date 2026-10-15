// What the service worker answers, and what it never keeps. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OFFLINE_PATH, SHELL_CACHE_PREFIX, answersOffline, isStaleCache } from './offline.ts';

const SITE = 'https://trycommish.app';

function request(url: string, init: { method?: string; mode?: RequestMode } = {}) {
	return { url, method: init.method ?? 'GET', mode: init.mode ?? 'navigate' };
}

void test('a page opened on the site falls back to the offline page', () => {
	assert.equal(answersOffline(request(`${SITE}/board`), SITE), true);
	assert.equal(answersOffline(request(`${SITE}/account`), SITE), true);
});

void test('nothing but a same-origin page load is answered: no API call, no asset, no form post', () => {
	assert.equal(answersOffline(request('https://api.trycommish.app/me'), SITE), false);
	assert.equal(answersOffline(request(`${SITE}/data/index.json`, { mode: 'cors' }), SITE), false);
	assert.equal(answersOffline(request(`${SITE}/account`, { method: 'POST' }), SITE), false);
});

void test('the offline page itself is never answered with itself', () => {
	assert.equal(answersOffline(request(`${SITE}${OFFLINE_PATH}`), SITE), false);
});

void test("an earlier deploy's shell cache is dropped, nothing else's", () => {
	assert.equal(isStaleCache(`${SHELL_CACHE_PREFIX}1`, `${SHELL_CACHE_PREFIX}2`), true);
	assert.equal(isStaleCache(`${SHELL_CACHE_PREFIX}2`, `${SHELL_CACHE_PREFIX}2`), false);
	assert.equal(isStaleCache('someone-else', `${SHELL_CACHE_PREFIX}2`), false);
});
