// The pool's Gap (review 81 finding 2, Lane 66o's ruling): the API's tenth, drafters' ADP less our
// place, carried onto the room's players and the call card's rows as given, printed in the board's
// one form, and the column drawn only where a row carries one. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { carriesGap, gapText, gapTone } from '#lib/format/gap.ts';
import type { RoomBoard } from './api.ts';
import { GAP_WORDS } from '#lib/run/board-basis.ts';
import { frameView, poolBasis } from './call.ts';
import { boardOf } from './model.ts';

const player = (
	id: string,
	over: Partial<RoomBoard['players'][number]>
): RoomBoard['players'][number] => ({
	id,
	name: id,
	position: 'WR',
	team: 'DAL',
	headshot: '',
	adp: 12.4,
	points: 200,
	vor: 40,
	position_rank: 1,
	bye: 10,
	...over
});

const board = (players: RoomBoard['players']): RoomBoard => ({
	format: 'ppr',
	season: 2026,
	as_of: '2026-09-09T02:20:29.697Z',
	basis: '',
	players
});

void test("the room's players carry the API's Gap as given, none where the API sends none", () => {
	const read = boardOf(
		board([
			player('a', { gap: 11.4 }),
			player('b', { gap: -3.2, vor: 30 }),
			player('k', { position: 'K', vor: null, points: null, gap: null }),
			player('old', { vor: 10 })
		]),
		12
	);
	assert.deepEqual(
		read.players.map((p) => p.gap),
		[11.4, -3.2, null, null]
	);
	assert.ok(carriesGap(read.players));
	assert.equal(carriesGap(boardOf(board([player('old', {})]), 12).players), false);
	assert.deepEqual([gapText(11.4), gapTone(11.4)], ['+11.4', 'gain']);
	assert.deepEqual([gapText(-3.2), gapTone(-3.2)], ['−3.2', 'loss']);
});

void test("the call card's rows carry the same Gap the pool row prints", () => {
	const read = boardOf(
		board([player('a', { gap: 11.4 }), player('b', { gap: -3.2, vor: 30 })]),
		12
	);
	const view = frameView(read, new Set(), 12, 1);
	assert.deepEqual(
		view?.rows.map((row) => row.gap),
		[11.4, -3.2]
	);
});

void test("the pool row and the call card print the Gap in the board row's one form, the column only where carried", () => {
	for (const file of ['./PoolRow.svelte', '../ui/CallPanel.svelte']) {
		const source = readFileSync(new URL(file, import.meta.url), 'utf8');
		assert.match(source, /gapText\(/u, file);
		assert.match(source, /gapTone\(/u, file);
	}
	assert.match(readFileSync(new URL('./Pool.svelte', import.meta.url), 'utf8'), /carriesGap\(/u);
});

void test("the Gap's sentence is drawn with its column, at a desk only, never in the basis string a phone reads (rereview 1)", () => {
	const carried = boardOf(board([player('a', { gap: 11.4 })]), 12);
	assert.ok(!poolBasis(carried, null, 12).includes(GAP_WORDS));
	const pool = readFileSync(new URL('./Pool.svelte', import.meta.url), 'utf8');
	assert.match(pool, /\{#if gapShown\}<span class="desk"> \{GAP_WORDS\}<\/span>\{\/if\}/u);
	// The phone rule that hides the ADP and Gap columns hides the sentence with them.
	assert.match(pool, /\.cols > \.gapc,\s*\.desk,/u);
});
