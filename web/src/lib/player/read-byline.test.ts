// The week read's byline (Lane 222, B186), at fixed clocks on the 2026 week 7 Sunday (Eastern
// daylight time, Central five hours behind UTC). Run with `npm test`.
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
/** Sunday Oct 25: 9:30 am abroad, two 1:00 pm games, 4:05 pm, two 4:25 pm, the 8:20 pm night game (ET). */
const SUNDAY = [
	'2026-10-25T13:30:00.000Z',
	'2026-10-25T17:00:00.000Z',
	'2026-10-25T17:00:00.000Z',
	'2026-10-25T20:05:00.000Z',
	'2026-10-25T20:25:00.000Z',
	'2026-10-25T20:25:00.000Z',
	'2026-10-26T00:20:00.000Z'
].map(at);
/** Bijan Robinson's read in run 2026-10-25T05, written Friday 12:31 am Central at 21.4. */
const BIJAN = { writtenAt: '2026-10-23T05:31:59.416Z', week: 7 };

void test("the lead is the run's (game_day_reads.py BUILD_LEAD)", () => {
	assert.equal(READ_BUILD_LEAD_MS, 25 * 60_000);
});

void test('each kickoff is read before by the last hour with room for the build, as the run says it', () => {
	// The run's cases (research/tests/test_game_day_reads.py).
	const cases: [string, string][] = [
		['2026-10-25T13:30:00.000Z', '2026-10-25T13:00:00.000Z'],
		['2026-10-25T17:00:00.000Z', '2026-10-25T16:00:00.000Z'],
		['2026-10-25T20:05:00.000Z', '2026-10-25T19:00:00.000Z'],
		['2026-10-25T20:25:00.000Z', '2026-10-25T19:00:00.000Z'],
		['2026-10-26T00:20:00.000Z', '2026-10-25T23:00:00.000Z'],
		['2026-10-25T17:25:00.000Z', '2026-10-25T16:00:00.000Z'],
		['2026-10-25T17:26:00.000Z', '2026-10-25T17:00:00.000Z'],
		['2026-11-17T01:15:00.000Z', '2026-11-17T00:00:00.000Z']
	];
	for (const [kickoff, hour] of cases)
		assert.equal(new Date(readHour(at(kickoff))).toISOString(), hour, kickoff);
});

void test("the next read is the window whose read hour is still to come, with that window's games", () => {
	// The morning build (the run public at 7:20 am Central): next before the game abroad at 9:30 am ET,
	// then, built from that read, before the 1:00 pm ET games.
	assert.deepEqual(nextReadWindow(SUNDAY, at('2026-10-25T12:20:00.000Z')), {
		kickoff: at('2026-10-25T13:30:00.000Z'),
		games: 1
	});
	assert.deepEqual(nextReadWindow(SUNDAY, at('2026-10-25T13:20:00.000Z')), {
		kickoff: at('2026-10-25T17:00:00.000Z'),
		games: 2
	});
	// The 12:00 ET read's build, live at 12:20 ET: next before the 4:05 and 4:25 games.
	assert.deepEqual(nextReadWindow(SUNDAY, at('2026-10-25T16:20:00.000Z')), {
		kickoff: at('2026-10-25T20:05:00.000Z'),
		games: 3
	});
	assert.equal(nextReadWindow(SUNDAY, at('2026-10-25T23:20:00.000Z')), null);
});

void test('a standing read names its write, the status read its build took and the next read', () => {
	const built = at('2026-10-25T16:20:00.000Z');
	assert.equal(
		standingByline(BIJAN, at('2026-10-25T16:00:30.000Z'), SUNDAY, built),
		'Written Fri Oct 23, 12:31 am CT, for week 7. Status read again Sun Oct 25, 11:00 am CT, no change; next before the Sun 3:05 pm CT games'
	);
	// The night game alone: one game.
	assert.equal(
		standingByline(BIJAN, at('2026-10-25T23:00:30.000Z'), SUNDAY, at('2026-10-25T20:20:00.000Z')),
		'Written Fri Oct 23, 12:31 am CT, for week 7. Status read again Sun Oct 25, 6:00 pm CT, no change; next before the Sun 7:20 pm CT game'
	);
	// After the last read of the schedule: the status read alone.
	assert.equal(
		standingByline(BIJAN, at('2026-10-25T23:00:30.000Z'), SUNDAY, at('2026-10-25T23:20:00.000Z')),
		'Written Fri Oct 23, 12:31 am CT, for week 7. Status read again Sun Oct 25, 6:00 pm CT, no change'
	);
	// A status read no newer than the write, or none: the write and the next read.
	for (const statusRead of [at(BIJAN.writtenAt), null])
		assert.equal(
			standingByline(BIJAN, statusRead, SUNDAY, at('2026-10-25T13:20:00.000Z')),
			'Written Fri Oct 23, 12:31 am CT, for week 7. Next status read before the Sun 12:00 pm CT games'
		);
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
