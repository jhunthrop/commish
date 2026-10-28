// The Trades screen as a trade table (Lane 66g): its rows, its order, its strip, its builder's
// scoreboard and every word it prints. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { basisText, drawnText, KICKED_OFF_PART, phoneFinalsPart } from './basis.ts';
import { stripLead, stripMark } from './strip.ts';
import { BOX } from './box.ts';
import { MINUS } from '#lib/format/number.ts';
import type { PlayerLine, TradeAdvice, TradeCheck, TradeRow, TradeTeam } from '../inseason/api.ts';
import {
	bugFigures,
	checkRoom,
	copiedTrade,
	finderRows,
	fromWords,
	gainWord,
	heldCheck,
	heldTrades,
	offerText,
	phoneWith,
	proposeVerb,
	refusalWords,
	restFigure,
	roomWords,
	rosterOrder,
	shortSide,
	sideRows,
	weekLine,
	sortRows,
	toneOf,
	tradeBasis,
	TRADES,
	weekWord,
	worthProposing,
	worthTitle
} from './trades.ts';

const line = (name: string, position = 'RB', proj: number | null = null): PlayerLine => ({
	player: {
		host_id: `h-${name}`,
		board_id: `b-${name}`,
		name,
		position,
		team: 'NYG',
		injured_reserve: false
	},
	headshot: null,
	slug: null,
	position_rank: 14,
	points_over_replacement: 1.2,
	rest_of_season_per_game: 9.3,
	week_projection: proj,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: {
		week: 6,
		opponent: 'NO',
		home: true,
		kickoff: null,
		bye: false,
		designation: null,
		played: false,
		points_this_week: null,
		last_games: [],
		allowed_to_position: null,
		game_total: null,
		spread: null,
		roof: null,
		weather: null
	}
});

const row = (mine: number, theirs: number, over: Partial<TradeRow> = {}): TradeRow => ({
	give: [line('Aaron Rodgers', 'QB')],
	get: [line('Cam Skattebo'), line('Pierre Strong')],
	drop: line('Jaxson Dart', 'QB'),
	drop_reason: null,
	my_gain: mine,
	their_gain: theirs,
	close_for_them: theirs < 0.5,
	my_proj_change: 7.3,
	their_proj_change: 2.5,
	...over
});

const team = (id: number, name: string, trades: TradeRow[]): TradeTeam => ({
	roster_id: id,
	name,
	owner: name,
	record: { wins: 1, losses: 4, ties: 0 },
	roster: [],
	trades,
	note: null
});

const teams = [
	team(7, 'thatmattkelley', [row(4.6, 0.5, { my_proj_change: 10.9, their_proj_change: -5.6 })]),
	team(8, 'Max_Jensen10', [row(5.7, 0.7), row(5.6, 0.8)]),
	team(9, 'Aaron Donald Dependent', [row(0.7, 0.2)]),
	team(10, 'Muttdogs', [])
];

void test("the finder lists each team's best, or every trade, in the API's order across teams", () => {
	assert.deepEqual(
		finderRows(teams, false).map((r) => r.team.name),
		['Max_Jensen10', 'thatmattkelley', 'Aaron Donald Dependent']
	);
	assert.equal(finderRows(teams, true).length, 4);
	const keys = finderRows(teams, true).map((r) => r.key);
	assert.equal(new Set(keys).size, keys.length - 1, 'two alike trades with one team share a key');
});

void test('a column sorts best first, a row without the figure last, ties in the API order', () => {
	const rows = finderRows(teams, false);
	assert.deepEqual(
		sortRows(rows, 'weekMine').map((r) => r.team.name),
		['thatmattkelley', 'Max_Jensen10', 'Aaron Donald Dependent']
	);
	assert.deepEqual(
		sortRows(rows, 'weekTheirs').map((r) => r.team.name),
		['Max_Jensen10', 'Aaron Donald Dependent', 'thatmattkelley']
	);
	const missing = finderRows(
		[team(3, 'Late', [row(9, 0.9, { my_proj_change: null })]), ...teams],
		false
	);
	assert.equal(sortRows(missing, 'weekMine').at(-1)?.team.name, 'Late');
	assert.equal(sortRows(missing, 'mine')[0]?.team.name, 'Late');
});

void test('the strip names at most two trades the other team gains from, never a close call', () => {
	const worth = worthProposing(teams);
	assert.deepEqual(
		worth.map((r) => r.team.name),
		['Max_Jensen10', 'thatmattkelley']
	);
	assert.equal(worthTitle(worth.length), 'Two trades worth proposing');
	assert.equal(worthTitle(1), 'One trade worth proposing');
	assert.deepEqual(worthProposing([team(9, 'Close', [row(0.7, 0.2)])]), []);
});

void test('the best of the strip says Best in words and leads, the rest quiet (Lane 115, B87)', () => {
	const worth = worthProposing(teams);
	assert.deepEqual(
		worth.map((_, i) => stripMark(i, worth.length)),
		['Best', null]
	);
	assert.deepEqual(
		worth.map((_, i) => stripLead(i)),
		[true, false]
	);
	// A strip of one has nothing to be best among.
	assert.equal(stripMark(0, 1), null);
});

void test('a trade reads by last names, its gains and week signed, its room by name', () => {
	const best = row(5.7, 0.7);
	assert.equal(
		`${shortSide(best.give)} for ${shortSide(best.get)}`,
		'Rodgers for Skattebo and Strong'
	);
	assert.equal(gainWord(5.7), '+5.7');
	assert.equal(gainWord(-0.34), '−0.3');
	assert.equal(weekWord(-5.6), '−5.6');
	assert.equal(weekWord(0.04), '0.0');
	assert.equal(weekWord(null), '--');
	assert.equal(toneOf(-5.6), 'loss');
	assert.equal(toneOf(0.01), 'even');
	assert.equal(phoneWith({ name: 'Max_Jensen10' }, best), 'with Max_Jensen10, you drop Dart');
	assert.equal(phoneWith({ name: 'Muttdogs' }, { drop: null, drop_reason: null }), 'with Muttdogs');
	// A drop this week's lineup starts says so wherever the drop is named, the opened trade carrying
	// the API's whole sentence (review 66u finding 3).
	const reason =
		'Williams starts at WR3 for you this week, and Tucker takes that spot after the trade.';
	const starter = { drop: line('Antonio Williams', 'WR'), drop_reason: reason };
	assert.equal(roomWords(starter).yours, 'You drop Williams, a starter');
	assert.equal(
		phoneWith({ name: 'Bower Rangers' }, starter),
		'with Bower Rangers, you drop Williams, a starter'
	);
	assert.equal(roomWords(best).yours, 'You drop Dart');
	assert.equal(fromWords('McConkey Kong Country', true), 'From McConkey Kong Country, you');
	assert.equal(fromWords('Max_Jensen10', false), 'From Max_Jensen10');
});

void test("a trade's week reads from the API's two changes, on the card and atop an opened trade", () => {
	assert.equal(weekLine(row(5.7, 0.7)), '+7.3 Proj this week for your lineup, +2.5 for theirs');
	assert.equal(
		weekLine(row(4.6, 0.5, { my_proj_change: 10.9, their_proj_change: -5.6 })),
		'+10.9 Proj this week for your lineup, −5.6 for theirs'
	);
	assert.equal(
		weekLine(row(1, 1, { my_proj_change: 0.02, their_proj_change: 0 })),
		'0.0 Proj this week for your lineup, 0.0 for theirs'
	);
	assert.equal(weekLine(row(1, 1, { my_proj_change: null, their_proj_change: null })), null);
});

void test('the opened trade lists your give and drop, then their get, each moving the right way', () => {
	const sides = sideRows(row(5.7, 0.7));
	assert.deepEqual(
		sides.yours.map((s) => [s.side, s.move, s.line.player.name]),
		[
			['Give', 'out', 'Aaron Rodgers'],
			['Drop', 'out', 'Jaxson Dart']
		]
	);
	assert.deepEqual(
		sides.theirs.map((s) => [s.side, s.move]),
		[
			['Get', 'in'],
			['Get', 'in']
		]
	);
});

void test('the verb follows the moves rule, the offer is copied in words, the confirm names the page', () => {
	assert.equal(proposeVerb({ propose: 'unavailable' }, 'sleeper'), 'Open Sleeper trades');
	assert.equal(proposeVerb({ propose: 'available' }, 'espn'), 'Propose on ESPN');
	assert.equal(
		offerText({ name: 'Max_Jensen10' }, row(5.7, 0.7)),
		'Trade with Max_Jensen10: Aaron Rodgers (QB NYG) for Cam Skattebo (RB NYG) and Pierre Strong (RB NYG).'
	);
	assert.deepEqual(copiedTrade('sleeper', true), { said: 'Copied.', page: "Sleeper's trade page" });
	assert.equal(copiedTrade('yahoo', false).said, 'This browser would not copy it.');
});

const check = (
	fills: Partial<TradeCheck['fills']> = {},
	drop: PlayerLine | null = null
): TradeCheck => ({
	week: 6,
	basis: '',
	basis_note: '',
	order_basis: 'rest_of_season',
	refreshed: '2026-10-14T19:05:37.917Z',
	read_at: '2026-10-15T19:05:37.917Z',
	trade: row(4.6, 0.5, { drop }),
	fills: {
		yours: true,
		theirs: true,
		yours_open: null,
		theirs_open: null,
		yours_room: true,
		theirs_room: true,
		...fills
	},
	totals: {
		yours: { proj_before: 109.4, proj_after: 120.3, season_before: 31.2, season_after: 35.8 },
		theirs: { proj_before: 104.7, proj_after: 99.1, season_before: 28.0, season_after: 28.5 }
	},
	host_trades_url: '',
	host_note: null
});

void test("the builder's room and scoreboard come from the check, '--' before one", () => {
	assert.deepEqual(checkRoom(check({}, line('Jaxson Dart', 'QB'))), {
		yours: 'Drop Dart',
		theirs: 'Has room'
	});
	assert.deepEqual(checkRoom(check({ yours_room: false, theirs_room: false })), {
		yours: 'No one to drop',
		theirs: 'No one to drop'
	});
	const answer = check();
	assert.deepEqual(bugFigures(answer.totals.theirs, answer.trade.their_gain, -5.6), {
		projBefore: '104.7',
		projAfter: '99.1',
		projChange: '−5.6',
		projTone: 'loss',
		seasonBefore: '28.0',
		seasonAfter: '28.5',
		seasonChange: '+0.5',
		seasonTone: 'gain'
	});
	const below = bugFigures(
		{ proj_before: 50, proj_after: 41.1, season_before: -1.3, season_after: -0.5 },
		0.8,
		-8.9
	);
	assert.equal(below.projChange, '−8.9');
	// The week's change is the API's own, never the totals subtracted here (review M1).
	assert.equal(bugFigures(answer.totals.yours, 4.6, 7.3).projChange, '+7.3');
	assert.equal(below.seasonBefore, '−1.3');
	assert.equal(below.seasonAfter, '−0.5');
	const before = bugFigures(null, null, null);
	assert.equal(before.projAfter, '--');
	assert.equal(before.seasonChange, '--');
	assert.equal(
		bugFigures({ proj_before: null, proj_after: null, season_before: 1, season_after: 2 }, 1, null)
			.projChange,
		'--'
	);
});

void test("the builder's box lists by position, each by this week's Proj, injured reserve last", () => {
	const ir = {
		...line('Tank Bigsby', 'RB', 4.4),
		player: { ...line('Tank Bigsby').player, injured_reserve: true }
	};
	const ordered = rosterOrder([
		line('Kenny Gainwell', 'RB', 9.5),
		ir,
		line('Travis Etienne', 'RB', 14.2),
		line('Zach Charbonnet', 'RB', null),
		line('Patrick Mahomes', 'QB', 17.9)
	]);
	assert.deepEqual(
		ordered.map((l) => l.player.name),
		['Patrick Mahomes', 'Travis Etienne', 'Kenny Gainwell', 'Zach Charbonnet', 'Tank Bigsby']
	);
});

const advice: Pick<
	TradeAdvice,
	| 'basis'
	| 'per_game_basis'
	| 'basis_note'
	| 'projection_read_at'
	| 'projection_scoring'
	| 'player_points'
> = {
	basis:
		"Each team's best trade both lineups gain by, yours first. The other team decides. Gain is a lineup's change in points over replacement a week, weeks 6 to 17.",
	per_game_basis: "A game is our order's points a game.",
	basis_note: 'Our stats omit two-point, missed kick, fumble recovery and safety.',
	projection_read_at: '2026-10-17T02:00:00.000Z',
	projection_scoring: { format: 'ppr', league_own: false },
	player_points: true
};
const TRADE_CLOCK = { zone: 'America/Chicago', zoned: false };
/** The fixture's projection read, before every game in the lines. */
const NOW_66T = Date.parse('2026-10-17T02:00:00.000Z');
const TRADE_LINKS = { record: '/record' };
const PROJ_SAID =
	"Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm.";
const WEEK_ROOM =
	"This week is each lineup's Proj with the trade less without it, set as Lineup sets it. Room is who a roster drops to take two for one.";

void test('closed, the basis names the finder columns only: who decides, Gain, Proj, this week and Room (Lane 66t)', () => {
	const parts = tradeBasis(
		advice,
		'sleeper',
		[line('Cam Skattebo')],
		'none',
		TRADE_LINKS,
		TRADE_CLOCK,
		NOW_66T
	);
	assert.equal(
		basisText(parts),
		`${advice.basis} ${PROJ_SAID} ${WEEK_ROOM} How the order has done`
	);
	assert.deepEqual(
		parts.filter((p) => !p.phone).map((p) => p.text),
		[WEEK_ROOM]
	);
	// A trade opened in the finder holds no defense, so its scoring is not said.
	const opened = tradeBasis(
		advice,
		'sleeper',
		[line('Cam Skattebo'), line('Chiefs D/ST', 'DEF')],
		'trade',
		TRADE_LINKS,
		TRADE_CLOCK,
		NOW_66T
	);
	assert.doesNotMatch(basisText(opened), /defenses/);
});

void test("before the week's projection is read: no week columns to say, the day it arrives (Lane 95)", () => {
	const ahead = {
		...advice,
		week: 6,
		for_week: 7,
		projection_read_at: null,
		projection_arrives_at: '2026-10-22T22:15:00.000Z'
	};
	const parts = tradeBasis(
		ahead,
		'sleeper',
		[line('Cam Skattebo')],
		'none',
		TRADE_LINKS,
		TRADE_CLOCK,
		NOW_66T
	);
	assert.equal(
		basisText(parts),
		`${advice.basis} Week 7 projections expected Thursday. Room is who a roster drops to take two for one. How the order has done`
	);
});

void test("a trade opened or the builder open adds the players' columns, each once", () => {
	const parts = tradeBasis(
		advice,
		'sleeper',
		[line('Cam Skattebo'), line('Chiefs D/ST', 'DEF')],
		'builder',
		TRADE_LINKS,
		TRADE_CLOCK,
		NOW_66T
	);
	assert.equal(
		basisText(parts),
		`${advice.basis} ${advice.per_game_basis} Proj is this week's published projection, PPR nearest your rules, defenses on default scoring, read Fri 9:00 pm. Opp rank is points allowed to his position, 1st fewest. Pts are Sleeper's points so far, Team adds the rows. ${advice.basis_note} ${WEEK_ROOM} How the order has done`
	);
	assert.deepEqual(
		parts.filter((p) => p.href !== undefined).map((p) => p.href),
		['/record']
	);
	assert.deepEqual(
		parts.filter((p) => !p.phone).map((p) => p.text),
		[
			// The builder's phone rows draw no Opp rank (review H2).
			'Opp rank is points allowed to his position, 1st fewest.',
			"Pts are Sleeper's points so far, Team adds the rows.",
			WEEK_ROOM
		]
	);
});

/** The brief's words a fantasy screen never prints, a dash between clauses, a semicolon, and the
 * platform called anything but its name. */
const NEVER = bannedPattern(/\bvalues?\b/);

void test('copy guard: every word the trade table prints is fantasy words, the platform named', () => {
	const copied = copiedTrade('sleeper', true);
	const room = checkRoom(check({}, line('Jaxson Dart', 'QB')));
	const said: string[] = [
		...Object.values(TRADES),
		worthTitle(2),
		worthTitle(1),
		phoneWith({ name: 'Max_Jensen10' }, row(5.7, 0.7)),
		weekLine(row(5.7, 0.7)) ?? '',
		offerText({ name: 'Max_Jensen10' }, row(5.7, 0.7)),
		proposeVerb({ propose: 'unavailable' }, 'sleeper'),
		copied.said,
		copied.page,
		room.yours,
		room.theirs,
		basisText(
			tradeBasis(
				advice,
				'sleeper',
				[line('Cam Skattebo')],
				'trade',
				TRADE_LINKS,
				TRADE_CLOCK,
				NOW_66T
			)
		)
	];
	for (const text of said) {
		assert.doesNotMatch(text, NEVER, text);
	}
});

void test('a trade moving a player whose game has kicked off draws no change this week (Lane 85)', () => {
	const NOW = Date.parse('2026-10-20T17:00:00.000Z');
	const played = (l: PlayerLine): PlayerLine => ({
		...l,
		facts: { ...l.facts, kickoff: '2026-10-18T17:00:00.000Z', played: true, game_state: 'final' }
	});
	const ahead = (l: PlayerLine): PlayerLine => ({
		...l,
		facts: { ...l.facts, kickoff: '2026-10-25T17:00:00.000Z', game_state: 'upcoming' }
	});
	const open = row(4.6, 0.5, { give: [ahead(line('Aaron Rodgers', 'QB'))], get: [], drop: null });
	const done = row(4.6, 0.5, { get: [played(line('Cam Skattebo'))] });
	const answer = {
		teams: [team(7, 'thatmattkelley', [open]), team(8, 'Max_Jensen10', [done])]
	};
	const held = heldTrades(answer, NOW);
	assert.deepEqual(
		held.teams.map((t) => t.trades.map((r) => [r.my_proj_change, r.their_proj_change])),
		[[[7.3, 2.5]], [[null, null]]]
	);
	// The trade itself stays: for next week, its Gain unchanged.
	const heldDone = held.teams[1]?.trades[0];
	assert.ok(heldDone);
	assert.equal(heldDone.my_gain, 4.6);
	assert.equal(weekLine(heldDone), null);
	assert.equal(weekWord(heldDone.my_proj_change), '--');
	// Nothing locked: the answer as it came.
	const quiet = { teams: [team(7, 'thatmattkelley', [open])] };
	assert.equal(heldTrades(quiet, NOW), quiet);
	// The builder's check: no week figure before or after.
	const checked = heldCheck({ ...check(), trade: done }, NOW);
	assert.equal(checked.trade.my_proj_change, null);
	assert.deepEqual(
		[checked.totals.yours.proj_before, checked.totals.theirs.proj_after],
		[null, null]
	);
	assert.equal(checked.totals.yours.season_after, 35.8);
	const fine = { ...check(), trade: open };
	assert.equal(heldCheck(fine, NOW), fine);
});

void test('the basis says when Final and the stats land while a row waits on them (Lane 85)', () => {
	const played = line('Cam Skattebo');
	const final = {
		...played,
		facts: {
			...played.facts,
			kickoff: '2026-10-18T17:00:00.000Z',
			played: true,
			game_state: 'final' as const
		}
	};
	const text = basisText(
		tradeBasis(advice, 'sleeper', [final], 'none', TRADE_LINKS, TRADE_CLOCK, NOW_66T)
	);
	assert.ok(text.includes(KICKED_OFF_PART), text);
});

void test("an opened trade's and the builder's phone say what Avg and Last count once a final is in (Lane 115 fix round 1, HIGH-1)", () => {
	// Sunday's final counted from Sleeper's points, Monday's game still to come.
	const sunday = line('Cam Skattebo');
	const final: PlayerLine = {
		...sunday,
		facts: {
			...sunday.facts,
			kickoff: '2026-10-18T17:00:00.000Z',
			played: true,
			game_state: 'final',
			last_games: [{ week: 6, points: 25, source: 'platform' }]
		}
	};
	const monday = Date.parse('2026-10-20T00:00:00.000Z');
	for (const opened of ['trade', 'builder'] as const) {
		const parts = tradeBasis(advice, 'sleeper', [final], opened, TRADE_LINKS, TRADE_CLOCK, monday);
		const phone = drawnText(parts, 'phone');
		assert.ok(phone.includes(phoneFinalsPart('sleeper')), `${opened}: ${phone}`);
		assert.ok(!phone.includes(KICKED_OFF_PART), `${opened}: ${phone}`);
	}
});

void test('the verdict draws each side rest of season, tagged where that side would not take it (Lane 277)', () => {
	const answered = {
		...check(),
		trade: { ...check().trade, my_rest_of_season: 21.6, their_rest_of_season: -21.6 },
		acceptable: { yours: true, theirs: false }
	};
	assert.deepEqual(restFigure(answered, 'yours'), { text: '+21.6', tone: 'gain', refuses: false });
	assert.deepEqual(restFigure(answered, 'theirs'), {
		text: `${MINUS}21.6`,
		tone: 'loss',
		refuses: true
	});
	// Before an answer, the none mark every verdict cell draws.
	assert.deepEqual(restFigure(null, 'yours'), { text: BOX.none, tone: 'even', refuses: false });
	// An older answer with no figure draws the cell empty, never a figure we did not read.
	assert.deepEqual(restFigure(check(), 'theirs'), { text: '', tone: 'even', refuses: false });
	// A figure with no acceptable (an older answer) tags no side.
	const untold = { ...answered, acceptable: undefined };
	assert.equal(restFigure(untold, 'theirs').refuses, false);
});

void test('the answer line leads with the side that would not take it (Lane 277)', () => {
	assert.equal(refusalWords({ yours: true, theirs: false }), TRADES.theyGiveUp);
	assert.equal(refusalWords({ yours: false, theirs: true }), TRADES.youGiveUp);
	assert.equal(refusalWords({ yours: false, theirs: false }), TRADES.bothGiveUp);
	assert.equal(refusalWords({ yours: true, theirs: true }), null);
	assert.equal(refusalWords(undefined), null);
	assert.equal(TRADES.theyGiveUp, 'They give up more rest of season than they get.');
	assert.equal(TRADES.noIdea, 'No idea they would take.');
});
