// How a board row frames its rank, one rule for every page that draws board rows (the front door's
// top ten, the board, ADP, a club): before the run ranks the rest of the season the row compares
// drafters with our rank and names the round his value ranks in; once it does, the ADP stands
// alone as a fact and the round goes (Lane 59, H2 and M6). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	HELD_FRAMING,
	PRESEASON_FRAMING,
	framedVorCell,
	roundlessVorCell,
	rowFraming
} from './row-framing.ts';
import { VOR_LABEL, vorCell } from '#lib/ui/heat.ts';

void test('a preseason board compares drafters with our rank and names the round', () => {
	assert.deepEqual(rowFraming({}), { compare: true, round: true });
	assert.deepEqual(PRESEASON_FRAMING, { compare: true, round: true });
});

void test('a rest-of-season board gives the ADP alone and no round', () => {
	assert.deepEqual(rowFraming({ rosFromWeek: 6 }), { compare: false, round: false });
});

void test('the over replacement cell names the round only where the framing does', () => {
	assert.equal(framedVorCell(164.1, 1, PRESEASON_FRAMING).label, 'over repl · rd 1');
	assert.equal(framedVorCell(164.1, 1, rowFraming({ rosFromWeek: 6 })).label, 'over repl');
	// The tint stays: the figure keeps its colour, the framing goes.
	assert.equal(framedVorCell(164.1, 1, rowFraming({ rosFromWeek: 6 })).heat, 'heat-1');
	assert.equal(framedVorCell(-3, 9, PRESEASON_FRAMING).label, 'over repl');
});

void test('a held player’s row frames no rank on any board: the ADP alone, no round (Lane 63)', () => {
	assert.deepEqual(HELD_FRAMING, { compare: false, round: false });
	assert.equal(framedVorCell(97.3, 1, HELD_FRAMING).label, VOR_LABEL);
	assert.notEqual(framedVorCell(97.3, 1, PRESEASON_FRAMING).label, VOR_LABEL);
});

void test('a league row’s value cell drops the round only for a held player (Lane 63, N1)', () => {
	// LeagueRow draws roundlessVorCell for a held player and vorCell otherwise.
	assert.equal(roundlessVorCell(97.3, 1).label, VOR_LABEL);
	assert.deepEqual(roundlessVorCell(97.3, 1), framedVorCell(97.3, 1, HELD_FRAMING));
	assert.deepEqual(vorCell(97.3, 1), framedVorCell(97.3, 1, PRESEASON_FRAMING));
});
