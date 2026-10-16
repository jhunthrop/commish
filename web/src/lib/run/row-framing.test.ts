// How a board row frames its rank, one rule for every page that draws board rows (the front door's
// top ten, the board, ADP, a club): before the run ranks the rest of the season the row compares
// drafters with our rank and names the round his value ranks in; once it does, the ADP stands
// alone as a fact and the round goes (Lane 59, H2 and M6). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vorCell } from '#lib/ui/heat.ts';
import { boardBasisTerms } from './board-basis.ts';
import { PRESEASON_FRAMING, rowFraming } from './row-framing.ts';

void test('a preseason board compares drafters with our rank and names the round', () => {
	assert.deepEqual(rowFraming({}), { compare: true, round: true });
	assert.deepEqual(PRESEASON_FRAMING, { compare: true, round: true });
});

void test('a rest-of-season board gives the ADP alone and no round', () => {
	assert.deepEqual(rowFraming({ rosFromWeek: 6 }), { compare: false, round: false });
});

void test('the over replacement cell names the round only where the framing does', () => {
	assert.equal(vorCell(164.1, 1, true).label, 'over repl · rd 1');
	assert.equal(vorCell(164.1, 1, false).label, 'over repl');
	// The tint stays: the figure keeps its colour, the framing goes.
	assert.equal(vorCell(164.1, 1, false).heat, 'heat-1');
	assert.equal(vorCell(-3, 9, true).label, 'over repl');
});

const ADP = ['PPR drafts, Sep 5 to Sep 9'];
const PRESEASON = {
	label: 'PPR',
	basis: ['PPR, full 2026 season', 'ranked by points over replacement']
};
const REST = { ...PRESEASON, rosFromWeek: 6 };

void test('the preseason basis names the round and compares drafters with our rank', () => {
	const terms = boardBasisTerms({
		format: PRESEASON,
		scoring: 'PPR scoring',
		underway: false,
		boardSize: 618,
		adpBasis: ADP,
		range: true
	});
	assert.deepEqual(
		terms.map((term) => term.term),
		['Scoring', 'Green', 'Rose', 'Drafters', 'Range']
	);
	assert.equal(terms[1]?.means, 'The round his points over replacement rank in, among 618');
	assert.equal(terms[3]?.means, 'Their ADP from PPR drafts, Sep 5 to Sep 9, against our rank');
});

void test('the rest-of-season basis names no round and gives the ADP as a fact', () => {
	const terms = boardBasisTerms({
		format: REST,
		scoring: 'PPR scoring',
		underway: true,
		boardSize: 618,
		adpBasis: ADP,
		range: false
	});
	assert.deepEqual(
		terms.map((term) => term.term),
		['Scoring', 'Order', 'Green', 'Rose', 'Drafters']
	);
	const green = terms[2]?.means ?? '';
	assert.doesNotMatch(green, /round/i);
	assert.equal(green, 'Above replacement, deeper the higher he ranks among 618');
	assert.equal(terms[4]?.means, 'Their ADP from PPR drafts, Sep 5 to Sep 9');
});
