// Each starter's game on the Matchup screen, on the member's clock. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameLine, kickoffsOf } from './kickoffs.ts';

const kickoffs = kickoffsOf({
	slates: [
		{
			abbr: 'KC',
			games: [
				{ week: 6, opponent: 'BUF', home: false, kickoff: '2026-10-18T20:25:00.000Z' },
				{ week: 8, opponent: 'DEN', home: true, kickoff: '2026-11-01T04:00:00.000Z' }
			],
			strength: 0,
			rank: 1,
			method: 'm',
			window: { from: '2026-01-01', to: '2026-01-02' }
		}
	] as never
});

void test("a starter's game names the opponent and the kickoff on the member's clock", () => {
	assert.equal(gameLine(kickoffs, 'KC', 6, 'America/New_York'), 'at BUF Sun 4:25 pm');
	assert.equal(gameLine(kickoffs, 'KC', 6, 'America/Los_Angeles'), 'at BUF Sun 1:25 pm');
});

void test('a day the league has not timed is named by its day alone', () => {
	assert.equal(gameLine(kickoffs, 'KC', 8, 'America/Los_Angeles'), 'vs DEN Sun');
});

void test('a week with no game is a bye, a club the run lacks says nothing', () => {
	assert.equal(gameLine(kickoffs, 'KC', 7, 'America/New_York'), 'Bye this week');
	assert.equal(gameLine(kickoffs, 'FA', 6, 'America/New_York'), null);
});
