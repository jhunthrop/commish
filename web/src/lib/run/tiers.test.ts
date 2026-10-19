// The tier drop as the run writes it (Lane 66q): the web prints each tier's drop as given and never
// subtracts, prints none where the run wrote none (a run older than the column), and none where a held
// player stands at the tier's edge, so a held player counts toward no drop (Lane 63). Run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tierGroups } from './tiers.ts';
import type { BoardRow } from './schema.ts';

function row(id: string, positionRank: number, tier: number, tierDrop?: number | null): BoardRow {
	return {
		id,
		slug: id,
		name: id,
		position: 'WR',
		positionRank,
		team: 'LAR',
		headshot: 'https://example.com/a.png',
		ourRank: positionRank,
		vorRound: 1,
		adp: null,
		projected: 300.1 - positionRank * 7.3,
		vor: 100,
		expectedGames: 15,
		floor: null,
		median: null,
		ceiling: null,
		tier,
		...(tierDrop === undefined ? {} : { tierDrop })
	};
}

const BOARD = [
	row('a', 1, 1, 16.8),
	row('b', 2, 1, 16.8),
	row('c', 3, 2, 4.5),
	row('d', 4, 3, null)
];

void test("each tier's drop is the run's, as given, and the last tier has none", () => {
	const groups = tierGroups(BOARD, 'WR');
	assert.deepEqual(
		groups.map((g) => g.cliff),
		[{ drop: 16.8, nextTier: 2, nextId: 'c' }, { drop: 4.5, nextTier: 3, nextId: 'd' }, null]
	);
});

void test('a run older than the column draws no drop, never a subtraction', () => {
	const older = [row('a', 1, 1), row('b', 2, 1), row('c', 3, 2), row('d', 4, 3)];
	assert.deepEqual(
		tierGroups(older, 'WR').map((g) => g.cliff),
		[null, null, null]
	);
});

void test("a held player at a tier's edge leaves that drop unsaid, the others stand", () => {
	const held = new Set(['b']);
	const groups = tierGroups(BOARD, 'WR', (r) => held.has(r.id));
	assert.deepEqual(
		groups.map((g) => g.rows.map((r) => r.id)),
		[['a'], ['c'], ['d']]
	);
	assert.deepEqual(
		groups.map((g) => g.cliff),
		[null, { drop: 4.5, nextTier: 3, nextId: 'd' }, null]
	);
});

void test('a tier whose every player is held leaves no drop across it', () => {
	const groups = tierGroups(BOARD, 'WR', (r) => r.id === 'c');
	assert.deepEqual(
		groups.map((g) => [g.tier, g.cliff]),
		[
			[1, null],
			[3, null]
		]
	);
});
