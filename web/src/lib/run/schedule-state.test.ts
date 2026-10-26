import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asOfLine, currentWeek, stateWord, statedGame } from './schedule-state.ts';

const CENTRAL = 'America/Chicago';
const READ_AT = '2026-10-25T05:51:00.000Z';
const reach = { complete: 6, partial: null };
const LAST_WEEK = { week: 6, state: 'final' as const, kickoff: '2026-10-18T17:00:00.000Z' };
const THURSDAY = { week: 7, state: 'final' as const, kickoff: '2026-10-23T00:15:00.000Z' };
const LONDON = { week: 7, state: 'kicked_off' as const, kickoff: '2026-10-25T13:30:00.000Z' };
const NOON = { week: 7, state: 'upcoming' as const, kickoff: '2026-10-25T17:00:00.000Z' };
const NEXT_WEEK = { week: 8, state: 'upcoming' as const, kickoff: '2026-11-01T18:00:00.000Z' };
const games = [LAST_WEEK, THURSDAY, LONDON, NOON, NEXT_WEEK];

void test('currentWeek: is the week after the last complete one, read at the run', () => {
	assert.deepEqual(currentWeek(games, reach, true, READ_AT), { week: 7, readAt: READ_AT });
});

void test('currentWeek: is none before the season', () => {
	assert.equal(currentWeek(games, reach, false, READ_AT), null);
});

void test('currentWeek: is none past the last week', () => {
	assert.equal(currentWeek(games, { complete: 8, partial: null }, true, READ_AT), null);
});

void test('currentWeek: is none on a run that carries no states', () => {
	const stateless = games.map(({ week, kickoff }) => ({ week, kickoff }));
	assert.equal(currentWeek(stateless, reach, true, READ_AT), null);
});

const current = { week: 7, readAt: READ_AT };

void test('statedGame: carries the run state on the current week alone', () => {
	assert.deepEqual(statedGame(LONDON, current), {
		state: 'kicked_off',
		kickoff: '2026-10-25T13:30:00.000Z'
	});
	assert.equal(statedGame(LAST_WEEK, current), null);
	assert.equal(statedGame(NEXT_WEEK, current), null);
});

void test('statedGame: carries nothing without a current week', () => {
	assert.equal(statedGame(THURSDAY, null), null);
});

void test('stateWord: says the state words the Rankings print, and a kickoff with its day and zone', () => {
	assert.equal(stateWord({ state: 'final', kickoff: READ_AT }, CENTRAL), 'Final');
	assert.equal(stateWord({ state: 'kicked_off', kickoff: READ_AT }, CENTRAL), 'Kicked off');
	assert.equal(
		stateWord({ state: 'upcoming', kickoff: '2026-10-25T17:00:00.000Z' }, CENTRAL),
		'Sun 12:00 pm CT'
	);
});

void test("asOfLine: names the run's read, never live", () => {
	assert.equal(
		asOfLine({ week: 7, readAt: READ_AT }, CENTRAL),
		"Week 7's games as of Sun Oct 25, 12:51 am Central."
	);
});
