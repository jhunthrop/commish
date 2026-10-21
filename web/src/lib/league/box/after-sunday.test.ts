// The fixture's week after its Sunday (Lane 85): the Monday and Tuesday reads the stand-in API serves,
// as the API would answer them at those clocks. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	FIXTURE_MONDAY_CLOCK,
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_STATS_CLOCK,
	FIXTURE_TUESDAY_CLOCK,
	FIXTURE_WEEK_CLOCK
} from '../../../../scripts/inseason-fixture/clock.ts';
import { lateFinals, stamped } from '../../../../scripts/inseason-fixture/game-state.ts';
import { linesOf, recordedMatchups } from '../../../../scripts/inseason-fixture/scoreboard-at.ts';
import {
	afterSundayOf,
	WEEK_DONE,
	WEEK_DONE_KICKED_OFF
} from '../../../../scripts/inseason-fixture/sunday.ts';
import { inTenths } from '../../../../scripts/inseason-fixture/tenths.ts';
import { ffpcAfterSunday } from '../../../../scripts/inseason-fixture/ffpc.ts';
import { platformed, platformGames } from '../../../../scripts/inseason-fixture/platform-games.ts';
import type { LeagueSync } from '../api.ts';
import type {
	LineupAdvice,
	MatchupBox,
	Scoreboard,
	TradeAdvice,
	WaiverAdvice
} from '../inseason/api.ts';
import {
	bugsFinalNone,
	bugsMissFinal,
	bugsOf,
	lineupSummary,
	type Bug,
	type BugSide
} from '../home/home.ts';
import { BOX, teamSmallFigure } from './box.ts';
import { gameHead } from './kickoff.ts';
import { changesTitle, heldLineup, lineupBox, lineupSum, locked } from './lineup.ts';
import { bugFigures, sideBox, sideScore } from './matchup.ts';

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

void test('while a starter still plays the Lineup strip says Proj final beside the moving Pts, the Matchup figure (Lane 118, B88)', () => {
	const now = Date.parse(FIXTURE_MONDAY_NIGHT_CLOCK);
	const night = at(FIXTURE_MONDAY_NIGHT_CLOCK);
	const box = lineupBox(night.lineup, ZONE, now);
	assert.equal(box.playing, true);
	const final = night.lineup.projected_final ?? null;
	assert.ok(final !== null, 'the stand-in gives the lineup its projected final');
	const sum = lineupSum(box, 'sleeper', night.lineup.week_done ?? null);
	assert.ok(sum !== null);
	assert.equal(sum.words, `${BOX.pts} as set on Sleeper`);
	assert.equal(sum.final, `${BOX.projFinal} ${final.toFixed(1)}`);
	// Every starter final on Tuesday: the Pts stand alone, nothing left to project.
	const tuesday = at(FIXTURE_TUESDAY_CLOCK);
	const done = lineupBox(tuesday.lineup, ZONE, Date.parse(FIXTURE_TUESDAY_CLOCK));
	assert.equal(done.playing, false);
	assert.equal(lineupSum(done, 'sleeper', tuesday.lineup.week_done ?? null)?.final ?? null, null);
	// Saturday, before any kickoff: the Proj sum, no Proj final.
	const saturday = lineupBox(lineup, ZONE, Date.parse(FIXTURE_WEEK_CLOCK));
	assert.equal(saturday.playing, false);
	assert.equal(lineupSum(saturday, 'sleeper', null)?.final ?? null, null);
});

void test("the Team row's small cell reads Proj final while a starter plays, Final with the total once all are (Lane 121, B99)", () => {
	const night = at(FIXTURE_MONDAY_NIGHT_CLOCK);
	const playing = lineupBox(night.lineup, ZONE, Date.parse(FIXTURE_MONDAY_NIGHT_CLOCK)).totals;
	assert.equal(teamSmallFigure(playing)?.caption, BOX.projFinal);
	const now = Date.parse(FIXTURE_TUESDAY_CLOCK);
	const tuesday = at(FIXTURE_TUESDAY_CLOCK);
	const box = lineupBox(tuesday.lineup, ZONE, now);
	assert.equal(box.totals.allFinal, true);
	assert.deepEqual(teamSmallFigure(box.totals), { caption: BOX.final, figure: box.totals.pts });
	// The league home's lineup card draws the same cell, by the same rule.
	const card = lineupSummary(
		tuesday.lineup,
		ZONE,
		now,
		tuesday.lineup.projected_final ?? null,
		true
	);
	assert.deepEqual(teamSmallFigure(card.totals), { caption: BOX.final, figure: card.totals.pts });
	// Saturday, before any kickoff: no small figure, the Proj is the big one.
	assert.equal(
		teamSmallFigure(lineupBox(lineup, ZONE, Date.parse(FIXTURE_WEEK_CLOCK)).totals),
		null
	);
});

void test("Monday night: one predicate for a side's Final on the Matchup, the home bug and the Team row (Lane 121 fix round 1, HIGH-1)", () => {
	const now = Date.parse(FIXTURE_MONDAY_NIGHT_CLOCK);
	const night = at(FIXTURE_MONDAY_NIGHT_CLOCK);
	const bugs: Bug[] = bugsOf(night.scoreboard, night.sync, now, ZONE);
	const [bug] = bugs;
	assert.ok(bug);
	const read = { hostTotal: null, landed: true, week: night.matchup.week, now, started: true };
	const said = new Map<number, string>();
	for (const box of night.matchup.sides) {
		const side =
			night.sync.matchup?.mine.roster_id === box.roster_id
				? night.sync.matchup.mine
				: night.sync.matchup?.opponent;
		assert.ok(side);
		const team = sideBox(side, box, read, ZONE).totals;
		const home: BugSide | undefined = bug.sides.find((s) => s.rosterId === box.roster_id);
		assert.ok(home);
		// The Team row, the Matchup bug and the home bug call the side final alike.
		assert.equal(team.allFinal, home.final, `roster ${String(box.roster_id)}`);
		const matchupBug = bugFigures(team, true).small;
		said.set(box.roster_id, matchupBug);
		assert.equal(matchupBug.startsWith(BOX.final), home.final);
		const drawn: boolean =
			bug.columns.small === BOX.final ? true : home.small.startsWith(BOX.final);
		assert.equal(drawn, home.final);
	}
	// The fixture's Monday night holds one side done and one still playing: both forms are drawn.
	assert.deepEqual([...said.values()].map((s) => s.startsWith(BOX.final)).sort(), [false, true]);
	// An FFPC opponent with no box under a Final head reads Final --, never Proj final --.
	const opponent = night.sync.matchup?.opponent;
	assert.ok(opponent);
	const ffpc = sideBox(opponent, null, { ...read, headFinal: true }, ZONE).totals;
	assert.equal(bugFigures({ ...ffpc, pts: null }, true).small, `${BOX.final} ${BOX.none}`);
	assert.deepEqual(teamSmallFigure({ ...ffpc, pts: null }), { caption: BOX.final, figure: null });
	// Under a head still in play it follows the head: Proj final.
	const live = sideBox(opponent, null, { ...read, headFinal: false }, ZONE).totals;
	assert.equal(teamSmallFigure(live)?.caption, BOX.projFinal);
});

void test('Tuesday in an FFPC league: the opponent it lists no starters for reads Final on the Matchup and the home alike (Lane 121 fix round 2, HIGH-2)', () => {
	const now = Date.parse(FIXTURE_TUESDAY_CLOCK);
	const week = ffpcAfterSunday(at(FIXTURE_TUESDAY_CLOCK));
	const me = week.sync.me;
	const game = week.scoreboard.games.find((g) => g.sides.some((s) => s.roster_id === me));
	assert.ok(game);
	assert.equal(game.state, 'final');
	const hidden = game.sides.find((s) => s.roster_id !== me);
	assert.ok(hidden);
	// The API sends no starters_final for a side it lists no starters for: the web reads the game.
	assert.equal(hidden.starters_final, undefined);
	assert.equal(hidden.starters, 0);
	const bugs: Bug[] = bugsOf(week.scoreboard, week.sync, now, ZONE);
	const bug = bugs.find((b) => b.sides.some((s) => s.rosterId === me));
	assert.ok(bug);
	const home: BugSide | undefined = bug.sides.find((s) => s.rosterId === hidden.roster_id);
	assert.ok(home);
	assert.equal(home.final, true);
	assert.equal(bug.columns.small, BOX.final);
	// Nothing on the home says a Proj final is missing: the side is final.
	assert.equal(bugsMissFinal(bugs), false);
	// The Matchup: the opponent's box holds no starters, so it follows the bug's Final head.
	const box = week.matchup.sides.find((s) => s.roster_id === hidden.roster_id);
	const opponent = week.sync.matchup?.opponent;
	assert.ok(opponent);
	assert.equal(box?.starters.length ?? 0, 0);
	const read = {
		hostTotal: null,
		landed: true,
		week: week.matchup.week,
		now,
		started: true,
		headFinal: true
	};
	const team = sideBox(opponent, box ?? null, read, ZONE).totals;
	assert.equal(team.allFinal, home.final);
	assert.ok(bugFigures(team, true).small.startsWith(BOX.final));
	// A Final with no total says why, on both surfaces.
	if (team.pts === null) assert.equal(bugFigures(team, true).small, `${BOX.final} ${BOX.none}`);
	if (home.small === BOX.none) assert.equal(bugsFinalNone(bugs), true);
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

void test("from Monday a Sunday starter's Avg, Last and GP count the platform's points (Lane 111, B23)", () => {
	const before = [
		...lineup.slots.flatMap((s) => (s.host ? [s.ours, s.host] : [s.ours])),
		...lineup.bench
	];
	for (const clock of [FIXTURE_MONDAY_CLOCK, FIXTURE_TUESDAY_CLOCK]) {
		const week = at(clock);
		const shown = platformed(week.lineup, platformGames(sync.host, week, Date.parse(clock)));
		const counted = shown.slots
			.map((s) => s.ours)
			.filter((l) => l.facts.last_games[0]?.source === 'platform');
		assert.ok(counted.length > 0, `${clock}: no starter counts his Sunday final`);
		for (const line of counted) {
			const was = before.find((b) => b.player.host_id === line.player.host_id);
			const newest = line.facts.last_games[0];
			assert.ok(was && newest, line.player.name);
			assert.equal(newest.week, line.facts.week);
			assert.equal(line.last_points, newest.points);
			assert.equal(line.games_played, (was.games_played ?? was.facts.last_games.length) + 1);
		}
		// Sunday morning nothing is final, so nothing is counted.
		const saturday = platformGames(sync.host, { lineup, matchup }, Date.parse(clock));
		assert.equal(saturday.size, 0);
	}
});

void test('from Wednesday evening our stats hold the week, so no row is the platform points', () => {
	const week = at(FIXTURE_STATS_CLOCK);
	const shown = platformed(
		week.lineup,
		platformGames(sync.host, week, Date.parse(FIXTURE_STATS_CLOCK))
	);
	const newest = shown.slots.flatMap((s) => s.ours.facts.last_games.slice(0, 1));
	assert.ok(newest.some((g) => g.week === sync.week && g.source === 'stats'));
	assert.ok(newest.every((g) => g.source !== 'platform'));
});

void test("a Yahoo league's lines carry no platform points, so none is counted", () => {
	const week = at(FIXTURE_MONDAY_CLOCK);
	assert.equal(platformGames('yahoo', week, Date.parse(FIXTURE_MONDAY_CLOCK)).size, 0);
});
