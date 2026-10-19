import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardPoolCount, hitsWords, POOL, poolCount, searchPlaceholder } from './pool-words.ts';

void test('every count names its pool, grouped as a reader reads it (the sweep X4)', () => {
	assert.equal(poolCount(619, 'ranked'), '619 ranked');
	assert.equal(poolCount(1365, 'rosters'), '1,365 on rosters');
	assert.equal(poolCount(619, 'board'), '619 on our board');
	assert.equal(poolCount(665, 'boardWithMarket'), '665 on our board with kickers and defenses');
	assert.equal(poolCount(1413, 'room'), '1,413 left to draft');
});

void test('the board file names its pool by what it holds (the sweep M4, Y3)', () => {
	const ranked = [{}, {}];
	assert.equal(boardPoolCount(ranked), '2 on our board');
	assert.equal(
		boardPoolCount([...ranked, { draftOrder: true }]),
		'3 on our board with kickers and defenses'
	);
});

void test('no two pools share one name', () => {
	const names = Object.values(POOL);
	assert.equal(new Set(names).size, names.length);
});

void test('the site search names the players it finds pages for', () => {
	assert.equal(searchPlaceholder(619), 'Search 619 ranked players');
});

void test('a filtered view counts its matches, never the pool', () => {
	assert.equal(hitsWords(1365, false), '1,365 on rosters');
	assert.equal(hitsWords(1, true), '1 match');
	assert.equal(hitsWords(160, true), '160 matches');
});
