// Each starter's game on the Matchup screen, on the member's clock. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { gameLine, kickoffsOf, runClub } from './kickoffs.ts';

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

/** The run's 32 clubs, as the provider codes them (the stand-in run's schedule). */
const RUN_CLUBS = new Set(
	'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WSH'.split(
		' '
	)
);

/** Every club code a recorded host answer carries, free agents left out. */
function hostCodes(): string[] {
	const read = (path: string): unknown =>
		JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
	const sleeper = read('../../../../api/internal/leaguesync/replay/sleeper/players.json') as Record<
		string,
		{ team: string | null }
	>;
	const mfl = read('../../../../api/internal/leaguesync/replay/mfl/players.json') as {
		players: { player: { team: string }[] };
	};
	const fixture = read('../../../scripts/inseason-fixture/data/sync.json') as {
		roster: { player: { team: string } }[];
	};
	return [
		...Object.values(sleeper).map((player) => player.team ?? ''),
		...mfl.players.player.map((player) => player.team),
		...fixture.roster.map((spot) => spot.player.team)
	].filter((code) => code !== '' && code !== 'FA');
}

void test("every host club code in the recorded answers is one of the run's clubs", () => {
	const codes = new Set(hostCodes());
	assert.ok(codes.size > 20);
	for (const code of codes) assert.ok(RUN_CLUBS.has(runClub(code)), code);
	assert.equal(gameLine(kickoffs, 'KCC', 6, 'America/New_York'), 'at BUF Sun 4:25 pm');
});
