// A board beside the injury capture (Lane 63): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Position } from '#lib/types/player.ts';
import { heldOut, withStatuses } from './board-status.ts';
import type { Designations } from './schema.ts';

const row = (id: string, position: Position): { id: string; position: Position } => ({
	id,
	position
});
const ids = (rows: readonly { id: string }[]): string[] => rows.map((r) => r.id);

const capture: Designations = {
	readAt: '2026-10-16T14:05:00.000Z',
	source: 'tank01_injuries_by_date',
	players: {
		'a-wr': { status: 'injured_reserve', seasonLong: true, since: '2026-10-14T15:00:00.000Z' },
		'd-wr': { status: 'doubtful', seasonLong: false, since: null },
		'e-rb': { status: 'pup', seasonLong: true, since: null },
		'f-te': { status: 'injured_reserve', seasonLong: true, since: null }
	}
};

void test('a season-long player follows the last available player at his position, as the API orders him', () => {
	const rows = [
		row('a-wr', 'WR'),
		row('b-rb', 'RB'),
		row('c-wr', 'WR'),
		row('d-wr', 'WR'),
		row('e-rb', 'RB'),
		row('f-te', 'TE'),
		row('g-qb', 'QB')
	];
	const placed = withStatuses(rows, capture);
	assert.deepEqual(ids(placed), ['b-rb', 'e-rb', 'c-wr', 'd-wr', 'a-wr', 'f-te', 'g-qb']);
	assert.equal(placed.find((r) => r.id === 'd-wr')?.status?.status, 'doubtful');
	assert.equal(placed.find((r) => r.id === 'g-qb')?.status, undefined);
	assert.deepEqual(
		placed.filter(heldOut).map((r) => r.id),
		['e-rb', 'a-wr', 'f-te']
	);
	assert.deepEqual(
		ids(rows),
		['a-wr', 'b-rb', 'c-wr', 'd-wr', 'e-rb', 'f-te', 'g-qb'],
		'the rows handed in'
	);
});

void test('no capture leaves the board as the run has it', () => {
	const rows = [row('a-wr', 'WR'), row('c-wr', 'WR')];
	assert.deepEqual(withStatuses(rows, null), rows);
});
