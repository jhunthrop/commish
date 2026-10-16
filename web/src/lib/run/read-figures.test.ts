// The figures set beside our read say what they are (Lane 59, M1, review F1 and F2): the writer's
// projection and tier gap name their preseason basis; once the run ranks the rest of the season its
// figure leads, the preseason projection follows as the labelled last, the preseason tier gap
// (which the tier panel replaces with the rest of the season's) leaves, and the read never holds
// more than three figures. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_READ_FIGURES, readFigures } from './read-figures.ts';

const PULLS = [
	{ figure: '30%', caption: "of the Rams' targets" },
	{ figure: '344', caption: 'projected PPR points' },
	{ figure: '23.4', caption: 'PPR points to the next tier' }
];
const REST = { points: 182.6, fromWeek: 6 };

const shape = (figures: ReturnType<typeof readFigures>): [string | null, string][] =>
	figures.map((figure) => [figure.label ?? null, figure.figure]);

void test('before the season the projection and the tier gap name their preseason basis', () => {
	const figures = readFigures(PULLS, { label: 'PPR', preseason: 344.1, rest: null });
	assert.deepEqual(shape(figures), [
		[null, '30%'],
		['Preseason projection', '344'],
		['Preseason tiers', '23.4']
	]);
});

void test('in season the rest of it leads, the preseason projection is the labelled last, and the preseason tier gap leaves', () => {
	const figures = readFigures(PULLS, { label: 'PPR', preseason: 344.1, rest: REST });
	assert.deepEqual(figures[0], {
		label: 'Rest of season',
		figure: '182.6',
		caption: 'PPR points from week 6'
	});
	assert.deepEqual(shape(figures), [
		['Rest of season', '182.6'],
		[null, '30%'],
		['Preseason projection', '344']
	]);
});

void test('in season the read never holds more than three figures, the preseason projection kept', () => {
	const many = [
		{ figure: '344', caption: 'projected PPR points' },
		{ figure: '30%', caption: 'target share' },
		{ figure: '139', caption: 'touches' },
		{ figure: '11', caption: 'red-zone touches' }
	];
	const figures = readFigures(many, { label: 'PPR', preseason: 344.1, rest: REST });
	assert.equal(figures.length, MAX_READ_FIGURES);
	assert.deepEqual(shape(figures), [
		['Rest of season', '182.6'],
		[null, '30%'],
		['Preseason projection', '344']
	]);
	const none = readFigures(many.slice(1), { label: 'PPR', preseason: 344.1, rest: REST });
	assert.deepEqual(shape(none), [
		['Rest of season', '182.6'],
		[null, '30%'],
		[null, '139']
	]);
});

void test('a figure written with its decimals or a thousands comma is matched at its own precision', () => {
	const at = (figure: string, preseason: number): string | undefined =>
		readFigures([{ figure, caption: 'points' }], { label: 'PPR', preseason, rest: null })[0]?.label;
	assert.equal(at('344.1', 344.1), 'Preseason projection');
	assert.equal(at('345', 344.1), undefined);
	assert.equal(at('1,204', 1204.2), 'Preseason projection');
});

void test('a read with no figures gains none, and a player with no preseason projection names none', () => {
	assert.deepEqual(readFigures([], { label: 'PPR', preseason: 344.1, rest: REST }), []);
	const figures = readFigures(PULLS, {
		label: 'PPR',
		preseason: null,
		rest: { points: 74, fromWeek: 6 }
	});
	assert.deepEqual(shape(figures), [
		['Rest of season', '74.0'],
		[null, '30%'],
		[null, '344']
	]);
});
