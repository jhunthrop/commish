// The week a season's figures reach (the ruling on the sweep's X3): the newest week a counted game
// belongs to, so a basis's "through week N" and a Thursday player's GP agree. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countedWeek, newestCountedWeek, type GameLogRow } from './season.ts';

const row = (week: number, status: GameLogRow['status']): Pick<GameLogRow, 'week' | 'status'> => ({
	week,
	status
});

void test('a season reaches its through week, or his later game that is already in', () => {
	const thursday = { through: 5, log: [row(5, 'played'), row(6, 'played'), row(7, 'upcoming')] };
	const sunday = { through: 5, log: [row(5, 'played'), row(6, 'upcoming')] };
	const bye = { through: 5, log: [row(5, 'played'), row(6, 'bye')] };
	assert.equal(countedWeek(thursday), 6);
	assert.equal(countedWeek(sunday), 5);
	assert.equal(countedWeek(bye), 5);
	assert.equal(countedWeek({ through: 5, log: [row(6, 'inactive')] }), 6);
});

void test("the run's figures reach the newest counted game of any player, never less than through", () => {
	const thursday = { through: 5, log: [row(6, 'played')] };
	const sunday = { through: 5, log: [row(6, 'upcoming')] };
	assert.equal(newestCountedWeek([sunday, thursday]), 6);
	assert.equal(newestCountedWeek([sunday]), 5);
	assert.equal(newestCountedWeek([]), 0);
});
