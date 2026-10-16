// A board beside the injury capture (Lane 63): run with `npm test`. The order is held to the API's own
// cases, api/testdata/board-order-cases.json, which api/internal/solo/board_status_test.go reads too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Position } from '#lib/types/player.ts';
import { heldOut, withStatuses } from './board-status.ts';
import type { Designations, PlayerStatus } from './schema.ts';

interface OrderCase {
	name: string;
	rows: [string, Position][];
	listed: Record<string, { status: PlayerStatus['status']; season_long: boolean }>;
	want: string[];
}

const CASES = (
	JSON.parse(
		readFileSync(
			new URL('../../../../api/testdata/board-order-cases.json', import.meta.url),
			'utf8'
		)
	) as { cases: OrderCase[] }
).cases;

const ids = (rows: readonly { id: string }[]): string[] => rows.map((r) => r.id);

function captureOf(listed: OrderCase['listed']): Designations {
	const players = Object.fromEntries(
		Object.entries(listed).map(([id, l]) => [
			id,
			{ status: l.status, seasonLong: l.season_long, since: null }
		])
	);
	return { readAt: '2026-10-16T14:05:00.000Z', checkedAt: null, source: 'test', players };
}

void test('the API’s order cases', () => {
	assert.ok(CASES.length > 0);
	for (const c of CASES) {
		const rows = c.rows.map(([id, position]) => ({ id, position }));
		const placed = withStatuses(rows, captureOf(c.listed));
		assert.deepEqual(ids(placed), c.want, c.name);
		assert.deepEqual(
			placed.filter(heldOut).map((r) => r.id),
			c.want.filter((id) => c.listed[id]?.season_long === true),
			c.name
		);
		assert.deepEqual(
			ids(rows),
			c.rows.map(([id]) => id),
			`${c.name}: the rows handed in`
		);
	}
});

void test('no capture leaves the board as the run has it', () => {
	const rows = [
		{ id: 'a-wr', position: 'WR' as const },
		{ id: 'c-wr', position: 'WR' as const }
	];
	assert.deepEqual(withStatuses(rows, null), rows);
});
