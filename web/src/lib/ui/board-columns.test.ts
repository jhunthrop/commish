// The board row's columns (Lane 66n): which columns each view carries, in order, and the bands that
// hide them, the phone keeping Over repl, Projected and Gap. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardColumns, columnStyle, type ColumnView } from './board-columns.ts';

const ALL: ColumnView = {
	order: 'board',
	tier: true,
	bye: true,
	range: true,
	gap: true,
	season: true,
	action: true
};

void test('the All board carries every column in the row order', () => {
	assert.deepEqual(boardColumns(ALL).keys, [
		'rank',
		'face',
		'player',
		'tier',
		'bye',
		'proj',
		'vor',
		'range',
		'adp',
		'gap',
		'gp',
		'avg',
		'action'
	]);
});

void test('ADP leads with the drafters ADP and names our rank among the figures', () => {
	const keys = boardColumns({ ...ALL, order: 'adp' }).keys;
	assert.equal(keys[0], 'adpLead');
	assert.ok(keys.includes('ourRank'));
	assert.ok(!keys.includes('rank') && !keys.includes('adp'));
});

void test('a club page drops the bye, a position view the tier chip, a rest-of-season board the gap', () => {
	assert.ok(!boardColumns({ ...ALL, bye: false }).keys.includes('bye'));
	assert.ok(!boardColumns({ ...ALL, tier: false }).keys.includes('tier'));
	assert.ok(!boardColumns({ ...ALL, gap: false }).keys.includes('gap'));
	assert.ok(!boardColumns({ ...ALL, season: false }).keys.includes('avg'));
});

void test('the phone keeps the face, the player, Projected, Over repl and Gap', () => {
	const columns = boardColumns(ALL);
	assert.equal(
		columns.templates.phone,
		'32px minmax(0, 1fr) 62px 58px 44px',
		'face, player, proj, vor, gap'
	);
	assert.match(columns.cells.bye ?? '', /h-phone/);
	assert.doesNotMatch(columns.cells.gap ?? '', /h-phone/);
	assert.doesNotMatch(columns.cells.proj ?? '', /h-phone/);
});

void test('every band template has one track per column it shows', () => {
	const columns = boardColumns(ALL);
	for (const band of ['desk', 'lap', 'tab', 'phone'] as const) {
		const shown = columns.keys.filter((key) => !(columns.cells[key] ?? '').includes(`h-${band}`));
		const tracks = columns.templates[band].match(/minmax\([^)]*\)|\d+px/g) ?? [];
		assert.equal(tracks.length, shown.length, band);
	}
});

void test('kickers and defenses in draft order show their place and ADP, the phone keeping both', () => {
	const columns = boardColumns({ ...ALL, draftOrder: true });
	assert.deepEqual(columns.keys, ['face', 'player', 'bye', 'order', 'adp', 'action']);
	assert.doesNotMatch(columns.cells.adp ?? '', /h-phone/);
});

void test('the style names each band once', () => {
	const style = columnStyle(boardColumns(ALL));
	for (const band of ['desk', 'lap', 'tab', 'phone'])
		assert.match(style, new RegExp(`--cols-${band}: `));
});
