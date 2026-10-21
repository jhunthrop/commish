// The fixture's week after its Sunday (Lane 85): the Monday and Tuesday reads the stand-in API serves,
// as the API would answer them at those clocks. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	FIXTURE_MONDAY_CLOCK,
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_TUESDAY_CLOCK
} from '../../../../scripts/inseason-fixture/clock.ts';
import { lateFinals, stamped } from '../../../../scripts/inseason-fixture/game-state.ts';
import { linesOf, recordedMatchups } from '../../../../scripts/inseason-fixture/scoreboard-at.ts';
import {
	afterSundayOf,
	WEEK_DONE,
	WEEK_DONE_KICKED_OFF
} from '../../../../scripts/inseason-fixture/sunday.ts';
import { inTenths } from '../../../../scripts/inseason-fixture/tenths.ts';
import type { LeagueSync } from '../api.ts';
import type {
	LineupAdvice,
	MatchupBox,
	Scoreboard,
	TradeAdvice,
	WaiverAdvice
} from '../inseason/api.ts';
import { lineupSummary } from '../home/home.ts';
import { BOX } from './box.ts';
import { gameHead } from './kickoff.ts';
import { changesTitle, heldLineup, locked } from './lineup.ts';
import { sideScore } from './matchup.ts';

const data = (name: string): unknown =>
	inTenths(
		JSON.parse(
			readFileSync(
				new URL(`../../../../scripts/inseason-fixture/data/${name}.json`, import.meta.url),
				'utf8'
			)
		)
	);
const ZONE = 'America/Chicago';
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
	assert.deepEqual(heldLineup(monday.lineup, now), { ...monday.lineup, held_empty: [] });
	assert.equal(monday.lineup.week_done, null);
	// The bug and the lineup card print one figure for the drafter's side.
	const mine = monday.scoreboard.games[0]?.sides.find((s) => s.roster_id === sync.me);
	assert.equal(monday.lineup.team_points, mine?.points);
});

void test('on Tuesday every game is final, the lineup is set and the matchup is Final', () => {
	const tuesday = at(FIXTURE_TUESDAY_CLOCK);
	assert.ok(tuesday.scoreboard.games.every((g) => g.state === 'final' && g.next_kickoff === null));
	assert.equal(tuesday.lineup.set, true);
	assert.ok(tuesday.lineup.slots.every((s) => !s.changed));
	assert.equal(tuesday.lineup.week_done, WEEK_DONE);
	assert.equal(tuesday.lineup.week_done_state, 'final');
	const card = lineupSummary(tuesday.lineup, ZONE, Date.parse(FIXTURE_TUESDAY_CLOCK));
	assert.equal(changesTitle(0, card.done, card.doneState), BOX.final);
});

void test("every starter of the member's final, the opponent's still playing: Locked, not Final (Lane 91)", () => {
	// The capture has not held LV at BUF's final: the opponent's Cook still plays.
	const late = lateFinals('LV,BUF');
	const now = Date.parse(FIXTURE_TUESDAY_CLOCK);
	const tuesday = stamped(
		afterSundayOf({ sync, lineup, matchup }, week, now, FIXTURE_TUESDAY_CLOCK, late),
		now,
		late
	) as ReturnType<typeof afterSundayOf>;
	const mine = tuesday.scoreboard.games[0];
	assert.equal(mine?.sides[0]?.roster_id, sync.me);
	assert.equal(mine.state, 'playing');
	assert.ok(
		tuesday.lineup.slots.every((s) => s.ours.facts.bye || s.ours.facts.game_state === 'final')
	);
	assert.equal(tuesday.lineup.week_done, WEEK_DONE);
	assert.equal(tuesday.lineup.week_done_state, 'locked');
	const card = lineupSummary(tuesday.lineup, ZONE, now);
	assert.equal(changesTitle(0, card.done, card.doneState), BOX.locked);
	// Monday, a starter of the member's still to play: no sentence, no state.
	const monday = at(FIXTURE_MONDAY_CLOCK);
	assert.equal(monday.lineup.week_done, null);
	assert.equal(monday.lineup.week_done_state ?? null, null);
});

void test("Monday night, the member's last starter in play: Locked from the last kickoff, says kicked off (Lane 109)", () => {
	const now = Date.parse(FIXTURE_MONDAY_NIGHT_CLOCK);
	const night = at(FIXTURE_MONDAY_NIGHT_CLOCK);
	const games = night.lineup.slots.filter(
		(s) => !s.ours.facts.bye && s.ours.facts.kickoff !== null
	);
	assert.ok(games.every((s) => s.ours.facts.game_state !== 'upcoming'));
	assert.ok(
		games.some((s) => s.ours.facts.game_state === 'kicked_off'),
		"a starter of the member's still in play"
	);
	assert.equal(night.lineup.week_done, WEEK_DONE_KICKED_OFF);
	assert.equal(night.lineup.week_done_state, 'locked');
	assert.ok(
		night.lineup.slots.every((s) => !s.changed),
		'nothing is left to set'
	);
	const card = lineupSummary(night.lineup, ZONE, now);
	assert.equal(changesTitle(0, card.done, card.doneState), BOX.locked);
});

void test('the scoreboard and the Matchup print one figure for each side, its rows added (review M2)', () => {
	for (const clock of [FIXTURE_MONDAY_CLOCK, FIXTURE_TUESDAY_CLOCK]) {
		const week = at(clock);
		const bugs: Scoreboard['games'][number]['sides'] = week.scoreboard.games[0]?.sides ?? [];
		assert.ok(bugs.length > 0);
		for (const side of week.matchup.sides) {
			const rows = side.starters.map((s) => ({ pts: s.line.facts.points_this_week }));
			const team = sideScore(rows, side, null);
			const bug = bugs.find((s) => s.roster_id === side.roster_id);
			assert.equal(bug?.points, team, `${clock} roster ${String(side.roster_id)}`);
		}
	}
});
