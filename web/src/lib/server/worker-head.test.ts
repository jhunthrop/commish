// The head the Worker answers a page the browser draws with (Lane 169 fix round 1): its canonical
// address names the section, never a member's id (M1), its og:url the request's own, and the league's
// line says the free season only while /pass's clock says it (M3). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalPathOf, workerHeadHtml } from './worker-head.ts';

const IN_SEASON = new Date('2026-10-23T12:00:00Z');
const AFTER = new Date('2027-06-01T12:00:00Z');

void test('the canonical address drops the id and keeps the route words', () => {
	assert.equal(canonicalPathOf('/league/abc123'), '/league/');
	assert.equal(canonicalPathOf('/league/abc123/lineup'), '/league/');
	assert.equal(canonicalPathOf('/league/new'), '/league/new');
	assert.equal(canonicalPathOf('/mock/new'), '/mock/new');
	assert.equal(canonicalPathOf('/mock/r9/report'), '/mock/');
	assert.equal(canonicalPathOf('/mock/share/x7k2'), '/mock/share/');
	assert.equal(canonicalPathOf('/lobby/l1'), '/lobby/');
	assert.equal(canonicalPathOf('/companion/c1'), '/companion/');
});

void test("a league's head names the section canonical and the league as the share", () => {
	const html = workerHeadHtml('/league/abc123/lineup', IN_SEASON) ?? '';
	assert.match(html, /<link rel="canonical" href="https:\/\/trycommish\.app\/league\/">/);
	assert.match(
		html,
		/<meta property="og:url" content="https:\/\/trycommish\.app\/league\/abc123\/lineup">/
	);
	assert.doesNotMatch(html.split('og:url')[0] ?? '', /abc123/);
	assert.match(html, /<meta name="robots" content="noindex">/);
});

void test("the league's line says free only in the free season", () => {
	assert.match(workerHeadHtml('/league/a', IN_SEASON) ?? '', /Free through the 2026 season\./);
	assert.doesNotMatch(workerHeadHtml('/league/a', AFTER) ?? '', /Free/);
	assert.doesNotMatch(workerHeadHtml('/mock/new', IN_SEASON) ?? '', /Free/);
});

void test('a path outside the four sections has no head of its own', () => {
	assert.equal(workerHeadHtml('/players/puka-nacua', IN_SEASON), null);
});
