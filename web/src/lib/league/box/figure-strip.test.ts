// The strip's width shares (Lane 215 review M1): the narrow cell's share is the one the grid lays
// out, so the apps that read it from the parity file draw the same tracks. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { figureCell, stripShare, stripTracks } from './figure-strip.ts';

void test("the narrow cell takes a smaller share than the others, and the tracks are the cells' shares", () => {
	const week = figureCell('Wk 6', 13, { narrow: true });
	const last = figureCell('Last', 17.3);
	assert.ok(stripShare(week) < stripShare(last));
	assert.equal(stripShare(last), 1);
	assert.equal(
		stripTracks([week, last]),
		`minmax(0, ${String(stripShare(week))}fr) minmax(0, 1fr)`
	);
});
