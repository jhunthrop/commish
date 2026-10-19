// The fixture's week after its Sunday (Lane 85): the Monday and Tuesday reads the stand-in API serves,
// as the API would answer them at those clocks. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	FIXTURE_MONDAY_CLOCK,
	FIXTURE_TUESDAY_CLOCK
} from '../../../../scripts/inseason-fixture/clock.ts';
import { stamped } from '../../../../scripts/inseason-fixture/game-state.ts';
import { linesOf, recordedMatchups } from '../../../../scripts/inseason-fixture/scoreboard-at.ts';
import { afterSundayOf } from '../../../../scripts/inseason-fixture/sunday.ts';
import { inTenths } from '../../../../scripts/inseason-fixture/tenths.ts';
import type { LeagueSync } from '../api.ts';
import type { LineupAdvice, MatchupBox, TradeAdvice, WaiverAdvice } from '../inseason/api.ts';
import { gameHead } from './kickoff.ts';
import { heldLineup, locked } from './lineup.ts';

const data = (name: string): unknown =>
	inTenths(
		JSON.parse(
			readFileSync(
				new URL(`../../../../scripts/inseason-fixture/data/${name}.json`, import.meta.url),
				'utf8'
			)
		)
	);
const sync = data('sync') as LeagueSync;
const lineup = data('lineup') as LineupAdvice;
const matchup = data('matchup') as MatchupBox;
const week = {
	me: sync.me,
	week: sync.week,
	matchups: await recordedMatchups(),
	lines: linesOf({
		lineup,
		waivers: data('waivers') as WaiverAdvice,
		trades: data('trades') as TradeAdvice,
		matchup
	}),
	box: matchup
};
/** The week at a clock as the stand-in API sends it: every game stamped with the API's state. */
const at = (clock: string): ReturnType<typeof afterSundayOf> => {
	const now = Date.parse(clock);
	return stamped(afterSundayOf({ sync, lineup, matchup }, week, now, clock), now) as ReturnType<
		typeof afterSundayOf
	>;
};

void test('on Monday no game reads a kickoff already past as next, and no move is on a locked row', () => {
	const now = Date.parse(FIXTURE_MONDAY_CLOCK);
	const monday = at(FIXTURE_MONDAY_CLOCK);
	for (const game of monday.scoreboard.games) {
		if (game.next_kickoff !== null) assert.ok(Date.parse(game.next_kickoff) > now);
		assert.notEqual(
			gameHead({ state: game.state, next: game.next_kickoff }, now).state,
			'upcoming'
		);
	}
	const changed = monday.lineup.slots.filter((s) => s.changed);
	assert.ok(changed.length > 0, 'Monday night still has a change to make');
	for (const s of changed) {
		assert.ok(!locked(s.ours, now), `${s.ours.player.name} moves in after his kickoff`);
		if (s.host)
			assert.ok(!locked(s.host, now), `${s.host.player.name} moves out after his kickoff`);
	}
	// The web's own hold has nothing to undo: the engine already holds the locked rows.
	assert.equal(heldLineup(monday.lineup, now), monday.lineup);
	assert.equal(monday.lineup.week_done, null);
	// The bug and the lineup card print one figure for the drafter's side.
	const mine = monday.scoreboard.games[0]?.sides.find((s) => s.roster_id === sync.me);
	assert.equal(monday.lineup.team_points, mine?.points);
});

void test('on Tuesday every game is final, the lineup is set and the week is in the books', () => {
	const tuesday = at(FIXTURE_TUESDAY_CLOCK);
	assert.ok(tuesday.scoreboard.games.every((g) => g.state === 'final' && g.next_kickoff === null));
	assert.equal(tuesday.lineup.set, true);
	assert.ok(tuesday.lineup.slots.every((s) => !s.changed));
	assert.equal(
		tuesday.lineup.week_done,
		"Every starter's game is final, so week 6 is in the books."
	);
});
