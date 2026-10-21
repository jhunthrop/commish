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
	momentAt,
	WEEK_DONE,
	WEEK_DONE_KICKED_OFF
} from '../../../../scripts/inseason-fixture/sunday.ts';
import { inTenths } from '../../../../scripts/inseason-fixture/tenths.ts';
import { FFPC_ROSTERLESS, ffpcAfterSunday } from '../../../../scripts/inseason-fixture/ffpc.ts';
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
	bugsMissFinal,
	bugsMissListedFinal,
	bugsOf,
	unlistedDrawn,
	lineupSummary,
	type Bug,
	type BugSide
} from '../home/home.ts';
import { BOX, teamSmallFigure } from './box.ts';
import { gameHead, KICKOFF } from './kickoff.ts';
import { changesTitle, heldLineup, lineupBox, lineupSum, locked } from './lineup.ts';
import {
	bugFigures,
	decidedHead,
	matchupFinal,
	nextKickoff,
	sideBox,
	sideScore,
	unlistedStates
} from './matchup.ts';

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
const week6 = week;
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

/** The FFPC stand-in at a clock (Lane 121 fix round 2, Lane 124): the week as the stand-in API sends it,
 * the opponent unlisted, his state by his roster's games; `late` clubs' finals not held yet. */
function ffpcAt(clock: string, late?: ReadonlySet<string>): ReturnType<typeof ffpcAfterSunday> {
	const now = Date.parse(clock);
	const week = stamped(
		afterSundayOf({ sync, lineup, matchup }, week6, now, clock, late),
		now,
		late
	) as ReturnType<typeof afterSundayOf>;
	return ffpcAfterSunday(week, momentAt(now, late), week6);
}

/** What the member's FFPC game reads at a clock on the home and the Matchup, side by side. */
function ffpcScreens(clock: string, late?: ReadonlySet<string>) {
	const now = Date.parse(clock);
	const week = ffpcAt(clock, late);
	const me = week.sync.me;
	const game = week.scoreboard.games.find((g) => g.sides.some((s) => s.roster_id === me));
	assert.ok(game);
	const hidden = game.sides.find((s) => s.roster_id !== me);
	assert.ok(hidden);
	// The API sends no starters_final for a side it lists no starters for, its schedule_state instead.
	assert.equal(hidden.starters_final, undefined);
	assert.equal(hidden.starters, 0);
	const bugs: Bug[] = bugsOf(week.scoreboard, week.sync, now, ZONE);
	const bug = bugs.find((b) => b.sides.some((s) => s.rosterId === me));
	assert.ok(bug);
	const home = bug.sides.find((s) => s.rosterId === hidden.roster_id);
	const homeMine = bug.sides.find((s) => s.rosterId === me);
	assert.ok(home && homeMine);
	const box = week.matchup.sides.find((s) => s.roster_id === hidden.roster_id);
	const opponent = week.sync.matchup?.opponent;
	assert.ok(box && opponent);
	// FFPC's rosters page carries the opponent's roster: his box lists no starters, his players benched.
	assert.equal(box.starters.length, 0);
	assert.ok(box.bench.length > 0);
	// No starter of his to count while the game plays.
	assert.equal(box.to_play ?? null, null);
	const lines = week.matchup.sides.flatMap((s) => s.starters.map((st) => st.line));
	const unlisted = unlistedStates(week.matchup);
	const headFinal = matchupFinal(lines, now, unlisted);
	const read = {
		hostTotal: null,
		landed: true,
		week: week.matchup.week,
		now,
		started: true,
		headFinal
	};
	const team = sideBox(opponent, box, read, ZONE).totals;
	const card = lineupSummary(week.lineup, ZONE, now);
	return {
		state: game.state,
		schedule: hidden.schedule_state,
		bugHead: bug.head,
		column: bug.columns.small,
		homeFinal: home.final,
		homeMineFinal: homeMine.final,
		homeSmall: home.small,
		missFinal: bugsMissFinal(bugs),
		// The bug's middle as the Matchup draws it, Decided where the API says so (it says none here).
		matchupHead:
			decidedHead(nextKickoff(lines, now, ZONE, unlisted), week.matchup.decided === true, true)
				?.head ?? null,
		headFinal,
		teamFinal: team.allFinal,
		teamSmall: bugFigures(team, true).small,
		title: card.done === null ? null : changesTitle(0, card.done, card.doneState)
	};
}

void test('Tuesday in an FFPC league: the opponent it lists no starters for reads Final on the Matchup and the home alike (Lane 121 fix round 2, HIGH-2)', () => {
	const got = ffpcScreens(FIXTURE_TUESDAY_CLOCK);
	assert.equal(got.state, 'final');
	assert.equal(got.schedule, 'final');
	assert.equal(got.homeFinal, true);
	assert.equal(got.column, BOX.final);
	// Nothing on the home says a Proj final is missing: the side is final.
	assert.equal(got.missFinal, false);
	assert.equal(got.headFinal, true);
	assert.equal(got.matchupHead, KICKOFF.final);
	assert.equal(got.teamFinal, got.homeFinal);
	assert.ok(got.teamSmall.startsWith(BOX.final));
	assert.equal(got.title, BOX.final);
});

void test("B102: an FFPC opponent with no box keeps his game state from his roster's games while the member's side is done (Lane 124)", () => {
	// Tuesday with LV at BUF's final not held: every starter of the member's final, the opponent's Cook
	// (BUF) still playing, and FFPC lists the opponent no starters.
	const late = ffpcScreens(FIXTURE_TUESDAY_CLOCK, lateFinals('LV,BUF'));
	assert.equal(late.state, 'playing');
	assert.equal(late.schedule, 'kicked_off');
	assert.equal(late.homeMineFinal, true);
	assert.equal(late.homeFinal, false);
	assert.equal(late.bugHead, KICKOFF.kickedOff);
	assert.equal(late.column, BOX.projFinal);
	// The Matchup's head is Kicked off, never Final, and the opponent reads Proj final --.
	assert.equal(late.headFinal, false);
	assert.equal(late.matchupHead, KICKOFF.kickedOff);
	assert.equal(late.teamFinal, false);
	assert.equal(late.teamSmall, `${BOX.projFinal} ${BOX.none}`);
	assert.equal(late.homeSmall, BOX.none);
	assert.equal(late.missFinal, true);
	assert.equal(late.title, BOX.locked);
	// Monday night, the Monday game under way with a player on each roster: both still play.
	const night = ffpcScreens(FIXTURE_MONDAY_NIGHT_CLOCK);
	assert.equal(night.state, 'playing');
	assert.equal(night.schedule, 'kicked_off');
	assert.equal(night.homeFinal, false);
	assert.equal(night.matchupHead, KICKOFF.kickedOff);
	assert.equal(night.teamSmall, `${BOX.projFinal} ${BOX.none}`);
	assert.equal(night.title, BOX.locked);
});

/** The clubs whose week 6 game is still on at each clock: SF at WSH on Monday night, LV at BUF on the
 * late Tuesday (its final not held), none after. */
const STILL_ON = {
	monday: new Set(['SF', 'WSH']),
	late: new Set(['LV', 'BUF']),
	none: new Set<string>()
};

/** A side's schedule_state read from the recorded week, not the stand-in: by the clubs its roster's
 * lines meet where FFPC carries the roster, else by the week, kicked off while a club `on` plays. */
function wantSchedule(rosterId: number, on: ReadonlySet<string>): 'kicked_off' | 'final' {
	if (FFPC_ROSTERLESS.has(rosterId)) return on.size > 0 ? 'kicked_off' : 'final';
	const players = week6.matchups.find((m) => m.roster_id === rosterId)?.players ?? [];
	const plays = players.some((id) => {
		const facts = week6.lines.get(id)?.facts;
		return facts?.opponent != null && on.has(facts.opponent);
	});
	return plays ? 'kicked_off' : 'final';
}

void test('B104: every other FFPC game reads by the schedule on the home, each side by its roster or the week (Lane 125)', () => {
	const clocks = [
		{ clock: FIXTURE_MONDAY_NIGHT_CLOCK, on: STILL_ON.monday, late: undefined },
		{ clock: FIXTURE_TUESDAY_CLOCK, on: STILL_ON.late, late: lateFinals('LV,BUF') },
		{ clock: FIXTURE_TUESDAY_CLOCK, on: STILL_ON.none, late: undefined },
		{ clock: FIXTURE_STATS_CLOCK, on: STILL_ON.none, late: undefined }
	];
	for (const { clock, on, late } of clocks) {
		const at = `${clock}${late ? ' late' : ''}`;
		const now = Date.parse(clock);
		const week = ffpcAt(clock, late);
		const bugs = bugsOf(week.scoreboard, week.sync, now, ZONE);
		const others = week.scoreboard.games.filter(
			(g) => !g.sides.some((s) => s.roster_id === sync.me)
		);
		assert.equal(others.length, 5, at);
		/** Each form a side of the roster rule and of the week's draws. */
		const forms = new Set<string>();
		const ruleOf = (rosterId: number): string =>
			FFPC_ROSTERLESS.has(rosterId) ? 'week' : 'roster';
		for (const game of others) {
			const bug = bugs.find((b) =>
				b.sides.every((s, i) => s.rosterId === game.sides[i]?.roster_id)
			);
			assert.ok(bug, at);
			const states = game.sides.map((side) => {
				// FFPC lists no starters on either side: no count, no Proj final, its total; its Proj our
				// best lineup from its roster where the page carries one, none without (Lane 127).
				assert.equal(side.starters, 0, at);
				assert.equal(side.starters_final, undefined, at);
				const roster = !FFPC_ROSTERLESS.has(side.roster_id);
				assert.equal(side.projection_best_lineup, roster ? true : undefined, at);
				if (!roster) assert.equal(side.projection, null, at);
				assert.equal(side.projected_final, null, at);
				assert.equal(side.to_play, null, at);
				assert.equal(
					side.schedule_state,
					wantSchedule(side.roster_id, on),
					`${at} ${String(side.roster_id)}`
				);
				return side.schedule_state;
			});
			const final = states.every((s) => s === 'final');
			assert.equal(game.to_play, null, at);
			assert.equal(game.next_kickoff, null, at);
			// The head: Final once both sides are, Kicked off before; the column with it.
			assert.equal(bug.head, final ? KICKOFF.final : KICKOFF.kickedOff, at);
			assert.equal(bug.columns.small, final ? BOX.final : BOX.projFinal, at);
			for (const [i, side] of bug.sides.entries()) {
				const wire = game.sides[i];
				assert.ok(wire);
				const pts = wire.points.toFixed(1);
				forms.add(`${ruleOf(wire.roster_id)} ${side.final ? 'final' : 'playing'}`);
				assert.equal(side.final, wire.schedule_state === 'final', at);
				assert.equal(side.big, pts, at);
				assert.equal(side.toPlay, '', at);
				// Final with its total, said Final under a Proj final head; "--" while it plays.
				const small = final ? pts : side.final ? `${BOX.final} ${pts}` : BOX.none;
				assert.equal(side.small, small, `${at} ${String(wire.roster_id)}`);
			}
		}
		// Both rules draw on every clock. While a game is on, the roster rule draws a side done and a
		// side still playing, the week's every side playing; after it, every side final.
		const want =
			on.size > 0
				? ['roster final', 'roster playing', 'week playing']
				: ['roster final', 'week final'];
		assert.deepEqual([...forms].sort(), want, at);
		// The home's footer says the unlisted sides once, by their own sentence, never the starters key:
		// the member's starters all hold a Proj.
		assert.equal(unlistedDrawn(bugs).noProjFinal, on.size > 0, at);
		assert.equal(bugsMissListedFinal(bugs), false, at);
	}
});

void test('an answer without schedule_state reads as before: the side follows the head, the home the game (Lane 124)', () => {
	const now = Date.parse(FIXTURE_TUESDAY_CLOCK);
	const week = ffpcAt(FIXTURE_TUESDAY_CLOCK, lateFinals('LV,BUF'));
	const me = week.sync.me;
	const older = {
		...week.scoreboard,
		games: week.scoreboard.games.map((g) => ({
			...g,
			sides: g.sides.map((s) => {
				const rest = { ...s };
				delete rest.schedule_state;
				return rest;
			})
		}))
	};
	const bug = bugsOf(older, week.sync, now, ZONE).find((b) =>
		b.sides.some((s) => s.rosterId === me)
	);
	assert.equal(bug?.sides.find((s) => s.rosterId !== me)?.final, false);
	const box = week.matchup.sides.find((s) => s.roster_id !== me);
	const opponent = week.sync.matchup?.opponent;
	assert.ok(box && opponent);
	const rest = { ...box };
	delete rest.schedule_state;
	const read = { hostTotal: null, landed: true, week: 6, now, started: true, headFinal: true };
	assert.equal(sideBox(opponent, rest, read, ZONE).totals.allFinal, true);
	assert.equal(matchupFinal([], now, unlistedStates({ sides: [rest] })), false);
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
