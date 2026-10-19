import assert from 'node:assert/strict';
import { test } from 'node:test';
import { poolCount, searchPlaceholder } from './pool-words.ts';

void test('every count names its pool, grouped as a reader reads it (the sweep X4)', () => {
	assert.equal(poolCount(619, 'ranked'), '619 ranked');
	assert.equal(poolCount(1365, 'rosters'), '1,365 on rosters');
	assert.equal(poolCount(665, 'sheet'), '665 on the sheet');
});

void test('the site search names the players it finds pages for', () => {
	assert.equal(searchPlaceholder(619), 'Search 619 ranked players');
});
