// The League page's words (Lane 66i): the scoreboard's bugs, the standings' columns and order, the
// moves feed, the settings and the basis, with the copy guard over every one. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { LeagueMove, LeagueTeam, LeagueTerms } from '../api.ts';
import type { LineupAdvice, PlayerLine, Scoreboard } from '../inseason/api.ts';
import { WEEK_DONE } from '../../../../scripts/inseason-fixture/sunday.ts';
import { KICKOFF } from '../box/kickoff.ts';
import { BOX } from '../box/box.ts';
import { changesTitle } from '../box/lineup.ts';
import {
	HOME,
	bugsFinalNone,
	bugsMissFinal,
	bugsMissListedFinal,
	bugsOf,
	bugsPlaying,
	bugsPlayingListed,
	unlistedDrawn,
	sideFinal,
	projectedFinalOf,
	readCell,
	lineupSummary,
	extraWords,
	feedRows,
	playoffRule,
	seedingWords,
	projections,
	recordCell,
	ruleFigure,
	scoringLead,
	scoringView,
	settingsLink,
	shapeView,
	sortStandings,
	standingsBasis,
	standingsRows,
	teamBasis,
	termsView,
	unstatedWords,
	movesBasis,
	waiverCell,
	waiverColumn
} from './home.ts';

const ZONE = 'America/Chicago';
/** The fixture's Saturday, before Sunday's games (clock.ts FIXTURE_WEEK_CLOCK). */
const SATURDAY = Date.parse('2026-10-17T17:00:00.000Z');
/** The Monday after, every Sunday kickoff past (FIXTURE_MONDAY_CLOCK). */
const MONDAY = Date.parse('2026-10-19T16:00:00.000Z');

const team = (id: number, over: Partial<LeagueTeam> = {}): LeagueTeam => ({
	roster_id: id,
	name: `Team ${String(id)}`,
	owner: `owner${String(id)}`,
	wins: 3,
	losses: 2,
	ties: 0,
	points_for: 600,
	points_against: 580,
	streak: 'W1',
	waiver_order: id,
	waiver_budget_left: 1000 - id * 10,
	avatar: null,
	...over
});

const RULES = {
	points_per_passing_yard: 0.04,
	points_per_passing_touchdown: 5,
	points_per_interception: -1,
	points_per_rushing_yard: 0.1,
	points_per_rushing_touchdown: 6,
	points_per_receiving_yard: 0.1,
	points_per_receiving_touchdown: 6,
	points_per_reception: 1,
	points_per_fumble_lost: -2,
	te_reception_bonus: 0.5,
	points_per_field_goal: 3,
	points_per_extra_point: 1,
	points_per_sack: 1,
	points_per_defensive_interception: 2,
	points_per_defensive_touchdown: 6,
	points_per_two_point_conversion: 2,
	points_per_field_goal_missed: -1,
	points_per_extra_point_missed: -1,
	points_per_return_touchdown: 6,
	points_per_defensive_fumble_recovery: 2,
	points_per_safety: 2,
	points_per_field_goal_40_49: 4,
	points_per_field_goal_50_plus: 5,
	points_allowed_0: 10,
	points_allowed_1_6: 7,
	points_allowed_7_13: 4,
	points_allowed_14_17: 1,
	points_allowed_18_20: 1,
	points_allowed_21: 0,
	points_allowed_22_27: 0,
	points_allowed_28_34: -1,
	points_allowed_35_45: -4,
	points_allowed_46_plus: -4,
	yards_allowed_0_99: 0,
	yards_allowed_100_199: 0,
	yards_allowed_200_299: 0,
	yards_allowed_300_349: 0,
	yards_allowed_350_399: 0,
	yards_allowed_400_449: 0,
	yards_allowed_450_499: 0,
	yards_allowed_500_549: 0,
	yards_allowed_550_plus: 0
};

const TERMS: LeagueTerms = {
	waivers: 'budget',
	waiver_budget: 1000,
	playoff_teams: 6,
	playoff_weeks: { first: 15, last: 17 },
	roster: { qb: 1, rb: 2, wr: 3, te: 1, flex: 2, super_flex: 0, k: 0, def: 1, bench: 10 },
	scoring: RULES,
	scoring_unstated: [],
	scoring_extra: [{ group: 'defense', rule: 'blocked kick', points: 2 }],
	host_settings_url: 'https://sleeper.com/leagues/1'
};

const side = (
	id: number,
	points: number,
	projection: number | null = 90
): Scoreboard['games'][number]['sides'][number] => ({
	roster_id: id,
	points,
	points_read: true,
	projection,
	starters: 10,
	played: 4
});

const board = (state: Scoreboard['games'][number]['state']): Scoreboard => ({
	week: 6,
	read_at: '2026-10-18T18:52:00.000Z',
	projection_read_at: '2026-10-17T02:00:00.000Z',
	projection_scoring: { format: 'ppr', league_own: false },
	games: [
		{
			state,
			next_kickoff: state === 'final' ? null : '2026-10-18T20:25:00.000Z',
			// The API's pooled count (words.go ToPlayWords), which the bug no longer prints.
			to_play: state === 'playing' ? '3 to play' : null,
			sides: [
				// Each side's own count and projected final (Lane 92), only while under way.
				{
					...side(1, 62.1, 87),
					to_play: state === 'playing' ? '2 playing' : null,
					projected_final: state === 'upcoming' ? null : 70.4
				},
				{ ...side(2, 71.4, null), to_play: state === 'playing' ? '3 to play' : null }
			]
		}
	]
});

const SYNC = { teams: [team(1), team(2, { ties: 1, avatar: 'https://sleepercdn.com/x' })], me: 1 };

void test('a bug before kickoff names the next kickoff and draws both sides alike', () => {
	const [bug] = bugsOf(board('upcoming'), SYNC, SATURDAY, ZONE);
	assert.ok(bug);
	assert.equal(bug.head, 'Sun 3:25 pm');
	assert.equal(bug.words, HOME.nextKickoff);
	// Before the first kickoff the Proj is the big figure (Lane 92, B22), nothing small beside it.
	assert.deepEqual(bug.columns, { small: '', big: 'Proj' });
	assert.deepEqual(
		bug.sides.map((s) => [s.name, s.record, s.small, s.big, s.toPlay, s.stands, s.me]),
		[
			['Team 1', '3-2', '', '87.0', '', 'level', true],
			['Team 2', '3-2-1', '', '--', '', 'level', false]
		]
	);
	assert.ok(bug.mine);
});

void test('once a game has started the side ahead is bright and the side behind muted', () => {
	for (const state of ['playing', 'final'] as const) {
		const [bug] = bugsOf(board(state), SYNC, SATURDAY, ZONE);
		assert.ok(bug);
		assert.deepEqual(
			bug.sides.map((s) => [s.big, s.stands]),
			[
				['62.1', 'behind'],
				['71.4', 'ahead']
			]
		);
	}
	// From the first kickoff the Pts are big, the projected final small ("--" with none).
	const [under] = bugsOf(board('playing'), SYNC, SATURDAY, ZONE);
	assert.ok(under);
	assert.deepEqual(under.columns, { small: BOX.projFinal, big: BOX.pts });
	assert.deepEqual(
		under.sides.map((s) => s.small),
		['70.4', '--']
	);
	// Once final (Lane 121, B99), the Team row's rule: Final over each side's total, never a projection.
	const [done] = bugsOf(board('final'), SYNC, SATURDAY, ZONE);
	assert.ok(done);
	assert.deepEqual(done.columns, { small: BOX.final, big: BOX.pts });
	assert.deepEqual(
		done.sides.map((s) => s.small),
		['62.1', '71.4']
	);
	// The key explains Proj final only while a side still plays.
	assert.equal(bugsPlaying([under, done]), true);
	assert.equal(bugsPlaying([done]), false);
	assert.equal(bugsMissFinal([done]), false);
	assert.equal(bugsFinalNone([done]), false);
	const [playing] = bugsOf(board('playing'), SYNC, SATURDAY, ZONE);
	assert.ok(playing);
	assert.equal(playing.head, KICKOFF.kickedOff);
	// Each side says where its starters stand (B02), never a pooled zero.
	assert.deepEqual(
		playing.sides.map((s) => s.toPlay),
		['2 playing', '3 to play']
	);
	assert.equal(playing.words, '');
	const [final] = bugsOf(board('final'), SYNC, SATURDAY, ZONE);
	assert.equal(final?.head, HOME.final);
	const level = board('playing');
	const game = level.games[0];
	assert.ok(game);
	game.sides.forEach((s) => {
		s.points = 40;
	});
	assert.deepEqual(
		bugsOf(level, SYNC, SATURDAY, ZONE)[0]?.sides.map((s) => s.stands),
		['level', 'level']
	);
	const unread = board('playing');
	if (unread.games[0]?.sides[1]) unread.games[0].sides[1].points_read = false;
	assert.deepEqual(
		bugsOf(unread, SYNC, SATURDAY, ZONE)[0]?.sides.map((s) => [s.big, s.stands]),
		[
			['62.1', 'level'],
			['--', 'level']
		]
	);
});

void test("a side reads Final once every one of its starters is, the Team row's predicate (Lane 121 fix round 1, HIGH-1)", () => {
	// Monday night: the opponent's starters are all final, the member's last still plays.
	const night = board('playing');
	const game = night.games[0];
	assert.ok(game);
	game.sides = game.sides.map((s, i) => ({ ...s, starters_final: i === 1 }));
	const [bug] = bugsOf(night, SYNC, SATURDAY, ZONE);
	assert.ok(bug);
	assert.deepEqual(
		bug.sides.map((s) => s.final),
		[false, true]
	);
	// The column still says Proj final for the member's side; the done side says its own Final.
	assert.equal(bug.columns.small, BOX.projFinal);
	assert.deepEqual(
		bug.sides.map((s) => s.small),
		['70.4', `${BOX.final} 71.4`]
	);
	assert.equal(bugsPlaying([bug]), true);
	// An older answer with no starters_final reads the game's state.
	assert.equal(sideFinal({}, 'final'), true);
	assert.equal(sideFinal({}, 'kicked_off'), false);
	assert.equal(sideFinal({ starters_final: true }, 'upcoming'), false);
	// A side listing no starters reads by the schedule's state, whatever the game's (Lane 124, B102).
	assert.equal(sideFinal({ schedule_state: 'final' }, 'kicked_off'), true);
	assert.equal(sideFinal({ schedule_state: 'kicked_off' }, 'kicked_off'), false);
	assert.equal(sideFinal({ schedule_state: 'final' }, 'upcoming'), false);
	// A final side whose score is unread reads Final --, and the key says why.
	const unread = board('final');
	const side = unread.games[0]?.sides[1];
	assert.ok(side);
	side.points_read = false;
	const [none] = bugsOf(unread, SYNC, SATURDAY, ZONE);
	assert.ok(none);
	assert.equal(bugsFinalNone([none]), true);
});

void test('a side FFPC lists no starters or roster for draws "--", said once by its own sentence, never the starters key (Lane 125, Lane 127 fix round 1)', () => {
	const night = board('playing');
	const game = night.games[0];
	assert.ok(game);
	// Both sides unlisted with no roster: no starters, no Proj, no Proj final.
	game.sides = game.sides.map((s, i) => ({
		...s,
		starters: 0,
		projection: null,
		projected_final: null,
		schedule_state: i === 0 ? 'kicked_off' : 'final'
	}));
	const bugs = bugsOf(night, SYNC, SATURDAY, ZONE);
	assert.deepEqual(
		bugs[0]?.sides.map((s) => [s.unlisted, s.final, s.small]),
		[
			[true, false, BOX.none],
			[true, true, `${BOX.final} 71.4`]
		]
	);
	assert.deepEqual(unlistedDrawn(bugs), {
		bestLineup: false,
		noRoster: true,
		paced: false,
		skipped: false
	});
	// The "--" is the side's with no roster: the starters keys stay unsaid, its own sentence says it,
	// on the League page and the front door alike.
	assert.equal(bugsMissFinal(bugs), true);
	assert.equal(bugsMissListedFinal(bugs), false);
	assert.equal(bugsPlayingListed(bugs), false);
	const scoring = { format: 'ppr', league_own: false, te_bonus: 0.5 } as const;
	const read = '2026-10-17T02:00:00.000Z';
	const said = teamBasis(
		'ffpc',
		read,
		scoring,
		false,
		ZONE,
		true,
		false,
		false,
		false,
		unlistedDrawn(bugs)
	);
	assert.match(said, / Teams FFPC sends no lineup or roster for read --\.$/);
	assert.doesNotMatch(said, /No Proj final while|Proj final adds|have no Proj final/);
	assert.doesNotMatch(said, BANNED);
	assert.equal(said.split('FFPC sends no lineup').length, 2, 'said once');
	// A board with every side listed says nothing of it.
	assert.deepEqual(unlistedDrawn(bugsOf(board('playing'), SYNC, SATURDAY, ZONE)), {
		bestLineup: false,
		noRoster: false,
		paced: false,
		skipped: false
	});
});

void test("a side FFPC sends no lineup for draws its roster's best lineup before and after kickoff, one sentence for both (Lane 127, fix round 1)", () => {
	const scoring = { format: 'ppr', league_own: false, te_bonus: 0.5 } as const;
	const read = '2026-10-17T02:00:00.000Z';
	const best = / Proj for teams FFPC sends no lineup for is our best lineup from their rosters\./;
	const friday = board('upcoming');
	const game = friday.games[0];
	assert.ok(game);
	// One side with a roster (its best lineup's Proj), one with none.
	game.sides = game.sides.map((s, i) => ({
		...s,
		starters: 0,
		projection: i === 0 ? 88.4 : null,
		projected_final: null,
		schedule_state: 'upcoming',
		...(i === 0 ? { projection_best_lineup: true } : {})
	}));
	const bugs = bugsOf(friday, SYNC, SATURDAY, ZONE);
	assert.deepEqual(
		bugs[0]?.sides.map((s) => [s.bestLineup, s.big]),
		[
			[true, '88.4'],
			[false, BOX.none]
		]
	);
	const drawn = unlistedDrawn(bugs);
	assert.deepEqual(drawn, { bestLineup: true, noRoster: true, paced: false, skipped: false });
	const said = teamBasis('ffpc', read, scoring, false, ZONE, false, false, false, false, drawn);
	// The team with no roster's "--" beside it, its own second sentence (Lane 137, B107 ruling 3).
	assert.match(
		said,
		new RegExp(`${best.source} Teams FFPC sends no lineup or roster for read --\\.$`)
	);
	assert.doesNotMatch(said, /Proj final/);
	assert.doesNotMatch(said, BANNED);
	// Under way: its Proj final is the best lineup's too, the same sentence, the key for what it adds.
	const night = board('playing');
	const ng = night.games[0];
	assert.ok(ng);
	ng.sides = ng.sides.map((s) => ({
		...s,
		starters: 0,
		projection: 88.4,
		projected_final: 80.1,
		projection_best_lineup: true,
		projected_final_paced: true,
		schedule_state: 'kicked_off'
	}));
	const under = bugsOf(night, SYNC, SATURDAY, ZONE);
	assert.equal(under[0]?.sides[0]?.small, '80.1');
	assert.deepEqual(unlistedDrawn(under), {
		bestLineup: true,
		noRoster: false,
		paced: true,
		skipped: false
	});
	// Both sides are the best lineup's: its sentence says their Proj final, its pace clause with it, and
	// the listed sides' key stays unsaid (fix round 3).
	assert.equal(bugsPlayingListed(under), false);
	const both = teamBasis(
		'ffpc',
		read,
		scoring,
		false,
		ZONE,
		true,
		bugsMissListedFinal(under),
		bugsPlayingListed(under),
		false,
		unlistedDrawn(under)
	);
	assert.match(
		both,
		/ Proj for teams FFPC sends no lineup for is our best lineup from their rosters, in-play players at their projection's pace\.$/
	);
	assert.doesNotMatch(both, /Proj final adds/);
	assert.equal(both.split('sends no lineup').length, 2, 'the teams said once');
	// An older answer sends no projection_best_lineup and no Proj: the teams with no roster's words.
	const older = board('upcoming');
	const og = older.games[0];
	assert.ok(og);
	og.sides = og.sides.map((s) => ({
		...s,
		starters: 0,
		projection: null,
		schedule_state: 'upcoming'
	}));
	assert.deepEqual(unlistedDrawn(bugsOf(older, SYNC, SATURDAY, ZONE)), {
		bestLineup: false,
		noRoster: true,
		paced: false,
		skipped: false
	});
});

void test('a kickoff before the page clock is never the next: the bug reads Kicked off', () => {
	// The Monday after: a read that still says upcoming with Sunday's kickoff next (a lagging read)
	// never says "Next kickoff" for a game played (sweep 3 M2).
	const [lagging] = bugsOf(board('upcoming'), SYNC, MONDAY, ZONE);
	assert.ok(lagging);
	assert.equal(lagging.head, KICKOFF.kickedOff);
	assert.equal(lagging.words, '');
	assert.equal(lagging.state, 'kicked_off');
	assert.deepEqual(
		lagging.sides.map((s) => [s.big, s.stands]),
		[
			['62.1', 'behind'],
			['71.4', 'ahead']
		]
	);
	// Under way with its next kickoff past: Kicked off, each side's starters counted.
	const [playing] = bugsOf(board('playing'), SYNC, MONDAY, ZONE);
	assert.ok(playing);
	assert.equal(playing.head, KICKOFF.kickedOff);
	assert.equal(playing.sides[1]?.toPlay, '3 to play');
	assert.equal(bugsOf(board('final'), SYNC, MONDAY, ZONE)[0]?.head, KICKOFF.final);
});

void test('a live bug says its read beside the score, short, and nothing before or after', () => {
	// Lane 92, B06: "ESPN 1 min ago" as a cell, from the league's read at the page's clock.
	const read = { host: 'espn' as const, readAt: '2026-10-18T18:52:00.000Z' };
	const at = (minutes: number) => Date.parse(read.readAt) + minutes * 60_000;
	assert.equal(bugsOf(board('playing'), SYNC, at(0.5), ZONE, read)[0]?.words, 'ESPN just now');
	assert.equal(bugsOf(board('playing'), SYNC, at(1), ZONE, read)[0]?.words, 'ESPN 1 min ago');
	assert.equal(bugsOf(board('playing'), SYNC, at(8), ZONE, read)[0]?.words, 'ESPN 8 min ago');
	assert.equal(readCell(read, at(125)), 'ESPN 2 hr ago');
	assert.equal(bugsOf(board('final'), SYNC, at(1), ZONE, read)[0]?.words, '');
	assert.equal(bugsOf(board('upcoming'), SYNC, SATURDAY, ZONE, read)[0]?.words, HOME.nextKickoff);
});

void test('the standings Proj is a team’s projected final once its week has started', () => {
	const live = projections(board('playing'), SATURDAY);
	assert.equal(live.get(1), 70.4);
	assert.equal(live.get(2), null);
	assert.equal(projections(board('upcoming'), SATURDAY).get(1), 87);
	// A read that lags the page's clock (upcoming, its kickoff past) reads as the bug does, kicked off,
	// never the pre-game Proj (round 2, gameHead at the page's clock).
	assert.equal(projections(board('upcoming'), MONDAY).get(1), null);
	assert.equal(projectedFinalOf(board('playing'), 1), 70.4);
	assert.equal(projectedFinalOf(board('upcoming'), 1), null);
	assert.equal(projectedFinalOf(null, 1), null);
});

void test('the standings carry each team’s projection and sort by a column, best first', () => {
	const teams = [
		team(1, { wins: 5, points_for: 818, points_against: 659, waiver_budget_left: 675 }),
		team(2, { wins: 4, points_for: 739, points_against: null, waiver_budget_left: null }),
		team(3, { wins: 1, points_for: 784, points_against: 600, waiver_budget_left: 900 })
	];
	const rows = standingsRows(
		{ teams, me: 3 },
		projections(
			{
				...board('upcoming'),
				games: [
					{ state: 'upcoming', next_kickoff: null, sides: [side(1, 0, 101), side(3, 0, 120)] }
				]
			},
			SATURDAY
		)
	);
	assert.deepEqual(
		rows.map((r) => [r.rank, r.me, r.proj]),
		[
			[1, false, 101],
			[2, false, null],
			[3, true, 120]
		]
	);
	const order = (key: Parameters<typeof sortStandings>[1]): number[] =>
		sortStandings(rows, key, TERMS).map((r) => r.team.roster_id);
	assert.deepEqual(order('rank'), [1, 2, 3]);
	assert.deepEqual(order('pf'), [1, 3, 2]);
	assert.deepEqual(order('pa'), [3, 1, 2], 'fewest against first, unsaid last');
	assert.deepEqual(order('proj'), [3, 1, 2]);
	assert.deepEqual(order('waiver'), [3, 1, 2]);
	assert.deepEqual(
		sortStandings(rows, 'waiver', { waivers: 'order' }).map((r) => r.team.roster_id),
		[1, 2, 3],
		'the first in the waiver order first'
	);
	assert.equal(recordCell(teams[0] ?? team(0)), '5-2-0');
});

void test('the waiver column is the budget left, the order, or none the platform says', () => {
	assert.equal(waiverColumn(TERMS), 'FAAB');
	assert.equal(waiverColumn({ waivers: 'order' }), 'Waiver');
	assert.equal(waiverColumn({ waivers: null }), null);
	assert.equal(waiverCell(team(1, { waiver_budget_left: 1000 }), TERMS), '$1,000');
	assert.equal(waiverCell(team(3), { waivers: 'order' }), '3rd');
	assert.equal(waiverCell(team(1, { waiver_budget_left: null }), TERMS), '--');
});

void test('the playoff rule sits under the last playoff spot with its weeks', () => {
	assert.deepEqual(playoffRule(TERMS, 12), {
		after: 6,
		words: 'Top 6 by record, playoffs weeks 15 to 17'
	});
	assert.deepEqual(playoffRule({ playoff_teams: 4, playoff_weeks: { first: 16, last: 16 } }, 10), {
		after: 4,
		words: 'Top 4 by record, playoffs week 16'
	});
	assert.deepEqual(playoffRule({ playoff_teams: 4, playoff_weeks: null }, 10), {
		after: 4,
		words: 'Top 4 by record make the playoffs'
	});
	assert.equal(playoffRule({ playoff_teams: null, playoff_weeks: null }, 10), null);
	assert.equal(playoffRule({ playoff_teams: 12, playoff_weeks: null }, 12), null);
});

void test("FFPC's seeding, on record and on points in turn, is said under the standings with no cut (Lane 94, B21)", () => {
	const ffpc = {
		...TERMS,
		playoff_teams: null,
		playoff_weeks: { first: 13, last: 14 },
		playoff_seeds: ['record', 'points', 'record', 'points'] as const
	};
	const words = seedingWords({ ...ffpc, playoff_seeds: [...ffpc.playoff_seeds] }, 'ffpc');
	assert.equal(
		words,
		'FFPC seeds 4 for the playoffs, weeks 13 to 14: 1 and 3 on record, 2 and 4 on points.'
	);
	assert.doesNotMatch(words, bannedPattern());
	assert.equal(playoffRule(ffpc, 12), null);
	assert.deepEqual(termsView({ ...ffpc, playoff_seeds: [...ffpc.playoff_seeds] }, 12).at(-1), {
		label: 'Playoffs',
		value: '4 teams, weeks 13 to 14'
	});
	// A field seeded on record alone is the cut; an API before Lane 94 sends no seeds.
	assert.equal(seedingWords({ ...TERMS, playoff_seeds: ['record', 'record'] }, 'ffpc'), null);
	assert.equal(seedingWords(TERMS, 'espn'), null);
	assert.equal(
		teamBasis(
			'ffpc',
			'2026-10-17T02:00:00.000Z',
			{ format: 'ppr', league_own: false, te_bonus: 0.5 },
			false,
			ZONE
		),
		"A team's Proj adds its starters' published projections, PPR shown, nearest FFPC's rules, read Fri 9:00 pm Central. FFPC adds 0.5 a catch for TEs. Pts are FFPC's so far."
	);
});

const player = (
	name: string,
	id: string,
	team: string,
	position: string,
	board: string | null
) => ({
	host_id: id,
	board_id: board,
	name,
	position,
	team,
	injured_reserve: false
});

void test('the moves feed: the time, the teams, the kind, the players in and out, a bid', () => {
	const moves: LeagueMove[] = [
		{
			kind: 'waiver',
			at: '2026-10-08T07:04:12.119Z',
			roster_ids: [2],
			adds: [{ player: player('Kendrick Bourne', '4454', 'ARI', 'WR', '3045523'), roster_id: 2 }],
			drops: [{ player: player('Bears', 'CHI', 'CHI', 'DEF', null), roster_id: 2 }],
			bid: 75
		},
		{
			kind: 'trade',
			at: '2026-10-08T17:37:35.918Z',
			roster_ids: [1, 2],
			adds: [
				{ player: player('Michael Wilson', '1', 'ARI', 'WR', null), roster_id: 1 },
				{ player: player('Quinshon Judkins', '2', 'CLE', 'RB', null), roster_id: 2 }
			],
			drops: [
				{ player: player('Michael Wilson', '1', 'ARI', 'WR', null), roster_id: 2 },
				{ player: player('Quinshon Judkins', '2', 'CLE', 'RB', null), roster_id: 1 }
			],
			bid: null
		},
		{
			kind: 'add',
			at: '2026-10-08T18:00:00.000Z',
			roster_ids: [1],
			adds: [],
			drops: [{ player: player('Tory Horton', '3', 'SEA', 'WR', null), roster_id: 1 }],
			bid: null
		}
	];
	const [claim, trade, drop] = feedRows({ ...SYNC, moves }, ZONE);
	assert.ok(claim && trade && drop);
	assert.equal(drop.kind, 'Drop', 'a move that only lets a player go is a drop');
	assert.equal(claim.when, 'Thu 2:04 am');
	assert.equal(claim.kind, 'Waiver');
	assert.equal(claim.detail, 'FAAB $75');
	assert.equal(claim.mine, false);
	assert.deepEqual(
		claim.drops.map((p) => [p.name, p.position]),
		[['Bears', 'D/ST']]
	);
	assert.equal(trade.kind, 'Trade');
	assert.ok(trade.mine);
	assert.deepEqual(trade.drops, [], 'a trade names each player once, with who took him');
	assert.deepEqual(
		trade.adds.map((p) => [p.name, p.to]),
		[
			['Michael Wilson', 'Team 1'],
			['Quinshon Judkins', 'Team 2']
		]
	);
	assert.equal(trade.detail, '');
});

void test('the settings hold all 42 rules in the setup page’s groups and the two ladders', () => {
	const view = scoringView(RULES, []);
	assert.equal(view.count, 42);
	assert.deepEqual(
		view.groups.map((g) => g.label),
		['Passing', 'Rushing and receiving', 'Everyone', 'Kicking', 'Defense']
	);
	assert.deepEqual(view.groups[3]?.rules[1], {
		label: 'Field goal made from 40 to 49 yards',
		points: 4,
		stated: true
	});
	assert.equal(view.pointsAllowed.at(-1)?.label, '46 or more');
	assert.equal(view.yardsAllowed.length, 9);
	assert.equal(ruleFigure(0.04), '+0.04');
	assert.equal(ruleFigure(-2), '−2');
	assert.equal(ruleFigure(0), '0');
	assert.deepEqual(
		shapeView(TERMS.roster).map((s) => `${String(s.count)} ${s.label}`),
		['1 QB', '2 RB', '3 WR', '1 TE', '2 Flex', '1 D/ST', '0 K', '10 Bench']
	);
	assert.deepEqual(termsView(TERMS, 12), [
		{ label: 'Teams', value: '12' },
		{ label: 'Waivers', value: 'FAAB, $1,000 a season' },
		{ label: 'Playoffs', value: '6 teams, weeks 15 to 17' }
	]);
	assert.deepEqual(
		termsView({ ...TERMS, waivers: null, playoff_teams: null }, 10),
		[{ label: 'Teams', value: '10' }],
		'a platform that says nothing shows nothing'
	);
	assert.deepEqual(
		termsView(
			{ ...TERMS, waivers: 'order', waiver_order: 'rolling', tiebreak: 'head_to_head' },
			12
		).slice(1, 3),
		[
			{ label: 'Waivers', value: 'Waiver order, rolling' },
			{ label: 'Tiebreak', value: 'Head to head' }
		],
		"an order league's settings name how the order moves and the tiebreak"
	);
});

void test('the standings basis names the tiebreak and the waiver type the settings give (Lane 104)', () => {
	const order = { waivers: 'order', waiver_budget: null } as const;
	assert.equal(
		standingsBasis('espn', { ...order, tiebreak: 'head_to_head', waiver_order: 'rolling' }),
		"Standings follow ESPN's record, then head to head. PF and PA are points for and against, Streak the current run, Waiver the place in ESPN's order (rolling, 1st picks first)."
	);
	assert.equal(
		standingsBasis('sleeper', {
			...order,
			tiebreak: 'points_for',
			waiver_order: 'inverse_standings'
		}),
		"Standings follow Sleeper's record, then points for. PF and PA are points for and against, Streak the current run, Waiver the place in Sleeper's order (reverse standings, 1st picks first)."
	);
	// The snapshot carries neither, or the API is from before Lane 104.
	assert.equal(
		standingsBasis('espn', order),
		"Standings follow ESPN's record, then points for, as ESPN lists them. PF and PA are points for and against, Streak the current run, Waiver the place in ESPN's order (1st picks first)."
	);
	// A budget league says the budget left whatever the order type.
	assert.match(
		standingsBasis('espn', { waivers: 'budget', waiver_budget: 100, waiver_order: 'rolling' }),
		/FAAB the budget left of \$100\.$/
	);
});

/** The site's copy guard. */
const BANNED = bannedPattern();

void test('a rule the platform does not state prints no figure, and the count leaves it out', () => {
	const view = scoringView(RULES, ['points_per_return_touchdown', 'points_per_safety']);
	assert.equal(view.count, 40);
	const everyone = view.groups.find((g) => g.label === 'Everyone');
	assert.deepEqual(
		everyone?.rules.map((r) => [r.label, r.stated]),
		[
			['Fumble lost', true],
			['Two-point conversion', true],
			['Kick or punt return touchdown', false]
		]
	);
	assert.ok(everyone);
	assert.equal(everyone.unstated, 1);
	assert.equal(
		unstatedWords('sleeper', 1),
		'Sleeper does not state this rule. We score it at our standard figure.'
	);
	assert.equal(
		unstatedWords('espn', 2),
		'ESPN does not state these rules. We score them at our standard figure.'
	);
	assert.equal(scoringLead(40, 'sleeper').startsWith('40 rules as Sleeper states them.'), true);
});

void test('a platform whose moves are not read says so in the basis', () => {
	assert.equal(movesBasis('espn'), 'ESPN gives no move history to us.');
});

void test('copy guard: every League page word is fantasy words, with no dash or semicolon', () => {
	const said = [
		...Object.values(HOME),
		standingsBasis('sleeper', TERMS),
		standingsBasis('espn', { waivers: 'order', waiver_budget: null }),
		standingsBasis('mfl', { waivers: null, waiver_budget: null }),
		teamBasis(
			'sleeper',
			'2026-10-17T02:00:00.000Z',
			{ format: 'ppr', league_own: false },
			true,
			ZONE
		),
		teamBasis('espn', null, { format: 'half_ppr', league_own: true }, false, ZONE),
		extraWords('sleeper'),
		scoringLead(42, 'sleeper'),
		settingsLink('espn'),
		unstatedWords('sleeper', 1),
		unstatedWords('espn', 3),
		movesBasis('espn'),
		...scoringView(RULES, []).groups.flatMap((g) => [g.label, ...g.rules.map((r) => r.label)]),
		...termsView(TERMS, 12).map((t) => `${t.label} ${t.value}`),
		playoffRule(TERMS, 12)?.words ?? '',
		bugsOf(board('playing'), SYNC, SATURDAY, ZONE)[0]?.words ?? ''
	];
	for (const text of said) {
		assert.doesNotMatch(text, BANNED, text);
	}
	assert.equal(
		standingsBasis('sleeper', TERMS),
		"Standings follow Sleeper's record, then points for, as Sleeper lists them. PF and PA are points for and against, Streak the current run, FAAB the budget left of $1,000."
	);
	assert.equal(
		teamBasis(
			'sleeper',
			'2026-10-17T02:00:00.000Z',
			{ format: 'ppr', league_own: false },
			false,
			ZONE
		),
		"A team's Proj adds its starters' published projections, PPR nearest your rules, read Fri 9:00 pm Central. Pts are Sleeper's so far."
	);
	// Ruling (b) of Lane 79: where the lineup's rows carry points, its Team adds them, said in the
	// same sentence.
	assert.equal(
		teamBasis('espn', null, { format: 'ppr', league_own: true }, true, ZONE),
		"A team's Proj adds its starters' published projections on your rules, not in yet for this week. Pts are ESPN's so far, Team adds the rows."
	);
});

void test('the lineup card draws no change on a played week and says it is over', () => {
	const recorded = JSON.parse(
		readFileSync(
			new URL('../../../../scripts/inseason-fixture/data/lineup.json', import.meta.url),
			'utf8'
		)
	) as LineupAdvice;
	const final = (l: PlayerLine): PlayerLine => ({
		...l,
		facts: { ...l.facts, played: true, game_state: l.facts.bye ? null : 'final' }
	});
	const saturday = lineupSummary(recorded, ZONE, SATURDAY);
	assert.ok(saturday.box.swaps.length > 0);
	assert.equal(saturday.done, null);
	const done = WEEK_DONE;
	const tuesday = lineupSummary(
		{
			...recorded,
			week_done: done,
			week_done_state: 'locked',
			slots: recorded.slots.map((s) => ({
				...s,
				ours: final(s.ours),
				host: s.host && final(s.host)
			})),
			bench: recorded.bench.map(final)
		},
		ZONE,
		MONDAY
	);
	assert.equal(tuesday.box.swaps.length, 0);
	assert.ok(tuesday.box.starters.every((s) => s.move === null));
	assert.equal(tuesday.done, done);
	// The matchup still plays: the card says Locked, its sentence the API's (Lane 91).
	assert.equal(tuesday.doneState, 'locked');
	assert.equal(changesTitle(0, tuesday.done, tuesday.doneState), 'Locked');
	assert.equal(saturday.doneState, null);
});

void test('a scoreboard past a kickoff and a lineup read that lags it agree: no move on him', () => {
	const recorded = JSON.parse(
		readFileSync(
			new URL('../../../../scripts/inseason-fixture/data/lineup.json', import.meta.url),
			'utf8'
		)
	) as LineupAdvice;
	// The lineup was read at 11:59 Central, every row still upcoming by the API; the page's clock and
	// the scoreboard read are at 12:01, the noon games under way.
	const upcoming = (l: PlayerLine): PlayerLine => ({
		...l,
		facts: { ...l.facts, game_state: l.facts.bye ? null : 'upcoming' }
	});
	const lagging: LineupAdvice = {
		...recorded,
		slots: recorded.slots.map((s) => ({
			...s,
			ours: upcoming(s.ours),
			host: s.host && upcoming(s.host)
		})),
		bench: recorded.bench.map(upcoming)
	};
	const noon = '2026-10-18T17:00:00.000Z';
	const now = Date.parse(noon) + 60_000;
	const noonMoves = recorded.slots.filter(
		(s) => s.changed && (s.ours.facts.kickoff === noon || s.host?.facts.kickoff === noon)
	);
	assert.ok(noonMoves.length > 0, 'the fixture changes a noon player');
	const card = lineupSummary(lagging, ZONE, now);
	for (const s of noonMoves)
		assert.ok(
			!card.box.swaps.some((w) => w.key === s.ours.player.host_id),
			`${s.ours.player.name} is moved after his kickoff`
		);
	const [bug] = bugsOf(
		{
			games: [
				{
					state: 'playing',
					next_kickoff: '2026-10-18T20:05:00.000Z',
					sides: [side(1, 9.2), side(2, 4.1)]
				}
			]
		},
		SYNC,
		now,
		ZONE
	);
	assert.equal(bug?.head, KICKOFF.kickedOff);
	// One ms before the kickoff the same read still offers the change.
	assert.ok(
		lineupSummary(lagging, ZONE, Date.parse(noon) - 1).box.swaps.length >= noonMoves.length
	);
});
