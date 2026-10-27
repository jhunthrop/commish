import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weekLines } from '#lib/run/record.ts';
import { weeklyLines } from '#lib/run/records.ts';
import type { RecordWeek, RunRecord, Schedule } from '#lib/run/schema.ts';
import { weekStates } from './week-state.ts';

type GameState = 'upcoming' | 'kicked_off' | 'final';

const THURSDAY = '2026-10-23T00:15:00.000Z';
const SUNDAY = '2026-10-25T17:00:00.000Z';
const WEEK: RecordWeek = {
	week: 7,
	status: 'frozen',
	frozenAt: '2026-10-20T12:00:00.000Z',
	frozenBy: '2026-10-21T04',
	order: 'preseason',
	gradedAt: null,
	population: 0,
	lines: []
} as unknown as RecordWeek;
const RECORD = { weeks: [WEEK] } as unknown as RunRecord;

function schedule(thursday: GameState, sunday: GameState = 'upcoming'): Schedule {
	const game = (kickoff: string, state: GameState) => ({
		week: 7,
		opponent: 'CHI',
		home: false,
		kickoff,
		state
	});
	return {
		slates: [
			{ abbr: 'NE', games: [game(THURSDAY, thursday)] },
			{ abbr: 'MIN', games: [game(SUNDAY, sunday)] }
		]
	} as unknown as Schedule;
}

const at = (iso: string): number => Date.parse(iso);

void test('a set week is not played before its first kickoff, under way after it, through the engine (D08)', () => {
	const before = weekStates(RECORD, schedule('upcoming'), at('2026-10-22T20:00:00Z'));
	assert.deepEqual(before, { unplayed: [7], underway: [] });
	assert.equal(
		weekLines([WEEK], before.unplayed, before.underway)[0]?.text,
		'set Tue Oct 20, not played yet'
	);

	// Friday 04:05Z: Thursday's game is final on the run, Sunday's is ahead.
	const after = weekStates(RECORD, schedule('final'), at('2026-10-24T04:05:00Z'));
	assert.deepEqual(after, { unplayed: [], underway: [7] });
	assert.equal(
		weekLines([WEEK], after.unplayed, after.underway)[0]?.text,
		'set Tue Oct 20, under way'
	);
	assert.match(weeklyLines([WEEK], after.unplayed, after.underway)[0]?.text ?? '', /, under way$/);

	// A run that lags the clock still reads the kicked-off game as kicked off.
	const lagging = weekStates(RECORD, schedule('upcoming'), at('2026-10-23T02:00:00Z'));
	assert.deepEqual(lagging, { unplayed: [], underway: [7] });
});

void test('a set week with every game final is neither not played nor under way', () => {
	const done = weekStates(RECORD, schedule('final', 'final'), at('2026-10-27T12:00:00Z'));
	assert.deepEqual(done, { unplayed: [], underway: [] });
	assert.equal(weekLines([WEEK])[0]?.text, "set Tue Oct 20, grades once every game's stats are in");
});

void test('a week with no game on the schedule is neither not played nor under way (fix round 1, M1)', () => {
	const trimmed = { slates: [{ abbr: 'NE', games: [] }] } as unknown as Schedule;
	assert.deepEqual(weekStates(RECORD, trimmed, at('2026-10-22T20:00:00Z')), {
		unplayed: [],
		underway: []
	});
});

void test('a build after the last game has ended reads the week played, though the run never marked it final (M4)', () => {
	const unmarked = schedule('kicked_off', 'kicked_off');
	// Sunday 17:00Z kickoff: under way three hours in, played five hours after.
	assert.deepEqual(weekStates(RECORD, unmarked, at('2026-10-25T20:00:00Z')), {
		unplayed: [],
		underway: [7]
	});
	assert.deepEqual(weekStates(RECORD, unmarked, at('2026-10-25T22:00:00Z')), {
		unplayed: [],
		underway: []
	});
});
