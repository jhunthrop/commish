// The figures set beside our read say what they are (Lane 59, M1): the writer's projection names its
// basis, and once the run ranks the rest of the season that figure leads and the preseason
// projection follows as a fact. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFigures } from './read-figures.ts';

const PULLS = [
	{ figure: '30%', caption: "of the Rams' targets" },
	{ figure: '344', caption: 'projected PPR points' },
	{ figure: '23.4', caption: 'PPR points to the next tier' }
];

void test('before the season the writer’s projection is named the preseason projection', () => {
	const figures = readFigures(PULLS, { label: 'PPR', preseason: 344.1, rest: null });
	assert.deepEqual(
		figures.map((figure) => [figure.label ?? null, figure.figure]),
		[
			[null, '30%'],
			['Preseason projection', '344'],
			[null, '23.4']
		]
	);
});

void test('in season the rest-of-season figure leads, from the run, and the preseason one follows', () => {
	const figures = readFigures(PULLS, {
		label: 'PPR',
		preseason: 344.1,
		rest: { points: 182.6, fromWeek: 6 }
	});
	assert.deepEqual(figures[0], {
		label: 'Rest of season',
		figure: '182.6',
		caption: 'PPR points from week 6'
	});
	assert.deepEqual(
		figures.slice(1).map((figure) => [figure.label ?? null, figure.figure]),
		[
			[null, '30%'],
			['Preseason projection', '344'],
			[null, '23.4']
		]
	);
});

void test('a figure written with its decimals or a thousands comma is matched at its own precision', () => {
	const one = readFigures([{ figure: '344.1', caption: 'points' }], {
		label: 'PPR',
		preseason: 344.1,
		rest: null
	});
	assert.equal(one[0]?.label, 'Preseason projection');
	const off = readFigures([{ figure: '345', caption: 'points' }], {
		label: 'PPR',
		preseason: 344.1,
		rest: null
	});
	assert.equal(off[0]?.label, undefined);
	const comma = readFigures([{ figure: '1,204', caption: 'yards' }], {
		label: 'PPR',
		preseason: 1204.2,
		rest: null
	});
	assert.equal(comma[0]?.label, 'Preseason projection');
});

void test('a read with no figures gains none, and a player with no preseason projection names none', () => {
	assert.deepEqual(
		readFigures([], { label: 'PPR', preseason: 344.1, rest: { points: 182.6, fromWeek: 6 } }),
		[]
	);
	const figures = readFigures(PULLS, {
		label: 'PPR',
		preseason: null,
		rest: { points: 74, fromWeek: 6 }
	});
	assert.equal(figures[0]?.figure, '74.0');
	assert.ok(figures.slice(1).every((figure) => figure.label === undefined));
});
