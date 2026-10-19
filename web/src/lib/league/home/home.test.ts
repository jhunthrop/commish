// The League page's words (Lane 66i): the scoreboard's bugs, the standings' columns and order, the
// moves feed, the settings and the basis, with the copy guard over every one. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { LeagueMove, LeagueTeam, LeagueTerms } from '../api.ts';
import type { Scoreboard } from '../inseason/api.ts';
import { KICKOFF } from '../box/kickoff.ts';
import {
	HOME,
	bugsOf,
	extraWords,
	feedRows,
	playoffRule,
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
			sides: [side(1, 62.1, 87), side(2, 71.4, null)]
		}
	]
});

const SYNC = { teams: [team(1), team(2, { ties: 1, avatar: 'https://sleepercdn.com/x' })], me: 1 };

void test('a bug before kickoff names the next kickoff and draws both sides alike', () => {
	const [bug] = bugsOf(board('upcoming'), SYNC, SATURDAY, ZONE);
	assert.ok(bug);
	assert.equal(bug.head, 'Sun 3:25 pm');
	assert.equal(bug.words, HOME.nextKickoff);
	assert.deepEqual(
		bug.sides.map((s) => [s.name, s.record, s.proj, s.pts, s.stands, s.me]),
		[
			['Team 1', '3-2', '87.0', '--', 'level', true],
			['Team 2', '3-2-1', '--', '--', 'level', false]
		]
	);
	assert.ok(bug.mine);
});

void test('once a game has started the side ahead is bright and the side behind muted', () => {
	for (const state of ['playing', 'final'] as const) {
		const [bug] = bugsOf(board(state), SYNC, SATURDAY, ZONE);
		assert.ok(bug);
		assert.deepEqual(
			bug.sides.map((s) => [s.pts, s.stands]),
			[
				['62.1', 'behind'],
				['71.4', 'ahead']
			]
		);
	}
	const [playing] = bugsOf(board('playing'), SYNC, SATURDAY, ZONE);
	assert.ok(playing);
	assert.equal(playing.head, KICKOFF.kickedOff);
	assert.equal(playing.words, '12 of 20 starters to play');
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
		bugsOf(unread, SYNC, SATURDAY, ZONE)[0]?.sides.map((s) => [s.pts, s.stands]),
		[
			['62.1', 'level'],
			['--', 'level']
		]
	);
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
		lagging.sides.map((s) => [s.pts, s.stands]),
		[
			['62.1', 'behind'],
			['71.4', 'ahead']
		]
	);
	// Under way with its next kickoff past: Kicked off, the starters still to play counted.
	const [playing] = bugsOf(board('playing'), SYNC, MONDAY, ZONE);
	assert.ok(playing);
	assert.equal(playing.head, KICKOFF.kickedOff);
	assert.equal(playing.words, '12 of 20 starters to play');
	assert.equal(bugsOf(board('final'), SYNC, MONDAY, ZONE)[0]?.head, KICKOFF.final);
});

void test('the standings carry each team’s projection and sort by a column, best first', () => {
	const teams = [
		team(1, { wins: 5, points_for: 818, points_against: 659, waiver_budget_left: 675 }),
		team(2, { wins: 4, points_for: 739, points_against: null, waiver_budget_left: null }),
		team(3, { wins: 1, points_for: 784, points_against: 600, waiver_budget_left: 900 })
	];
	const rows = standingsRows(
		{ teams, me: 3 },
		projections({
			...board('upcoming'),
			games: [{ state: 'upcoming', next_kickoff: null, sides: [side(1, 0, 101), side(3, 0, 120)] }]
		})
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
		"Standings follow Sleeper's record, then points for. PF and PA are points for and against, Streak the current run, FAAB the budget left of $1,000."
	);
	assert.equal(
		teamBasis(
			'sleeper',
			'2026-10-17T02:00:00.000Z',
			{ format: 'ppr', league_own: false },
			false,
			ZONE
		),
		"A team's Proj adds its starters' published projections in PPR, the closest match to this league's rules, read Fri 9:00 pm Central. Pts are Sleeper's so far."
	);
	// Ruling (b) of Lane 79: where the lineup's rows carry points, its Team adds them, said in the
	// same sentence.
	assert.equal(
		teamBasis('espn', null, { format: 'ppr', league_own: true }, true, ZONE),
		"A team's Proj adds its starters' published projections in PPR, this league's own, not in yet for this week. Pts are ESPN's so far, and your lineup's Team adds its rows."
	);
});
