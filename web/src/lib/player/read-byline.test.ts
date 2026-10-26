// The week read's byline (Lane 222, B186), at fixed clocks on the 2026 week 7 Sunday (Eastern daylight
// time, Central five hours behind UTC), a Tuesday and a Friday. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Slate } from '#lib/run/schema.ts';
import {
	nextReadWindow,
	readHour,
	READ_BUILD_LEAD_MS,
	scheduleKickoffs,
	standingByline
} from './read-byline.ts';

const at = (iso: string): number => Date.parse(iso);
/** Thursday Oct 22, 8:15 pm ET; Sunday Oct 25: 9:30 am abroad, two 1:00 pm games, 4:05 pm, two 4:25 pm,
 * the 8:20 pm night game; Monday Oct 26, 8:15 pm ET. */
const WEEK = [
	'2026-10-23T00:15:00.000Z',
	'2026-10-25T13:30:00.000Z',
	'2026-10-25T17:00:00.000Z',
	'2026-10-25T17:00:00.000Z',
	'2026-10-25T20:05:00.000Z',
	'2026-10-25T20:25:00.000Z',
	'2026-10-25T20:25:00.000Z',
	'2026-10-26T00:20:00.000Z',
	'2026-10-27T00:15:00.000Z'
].map(at);
/** Bijan Robinson's read in run 2026-10-25T05, written Friday 12:31 am Central at 21.4. */
const BIJAN = { writtenAt: '2026-10-23T05:31:59.416Z', week: 7 };
/** This hour's capture check at the 12:00 ET window hour, the instant the run's test reads too
 * (`research/tests/test_game_day_reads.py`, _SAME_HOUR_READ): the window build takes the same hour's read. */
const SAME_HOUR_READ = at('2026-10-25T16:04:10.000Z');
const WRITTEN = 'Written Fri Oct 23, 12:31 am CT, for week 7';

void test("the lead is the run's (game_day_reads.py BUILD_LEAD)", () => {
	assert.equal(READ_BUILD_LEAD_MS, 40 * 60_000);
});

void test('each kickoff is read before by the last hour with room for the build, as the run says it', () => {
	// The run's cases (research/tests/test_game_day_reads.py).
	const cases: [string, string][] = [
		['2026-10-25T13:30:00.000Z', '2026-10-25T12:00:00.000Z'],
		['2026-10-25T17:00:00.000Z', '2026-10-25T16:00:00.000Z'],
		['2026-10-25T20:05:00.000Z', '2026-10-25T19:00:00.000Z'],
		['2026-10-25T20:25:00.000Z', '2026-10-25T19:00:00.000Z'],
		['2026-10-26T00:20:00.000Z', '2026-10-25T23:00:00.000Z'],
		['2026-10-25T17:40:00.000Z', '2026-10-25T16:00:00.000Z'],
		['2026-10-25T17:41:00.000Z', '2026-10-25T17:00:00.000Z'],
		['2026-10-23T00:15:00.000Z', '2026-10-22T23:00:00.000Z'],
		['2026-11-17T01:15:00.000Z', '2026-11-17T00:00:00.000Z']
	];
	for (const [kickoff, hour] of cases)
		assert.equal(new Date(readHour(at(kickoff))).toISOString(), hour, kickoff);
});

void test("on a game day the next read is the window whose read hour is still to come, with that window's games", () => {
	// The morning build (the run public at 7:20 am Central, 8:20 ET): the 8:00 ET read is past, so next
	// before the 1:00 pm ET games.
	assert.deepEqual(nextReadWindow(WEEK, at('2026-10-25T12:20:00.000Z')), {
		kickoff: at('2026-10-25T17:00:00.000Z'),
		games: 2
	});
	// The 12:00 ET read's build: next before the 4:05 and 4:25 games.
	assert.deepEqual(nextReadWindow(WEEK, at('2026-10-25T16:40:00.000Z')), {
		kickoff: at('2026-10-25T20:05:00.000Z'),
		games: 3
	});
	// After the night game's read, nothing more that day; Monday's read is Monday's.
	assert.equal(nextReadWindow(WEEK, at('2026-10-25T23:40:00.000Z')), null);
	assert.deepEqual(nextReadWindow(WEEK, at('2026-10-26T12:20:00.000Z')), {
		kickoff: at('2026-10-27T00:15:00.000Z'),
		games: 1
	});
});

void test("a game-day build names its write, the same hour's status read and the next read", () => {
	assert.equal(
		standingByline(BIJAN, SAME_HOUR_READ, WEEK, at('2026-10-25T16:40:00.000Z')),
		`${WRITTEN}. Status read Sun Oct 25, 11:04 am CT, no change; next before the Sun 3:05 pm CT games`
	);
	// The night game alone: one game.
	assert.equal(
		standingByline(BIJAN, at('2026-10-25T19:03:00.000Z'), WEEK, at('2026-10-25T19:40:00.000Z')),
		`${WRITTEN}. Status read Sun Oct 25, 2:03 pm CT, no change; next before the Sun 7:20 pm CT game`
	);
	// After the day's last read: the status read alone.
	assert.equal(
		standingByline(BIJAN, at('2026-10-25T23:03:00.000Z'), WEEK, at('2026-10-25T23:40:00.000Z')),
		`${WRITTEN}. Status read Sun Oct 25, 6:03 pm CT, no change`
	);
	// A status read no newer than the write, or none: the write and the next read.
	for (const statusRead of [at(BIJAN.writtenAt), null])
		assert.equal(
			standingByline(BIJAN, statusRead, WEEK, at('2026-10-25T12:20:00.000Z')),
			`${WRITTEN}. Next status read before the Sun 12:00 pm CT games`
		);
});

void test('a build on a day with no kickoff window names the status read alone, never a next days off', () => {
	// Tuesday morning and Friday morning: the run's own build each morning and the hourly capture read
	// again long before Thursday's or Sunday's windows.
	assert.equal(
		standingByline(BIJAN, at('2026-10-27T14:00:00.000Z'), WEEK, at('2026-10-27T14:20:00.000Z')),
		`${WRITTEN}. Status read Tue Oct 27, 9:00 am CT, no change`
	);
	assert.equal(
		standingByline(BIJAN, at('2026-10-23T14:00:00.000Z'), WEEK, at('2026-10-23T14:20:00.000Z')),
		`${WRITTEN}. Status read Fri Oct 23, 9:00 am CT, no change`
	);
	assert.equal(standingByline(BIJAN, null, WEEK, at('2026-10-23T14:20:00.000Z')), WRITTEN);
	// The run's own words for the write (research/tests/test_week_read_page.py).
	assert.equal(
		standingByline({ writtenAt: '2026-10-17T02:00:00.000Z', week: 6 }, null, [], 0),
		'Written Fri Oct 16, 9:00 pm CT, for week 6'
	);
});

void test("the schedule's kickoffs are each game's once, from its home club's slate", () => {
	const game = (kickoff: string, home: boolean, opponent: string) => ({
		week: 7,
		opponent,
		home,
		kickoff
	});
	const slates = [
		{ club: 'ATL', games: [game('2026-10-25T17:00:00.000Z', true, 'SF')] },
		{ club: 'SF', games: [game('2026-10-25T17:00:00.000Z', false, 'ATL')] }
	] as unknown as Slate[];
	assert.deepEqual(scheduleKickoffs(slates), [at('2026-10-25T17:00:00.000Z')]);
});
