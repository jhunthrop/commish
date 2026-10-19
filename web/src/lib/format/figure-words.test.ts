import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BOX } from '#lib/league/box/box.ts';
import { ORDER } from '#lib/order/words.ts';
import { CARD } from '#lib/player/card.ts';
import { COLUMN_HEADS } from '#lib/ui/board-columns.ts';
import { FIGURE } from './figure-words.ts';

const TABLE = JSON.parse(
	readFileSync(new URL('./figure-words.json', import.meta.url), 'utf8')
) as Record<string, string>;

void test('the words are the shared table the API reads', () => {
	assert.deepEqual({ ...FIGURE }, TABLE);
});

void test('the projected total is headed Projected on the board rows, the order and the card', () => {
	assert.equal(COLUMN_HEADS.proj.text, FIGURE.projected);
	assert.equal(ORDER.total, FIGURE.projected);
	assert.equal(CARD.projected, FIGURE.projected);
});

void test("this season's average is headed Avg on the board rows, the box score and the card", () => {
	assert.equal(COLUMN_HEADS.avg.text, FIGURE.avg);
	assert.equal(BOX.avg, FIGURE.avg);
	assert.equal(CARD.avg, FIGURE.avg);
});

void test('A game heads only the rest-of-season figure a game', () => {
	assert.equal(ORDER.perGame, FIGURE.perGame);
	for (const head of Object.values(COLUMN_HEADS)) assert.notEqual(head.text, FIGURE.perGame);
});
