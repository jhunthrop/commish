// The week a season's figures reach (the ruling on the sweep's X3): the newest week a counted game
// belongs to, so a basis's "through week N" and a Thursday player's GP agree. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countedWeek, newestCountedWeek } from './reach.ts';
import type { GameLogRow } from './season.ts';

const row = (
	week: number,
	status: GameLogRow['status'],
	opponent: string | null = 'KC'
): Pick<GameLogRow, 'week' | 'status' | 'opponent'> => ({
	week,
	status,
	opponent: status === 'bye' ? null : opponent
});

void test('a season reaches its through week, or his later game that is already in', () => {
	const thursday = { through: 5, log: [row(5, 'played'), row(6, 'played'), row(7, 'upcoming')] };
	const sunday = { through: 5, log: [row(5, 'played'), row(6, 'upcoming')] };
	const bye = { through: 5, log: [row(5, 'played'), row(6, 'bye')] };
	assert.equal(countedWeek(thursday), 6);
	assert.equal(countedWeek(sunday), 5);
	assert.equal(countedWeek(bye), 5);
	assert.equal(countedWeek({ through: 5, log: [row(6, 'inactive')] }), 6);
	// A free agent's weeks name no opponent (Lane 123): no game, so his season reaches the records only.
	const freeAgent = {
		through: 5,
		log: [row(5, 'played'), row(6, 'inactive', null), row(18, 'inactive', null)]
	};
	assert.equal(countedWeek(freeAgent), 5);
	assert.equal(newestCountedWeek([freeAgent, sunday]), 5);
});

void test('a week he played that the run cannot name counts, past the records too (B120)', () => {
	// His week 6 "Played, no stats" (Lane 138): the head says week 6 over a log listing it.
	const snapped = {
		through: 5,
		log: [row(5, 'played'), { ...row(6, 'inactive', null), unnamedGame: true as const }]
	};
	assert.equal(countedWeek(snapped), 6);
	// A week naming no club he did not play still reaches nothing.
	assert.equal(countedWeek({ through: 5, log: [row(5, 'played'), row(6, 'inactive', null)] }), 5);
});

void test("the run's figures reach the newest counted game of any player, never less than through", () => {
	const thursday = { through: 5, log: [row(6, 'played')] };
	const sunday = { through: 5, log: [row(6, 'upcoming')] };
	assert.equal(newestCountedWeek([sunday, thursday]), 6);
	assert.equal(newestCountedWeek([sunday]), 5);
	assert.equal(newestCountedWeek([]), 0);
});
