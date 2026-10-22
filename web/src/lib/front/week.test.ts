// The front door's week (Lane 66k): the lead league's bug, strip and chips, the other leagues, and
// the basis, each word from the API's answer alone. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WEEK_DONE } from '../../../scripts/inseason-fixture/sunday.ts';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { components } from '#lib/api/types.ts';
import { bugsMissListedFinal, bugsPlayingListed, unlistedDrawn } from '#lib/league/home/home.ts';
import {
	FRONT,
	chipsOf,
	frontLeague,
	gameLive,
	leadOf,
	liveLeadOf,
	nudgeOf,
	rosterAside,
	readWords,
	turnedWeek,
	weekBasis,
	type ScreenHref,
	type WeekLeague
} from './week.ts';

type Schemas = components['schemas'];
const ZONE = 'America/Chicago';
const NOW = new Date('2026-10-17T15:12:00.000Z');
const href: ScreenHref = (screen, id) => `/league/${id}/${screen}`;

const facts = (over: Partial<Schemas['WeekFacts']> = {}): Schemas['WeekFacts'] => ({
	week: 6,
	opponent: 'HOU',
	home: true,
	kickoff: '2026-10-18T13:30:00.000Z',
	bye: false,
	designation: null,
	played: false,
	points_this_week: null,
	last_games: [],
	allowed_to_position: null,
	game_total: null,
	spread: null,
	roof: null,
	weather: null,
	...over
});

const line = (
	name: string,
	position: string,
	team: string,
	over: Partial<Schemas['WeekFacts']> = {}
): Schemas['PlayerLine'] => ({
	player: { host_id: name, board_id: name, name, position, team, injured_reserve: false },
	headshot: null,
	slug: null,
	position_rank: 7,
	points_over_replacement: null,
	rest_of_season_per_game: null,
	week_projection: 9.65,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: facts(over)
});

const player = (name: string, position: string): Schemas['LeaguePlayer'] => ({
	host_id: name,
	board_id: null,
	name,
	position,
	team: 'NYG',
	injured_reserve: false
});

const team = (roster: number, name: string, wins: number): Schemas['LeagueTeam'] => ({
	roster_id: roster,
	name,
	owner: '',
	wins,
	losses: 5 - wins,
	ties: 0,
	points_for: 600,
	points_against: null,
	streak: null,
	waiver_order: null,
	waiver_budget_left: null,
	avatar: null
});

const side = (roster: number, projection: number): Schemas['ScoreboardSide'] => ({
	roster_id: roster,
	points: 0,
	points_read: true,
	projection,
	starters: 10,
	played: 0
});

const BYE: Schemas['RosterChip'] = {
	kind: 'bye',
	line: line('Sam LaPorta', 'TE', 'DET', { bye: true, opponent: null }),
	gain: null,
	idle: true
};

const LINEUP: Schemas['WeekLineup'] = {
	changes: 3,
	projection: 101.6,
	as_set: 74.7,
	gain: 26.9,
	swaps: [
		{ slot: 'QB', in: player('Jaxson Dart', 'QB'), out: player('Aaron Rodgers', 'QB') },
		{ slot: 'FLEX', in: player('Travis Etienne', 'RB'), out: player("Ja'Marr Chase", 'WR') },
		{ slot: 'DEF', in: player('Houston Texans', 'DEF'), out: null }
	]
};

const SUCK: WeekLeague = {
	id: 'suck',
	name: 'S.U.C.K.',
	host: 'sleeper',
	team_name: 'McConkey Kong Country',
	standing: { wins: 1, losses: 4, ties: 0, place: 12, teams: 12 },
	phase: 'in_season',
	week: 6,
	read_at: '2026-10-17T15:08:00.000Z',
	projection_read_at: '2026-10-17T02:00:00.000Z',
	projection_scoring: { format: 'ppr', league_own: false },
	bug: {
		game: {
			state: 'upcoming',
			next_kickoff: '2026-10-18T13:30:00.000Z',
			sides: [side(1, 74.7), side(7, 98.4)]
		},
		teams: [team(1, 'McConkey Kong Country', 1), team(7, 'thatmattkelley', 1)],
		first: [line('Jakobi Meyers', 'WR', 'JAX')]
	},
	lineup: {
		changes: 3,
		projection: 101.6,
		as_set: 74.7,
		gain: 26.9,
		swaps: [
			{ slot: 'QB', in: player('Jaxson Dart', 'QB'), out: player('Aaron Rodgers', 'QB') },
			{ slot: 'FLEX', in: player('Travis Etienne', 'RB'), out: player("Ja'Marr Chase", 'WR') },
			{ slot: 'DEF', in: player('Houston Texans', 'DEF'), out: null }
		]
	},
	chips: [
		{
			kind: 'status',
			line: line('Rome Odunze', 'WR', 'CHI', {
				designation: { status: 'questionable', as_of: '2026-10-16T21:00:00.000Z' }
			}),
			gain: null,
			idle: false
		},
		{
			kind: 'bye',
			line: line('Sam LaPorta', 'TE', 'DET', { bye: true, opponent: null }),
			gain: null,
			idle: true
		},
		{ kind: 'pickup', line: line('Xavier Hutchinson', 'WR', 'HOU'), gain: 1.8, idle: false }
	],
	problem: null
};

void test('the lead league is the chosen one, else the first with a week', () => {
	const off: WeekLeague = { ...SUCK, id: 'off', week: 0, bug: null, lineup: null, chips: [] };
	assert.equal(leadOf([off, SUCK], 'off')?.id, 'off');
	assert.equal(leadOf([off, SUCK], null)?.id, 'suck');
	assert.equal(leadOf([off], 'gone')?.id, 'off');
	assert.equal(leadOf([], null), null);
});

void test('a live league leads ahead of the chosen one only while a starter of its is in play (B38)', () => {
	// Monday 7:25 pm Central: the chosen league's week is final, another's game is under way.
	const monday = new Date('2026-10-20T00:25:00.000Z');
	const bug = SUCK.bug;
	assert.ok(bug !== null);
	/** The game in a state, with each side's starters in play now (the API's in_play); undefined
	 * leaves the field out, as an older answer does. */
	const game = (
		state: 'upcoming' | 'playing' | 'final',
		next: string | null,
		inPlay: readonly (number | undefined)[]
	) => ({
		...bug,
		game: {
			...bug.game,
			state,
			next_kickoff: next,
			sides: bug.game.sides.map((side, i) => {
				const count = inPlay[i];
				return count === undefined ? side : { ...side, in_play: count };
			})
		}
	});
	const chosen: WeekLeague = { ...SUCK, id: 'chosen', bug: game('final', null, [0, 0]) };
	const live: WeekLeague = {
		...SUCK,
		id: 'espn',
		host: 'espn',
		bug: game('playing', null, [0, 2])
	};
	const idle: WeekLeague = { ...SUCK, id: 'ffpc', bug: null };
	const leagues = [idle, chosen, live];
	const lead = leadOf(leagues, 'chosen');
	// The chosen league stays the lead: the page never changes the member's choice.
	assert.equal(lead?.id, 'chosen');
	assert.equal(gameLive(live, monday), true);
	assert.equal(gameLive(chosen, monday), false);
	assert.equal(gameLive(idle, monday), false);
	assert.equal(liveLeadOf(leagues, lead, monday)?.id, 'espn');
	// The chosen league live too: it leads alone.
	assert.equal(liveLeadOf(leagues, live, monday), null);
	// Friday between games: playing by the API (Thursday's starter final), Sunday's still to come,
	// nobody in play. Never Live now (fix round 1, HIGH-1).
	const friday = new Date('2026-10-16T15:00:00.000Z');
	const gap: WeekLeague = {
		...live,
		bug: game('playing', '2026-10-18T17:00:00.000Z', [0, 0])
	};
	assert.equal(gameLive(gap, friday), false);
	assert.equal(liveLeadOf([chosen, gap], chosen, friday), null);
	// An answer from before in_play reads as none in play.
	const older: WeekLeague = { ...live, bug: game('playing', null, [undefined, undefined]) };
	assert.equal(liveLeadOf([chosen, older], chosen, monday), null);
	// Final at the page's clock, whatever the count: never live.
	assert.equal(
		liveLeadOf([chosen, { ...live, bug: game('final', null, [0, 2]) }], chosen, monday),
		null
	);
	assert.equal(liveLeadOf([], null, monday), null);
	assert.equal(FRONT.liveNow, 'Live now');
});

void test('the bug is the API game with both teams, mine first, and who plays first', () => {
	const view = frontLeague(SUCK, href, NOW, ZONE);
	assert.equal(view.line, 'McConkey Kong Country, 1-4, 12th of 12');
	assert.equal(view.platform, 'Sleeper');
	assert.ok(view.bug);
	assert.equal(view.bug.head, 'Sun 8:30 am');
	// Before kickoff the Proj is the big figure (Lane 92, B22).
	assert.deepEqual(
		view.bug.sides.map((s) => [s.name, s.record, s.small, s.big, s.me]),
		[
			['McConkey Kong Country', '1-4', '', '74.7', true],
			['thatmattkelley', '1-4', '', '98.4', false]
		]
	);
	assert.equal(view.first?.words, 'Meyers plays first, vs HOU');
	assert.equal(view.matchupHref, '/league/suck/matchup');
});

void test('the strip words the API summary: count, figures and the swaps by short name', () => {
	const nudge = nudgeOf(SUCK, href);
	assert.ok(nudge);
	assert.equal(nudge.title, 'Three changes');
	assert.deepEqual(nudge.sum, {
		figure: '101.6',
		words: 'Proj with them, 74.7 as set',
		gain: '+26.9'
	});
	assert.deepEqual(
		nudge.swaps.map((s) => [s.slot, s.in, s.out]),
		[
			['QB', 'Dart', 'Rodgers'],
			['Flex', 'Etienne', 'Chase'],
			['D/ST', 'Texans', null]
		]
	);
	assert.equal(nudge.verb, FRONT.setYourLineup);
	assert.ok(nudge.solid);
	assert.equal(nudge.href, '/league/suck/start');
	assert.equal(nudge.asSet, 'As set on Sleeper');
	const set = nudgeOf({ ...SUCK, lineup: { ...LINEUP, changes: 0, swaps: [], gain: 0 } }, href);
	assert.ok(set);
	assert.equal(set.title, 'Your lineup is set');
	assert.equal(set.verb, FRONT.openLineup);
	assert.equal(set.solid, false);
	assert.equal(nudgeOf({ ...SUCK, lineup: null }, href), null);
});

void test('each chip names the fact and opens the screen that acts on it', () => {
	const chips = chipsOf(SUCK, href, ZONE, NOW);
	assert.deepEqual(
		chips.map((c) => [c.label, c.row.name, c.line, c.go, c.href]),
		[
			[
				'Questionable',
				'Rome Odunze',
				'WR, CHI, a starter. Read Fri 4:00 pm',
				'Lineup',
				'/league/suck/start'
			],
			[
				'Bye',
				'Sam LaPorta',
				'TE, DET. No TE of yours plays this week',
				'Waivers',
				'/league/suck/waivers'
			],
			[
				'Top pickup',
				'Xavier Hutchinson',
				'WR, HOU. +1.8 Proj this week',
				'Waivers',
				'/league/suck/waivers'
			]
		]
	);
	const starterBye = chipsOf({ ...SUCK, chips: [{ ...BYE, idle: false }] }, href, ZONE, NOW);
	assert.deepEqual(
		starterBye.map((c) => [c.line, c.go]),
		[['TE, DET, a starter on bye', 'Lineup']]
	);
});

void test("once the lineup has played its week the chips are the next week's, and say so (Lane 95)", () => {
	const turned = { ...SUCK, chips_week: 7 };
	assert.equal(turnedWeek(turned), 7);
	assert.equal(turnedWeek({ ...SUCK, chips_week: 6 }), null);
	// An answer from before the field reads as the league's week.
	assert.equal(turnedWeek(SUCK), null);
	assert.equal(frontLeague(turned, href, NOW, ZONE).chipsWeek, 7);
	assert.equal(rosterAside(2, 7), 'Two facts for week 7. Each opens the screen that acts on it.');
	assert.match(
		weekBasis(turned, false, ZONE)[1] ?? '',
		/The roster facts are for week 7: a pickup goes by Gain/
	);
	assert.doesNotMatch(weekBasis(turned, false, ZONE)[1] ?? '', /he adds this week/);
	assert.deepEqual(
		chipsOf(turned, href, ZONE, NOW).map((c) => c.line),
		[
			'WR, CHI, a starter. Read Fri 4:00 pm',
			'TE, DET. No TE of yours plays in week 7',
			'WR, HOU. +1.8 Proj in week 7'
		]
	);
});

void test('a league with no week names its phase, one whose read failed keeps its sentence', () => {
	const off = frontLeague(
		{ ...SUCK, phase: 'offseason', week: 0, bug: null, lineup: null, chips: [] },
		href,
		NOW,
		ZONE
	);
	assert.equal(off.phase, 'Season over');
	assert.equal(off.bug, null);
	const failed = frontLeague(
		{
			...SUCK,
			week: 0,
			bug: null,
			lineup: null,
			chips: [],
			problem: 'ESPN is not answering right now.'
		},
		href,
		NOW,
		ZONE
	);
	assert.equal(failed.problem, 'ESPN is not answering right now. Last read Sat 10:08 am.');
	assert.equal(failed.changes, null);
	const unread = frontLeague(
		{ ...SUCK, read_at: null, lineup: null, problem: 'We could not read this league just now.' },
		href,
		NOW,
		ZONE
	);
	assert.equal(unread.problem, 'We could not read this league just now.');
	assert.equal(failed.phase, null);
	assert.equal(failed.line, 'McConkey Kong Country, 1-4, 12th of 12');
});

void test('the basis says whose figures, what Proj is and when it was read, once', () => {
	assert.equal(readWords(SUCK, NOW), 'Read from Sleeper 4 minutes ago.');
	assert.equal(readWords({ ...SUCK, read_at: null }, NOW), null);
	const basis = weekBasis(SUCK, true, ZONE);
	assert.equal(basis.length, 2);
	assert.match(basis[0] ?? '', /^Record, place and Pts are Sleeper's\. /);
	assert.match(basis[0] ?? '', /Your other leagues read the same way/);
	assert.doesNotMatch(weekBasis(SUCK, false, ZONE)[0] ?? '', /other leagues/);
	assert.match(
		basis[1] ?? '',
		/PPR scoring, the closest to this league's rules, read Fri 9:00 pm Central\./
	);
	assert.equal(weekBasis({ ...SUCK, projection_scoring: null }, true, ZONE).length, 1);
	// No unnamed "strip" (B39): Gain is named as the changes' figure, a pickup's said after it.
	assert.match(
		basis[1] ?? '',
		/ Gain is what the changes add\. A pickup's gain is the Proj he adds this week\.$/
	);
	assert.doesNotMatch(basis.join(' '), /strip/i);
});

void test("the front door's FFPC bug says the opponent's figures as the home does, never the starters key (Lane 127, B105)", () => {
	const ffpc = (state: 'upcoming' | 'playing', opponent: Partial<Schemas['ScoreboardSide']>) => {
		const game = SUCK.bug?.game;
		assert.ok(game);
		const [mine, theirs] = game.sides;
		assert.ok(mine && theirs);
		const league: WeekLeague = {
			...SUCK,
			host: 'ffpc',
			bug: {
				...(SUCK.bug ?? { teams: [], first: [] }),
				game: {
					...game,
					state,
					sides: [
						state === 'upcoming' ? mine : { ...mine, projected_final: 80.2 },
						{ ...theirs, starters: 0, projected_final: null, ...opponent }
					]
				}
			}
		};
		const bug = frontLeague(league, href, NOW, ZONE).bug;
		assert.ok(bug);
		const started = bug.state !== 'upcoming';
		return weekBasis(
			league,
			false,
			ZONE,
			started,
			bugsMissListedFinal([bug]),
			bugsPlayingListed([bug]),
			unlistedDrawn([bug])
		)[1];
	};
	// Before Sunday his Proj is our best lineup from his roster.
	const friday = ffpc('upcoming', {
		projection: 97.1,
		projection_best_lineup: true,
		schedule_state: 'upcoming'
	});
	assert.match(
		friday ?? '',
		/ Proj for teams FFPC sends no lineup for is our best lineup from their rosters\.$/
	);
	// Once kicked off his Proj final is the best lineup's too: the same sentence, its pace clause
	// (fix rounds 1 and 3).
	const sunday = ffpc('playing', {
		projection: 97.1,
		projected_final: 91.3,
		projection_best_lineup: true,
		projected_final_paced: true,
		schedule_state: 'kicked_off'
	});
	assert.match(
		sunday ?? '',
		/ Proj for teams FFPC sends no lineup for is our best lineup from their rosters, in-play players at their projection's pace\.$/
	);
	// With no roster his "--" is said so, never by the starters' key.
	const rosterless = ffpc('playing', { projection: null, schedule_state: 'kicked_off' });
	assert.match(rosterless ?? '', / Teams FFPC sends no lineup or roster for show --\.$/);
	assert.doesNotMatch(rosterless ?? '', /No Proj final while/);
	for (const said of [friday, sunday, rosterless]) assert.doesNotMatch(said ?? '', bannedPattern());
	// The opponent's Proj is our best lineup, not his starters as set: that sentence goes (fix round 3).
	const best = { bestLineup: true, noRoster: false, paced: false, skipped: false };
	assert.doesNotMatch(
		weekBasis(SUCK, false, ZONE, false, false, false, best)[0] ?? '',
		/as set on/
	);
	assert.match(weekBasis(SUCK, false, ZONE)[0] ?? '', /as set on Sleeper/);
	// While the pace clause is said the other leagues' line drops its qualification (fix round 3).
	const paced = { bestLineup: true, noRoster: false, paced: true, skipped: false };
	assert.match(
		weekBasis(SUCK, true, ZONE, true, false, true, paced)[0] ?? '',
		/ Your other leagues read the same way\.$/
	);
	assert.match(weekBasis(SUCK, true, ZONE)[0] ?? '', /each from its own platform\.$/);
});

void test('the roster head counts its chips, and each other league carries its changes', () => {
	assert.equal(rosterAside(3), 'Three facts this week. Each opens the screen that acts on it.');
	assert.equal(rosterAside(1), 'One fact this week. Each opens the screen that acts on it.');
	assert.equal(frontLeague(SUCK, href, NOW, ZONE).changes, 'Three changes, +26.9');
	assert.equal(
		frontLeague({ ...SUCK, lineup: { ...LINEUP, changes: 0, swaps: [], gain: 0 } }, href, NOW, ZONE)
			.changes,
		'Your lineup is set'
	);
});

void test('the copy guard: no em-dash, semicolon, platform word or betting word in any line', () => {
	const view = frontLeague(SUCK, href, NOW, ZONE);
	const said = [
		...Object.values(FRONT).filter((v) => typeof v === 'string'),
		FRONT.turnedPickup(7),
		...weekBasis(SUCK, true, ZONE),
		rosterAside(2),
		rosterAside(2, 7),
		...view.chips.flatMap((c) => [c.label, c.line]),
		view.first?.words ?? '',
		view.nudge?.asSet ?? ''
	];
	for (const s of said) {
		assert.doesNotMatch(s, bannedPattern(), s);
	}
});

void test('a finished week on the front door reads Final with the API sentence and no verb (Lane 85)', () => {
	const done = WEEK_DONE;
	const view = frontLeague(
		{ ...SUCK, lineup: { ...LINEUP, week_done: done, week_done_state: 'final' } },
		href,
		NOW,
		ZONE
	);
	assert.ok(view.nudge);
	assert.equal(view.nudge.title, 'Final');
	assert.equal(view.nudge.done, done);
	assert.equal(view.nudge.sum, null);
	assert.equal(view.nudge.verb, null);
	assert.deepEqual(view.nudge.swaps, []);
	assert.equal(view.changes, 'Final');
	assert.equal(frontLeague(SUCK, href, NOW, ZONE).nudge?.done, null);
});

void test('the front door says Locked, never Final, while the matchup still plays (Lane 91)', () => {
	const locked = frontLeague(
		{ ...SUCK, lineup: { ...LINEUP, week_done: WEEK_DONE, week_done_state: 'locked' } },
		href,
		NOW,
		ZONE
	);
	assert.equal(locked.nudge?.title, 'Locked');
	assert.equal(locked.nudge.done, WEEK_DONE);
	assert.equal(locked.nudge.verb, null);
	assert.equal(locked.changes, 'Locked');
	// The previous API's answer, the sentence with no state, reads Final as it did.
	const previous = frontLeague(
		{ ...SUCK, lineup: { ...LINEUP, week_done: WEEK_DONE } },
		href,
		NOW,
		ZONE
	);
	assert.equal(previous.nudge?.title, 'Final');
});
