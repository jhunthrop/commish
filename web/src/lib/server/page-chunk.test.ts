// Every page's HTML as the hooks finish it: the boot scripts, the head and the rail sprite in their
// places, and on a prerendered page the root naming the build's rail, so a reader with no script (a
// link preview, a crawler, a boot that failed) sees the season's rail (spec 2026-10-16 §2, first
// paint). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { siteRailAt } from '#lib/run/site-season.ts';
import { pageChunk } from './page-chunk.ts';

const APP_HTML = readFileSync(new URL('../../app.html', import.meta.url), 'utf8');

/** Week 1's first kickoff, a week 6 game and the last regular-season game of 2026. */
const KICKOFFS = [
	'2026-09-10T00:20:00.000Z',
	'2026-10-18T17:00:00.000Z',
	'2027-01-10T21:25:00.000Z'
];
/** Thursday of week 6, 10 pm Central. */
const WEEK_6 = new Date('2026-10-16T03:00:00.000Z');

void test('the built front door names the in-season rail on its root when the build runs in week 6', () => {
	const html = pageChunk(APP_HTML, siteRailAt(WEEK_6, KICKOFFS));
	assert.match(html, /<html lang="en" data-rail="in_season">/);
	// The boot script keeps the same rail for the pages the Worker draws.
	assert.match(html, /b="in_season"/);
});

void test('a build before week 1 names the draft rail', () => {
	const html = pageChunk(APP_HTML, siteRailAt(new Date('2026-08-20T12:00:00.000Z'), KICKOFFS));
	assert.match(html, /<html lang="en" data-rail="pre_draft">/);
});

void test('a page drawn at request time has no build, so its root names no rail', () => {
	const html = pageChunk(APP_HTML, null);
	assert.match(html, /<html lang="en">/);
	assert.doesNotMatch(html, /<html[^>]*data-rail/);
	assert.match(html, /b=null/);
});

void test('every placeholder is filled', () => {
	const html = pageChunk(APP_HTML, 'in_season');
	assert.doesNotMatch(html, /%commish\./);
	assert.match(html, /<style>\.rail \.item\[data-k\]\{display:none\}/);
});

void test('a chunk with no root is left as it is', () => {
	assert.equal(pageChunk('<p>later</p>', 'in_season'), '<p>later</p>');
});
