import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BOX } from '#lib/league/box/box.ts';
import { ORDER } from '#lib/order/words.ts';
import { CARD, unreadBasis } from '#lib/player/card.ts';
import { COLUMN_HEADS } from '#lib/ui/board-columns.ts';
import { FIGURE, weekHead } from './figure-words.ts';

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

void test("beside the season's Projected, the week's projection is headed by its week", () => {
	assert.equal(weekHead(6), 'Wk 6');
	assert.notEqual(weekHead(6), FIGURE.projected);
	// One-week box scores keep their own head.
	assert.equal(BOX.proj, 'Proj');
});

void test("the card heads its week tile by the week, never Proj, beside the season's Projected", () => {
	const projected = CARD.projected;
	for (const head of [weekHead(6), FIGURE.week]) {
		assert.notEqual(head, BOX.proj);
		assert.notEqual(head, projected);
	}
	assert.match(unreadBasis(false, weekHead(6)), /^Wk 6, /);
});

void test('A game heads only the rest-of-season figure a game', () => {
	assert.equal(ORDER.perGame, FIGURE.perGame);
	for (const head of Object.values(COLUMN_HEADS)) assert.notEqual(head.text, FIGURE.perGame);
});
