// The trade builder's behaviour and words: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { BoxRow } from '../box/box.ts';
import { TRADES } from '../box/trades.ts';
import type { PlayerLine, TradeCheck, TradeOffer, TradeRow, TradeTeam } from './api.ts';
import {
	ANALYZER_LINES,
	BAR_FLOOR,
	BUILDER_LINES,
	IDEAS_SHOWN,
	MAX_A_SIDE,
	builtFrom,
	checkInput,
	checkWords,
	countWords,
	emptyNote,
	fillsWords,
	offerPresets,
	fillsBoth,
	gainBars,
	ideaPlaces,
	moreWords,
	noIdeasFrom,
	openingPicks,
	pickPrompt,
	pickable,
	presetsFrom,
	proposable,
	rosterRow,
	samePicks,
	shareText,
	teamChoice,
	toggle
} from './builder.ts';

const line = (
	name: string,
	position = 'RB',
	over: Partial<PlayerLine['player']> = {}
): PlayerLine => ({
	player: {
		host_id: `h-${name}`,
		board_id: `b-${name}`,
		name,
		position,
		team: 'TB',
		injured_reserve: false,
		...over
	},
	headshot: null,
	slug: null,
	position_rank: 14,
	points_over_replacement: 1.2,
	rest_of_season_per_game: null,
	week_projection: null,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: {
		week: 6,
		opponent: 'BUF',
		home: false,
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

const row = (over: Partial<TradeRow> = {}): TradeRow => ({
	give: [line('Kyren Williams')],
	get: [line('Nico Collins', 'WR')],
	drop: null,
	drop_reason: null,
	my_gain: 2.1,
	their_gain: -0.8,
	close_for_them: true,
	my_proj_change: 1.4,
	their_proj_change: -2.2,
	...over
});

const check = (
	over: Partial<TradeRow> = {},
	fills: Partial<TradeCheck['fills']> = {}
): TradeCheck => ({
	week: 6,
	basis: 'The scoreboard is each lineup before and after the trade.',
	basis_note: '',
	order_basis: 'rest_of_season',
	refreshed: '2026-10-14T19:05:37.917Z',
	read_at: '2026-10-15T19:05:37.917Z',
	trade: row(over),
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
		yours: { proj_before: 98.4, proj_after: 99.8, season_before: 41.2, season_after: 43.3 },
		theirs: { proj_before: 101.0, proj_after: 98.8, season_before: 38.0, season_after: 37.2 }
	},
	host_trades_url: 'https://sleeper.com/leagues/1/team',
	host_note: null
});

void test('a roster with no one to drop says so before any gain, and one with room names the drop', () => {
	assert.equal(
		checkWords(check({}, { yours_room: false })),
		'Your roster has no one to drop to make room.'
	);
	assert.equal(
		checkWords(check({}, { theirs_room: false })),
		'Their roster has no one to drop to make room.'
	);
	assert.match(
		checkWords(check({ drop: line('Jaxson Dart', 'QB') })),
		/You drop Jaxson Dart to make room\.$/
	);
	// A drop this week's lineup starts says who takes his spot, in the API's sentence (Lane 66u).
	const reason =
		'Dart starts at QB for you this week, and Mahomes takes that spot after the trade.';
	assert.match(
		checkWords(check({ drop: line('Jaxson Dart', 'QB'), drop_reason: reason })),
		/You drop Jaxson Dart to make room\. Dart starts at QB for you this week, and Mahomes takes that spot after the trade\.$/
	);
});

void test('the answer line asks for what is missing, and says it is checking once both sides hold a player', () => {
	assert.equal(pickPrompt({ team: 3, give: [], get: [] }), BUILDER_LINES.pickBoth);
	assert.equal(pickPrompt({ team: 3, give: [], get: ['b'] }), BUILDER_LINES.pickYours);
	assert.equal(pickPrompt({ team: 3, give: ['a'], get: [] }), BUILDER_LINES.pickTheirs);
	assert.equal(pickPrompt({ team: 3, give: ['a'], get: ['b'] }), BUILDER_LINES.checking);
	assert.equal(BUILDER_LINES.checking, 'Checking the trade');
	assert.equal(BUILDER_LINES.full, 'Two picked, tap one to put him back');
});

void test('the answer line says what each lineup gains or loses, in points over replacement a week', () => {
	assert.equal(
		checkWords(check()),
		'Your lineup gains 2.1 points over replacement a week, theirs loses 0.8.'
	);
	assert.equal(
		checkWords(check({ my_gain: 1.5, their_gain: 0.6, close_for_them: false })),
		'Both lineups gain: yours 1.5 points over replacement a week, theirs 0.6.'
	);
	assert.equal(
		checkWords(check({ my_gain: -3, their_gain: 4.2 })),
		'Your lineup loses 3.0 points over replacement a week, theirs gains 4.2.'
	);
	assert.equal(
		checkWords(check({ my_gain: 0, their_gain: 0 })),
		'Neither lineup changes on our order.'
	);
	assert.equal(
		checkWords(check({ my_gain: 0, their_gain: 1.1 })),
		'Your lineup does not change, theirs gains 1.1 points over replacement a week.'
	);
	assert.equal(
		checkWords(check({ drop: line('Jaxson Dart', 'QB') })),
		'Your lineup gains 2.1 points over replacement a week, theirs loses 0.8. You drop Jaxson Dart to make room.'
	);
});

/** A line with his rest-of-season points a game. */
const figured = (l: PlayerLine, perGame: number | null): PlayerLine => ({
	...l,
	rest_of_season_per_game: perGame
});

void test("the answer line names the trade's players with their rest-of-season points a game", () => {
	assert.equal(
		checkWords(
			check({
				give: [figured(line('Kyren Williams'), 14.2)],
				get: [figured(line('Nico Collins', 'WR'), 17.84)]
			})
		),
		'Your lineup gains 2.1 points over replacement a week, theirs loses 0.8. You give Kyren Williams (14.2 a game) for Nico Collins (17.8 a game).'
	);
	assert.equal(
		checkWords(
			check({
				give: [figured(line('Kyren Williams'), 14.2), figured(line('Jordan Mason'), 9)],
				get: [figured(line('Nico Collins', 'WR'), null)],
				drop: line('Jaxson Dart', 'QB')
			})
		),
		'Your lineup gains 2.1 points over replacement a week, theirs loses 0.8. You give Kyren Williams (14.2 a game) and Jordan Mason (9.0 a game) for Nico Collins. You drop Jaxson Dart to make room.'
	);
	assert.doesNotMatch(checkWords(check()), /You give/, 'no figure, no players named');
});

void test('a roster the trade leaves short says so before any gain', () => {
	assert.equal(
		checkWords(check({}, { yours: false, yours_open: 'RB2' })),
		'Your roster would not fill RB2.'
	);
	assert.equal(
		checkWords(check({}, { theirs: false, theirs_open: 'TE' })),
		'Their roster would not fill TE.'
	);
	assert.equal(
		checkWords(check({}, { yours: false, yours_open: 'Flex' })),
		'Your roster would not fill the flex.'
	);
	assert.equal(
		checkWords(check({}, { yours: false, yours_open: null })),
		'Your roster would not fill every slot.'
	);
});

void test('a player is picked only at QB, RB, WR and TE, named by the host and off injured reserve', () => {
	assert.ok(pickable(line('Kyren Williams')));
	assert.ok(!pickable(line('Brandon Aubrey', 'K')));
	assert.ok(!pickable(line('Houston Texans', 'DEF')));
	assert.ok(pickable(line('Not On Our Board', 'WR', { board_id: null })));
	assert.ok(!pickable(line('No Host Id', 'WR', { host_id: '' })));
	assert.ok(!pickable(line('Hurt', 'WR', { injured_reserve: true })));
	const listed = line('Listed', 'WR');
	assert.ok(
		!pickable({
			...listed,
			facts: {
				...listed.facts,
				designation: { status: 'injured_reserve', as_of: '2026-10-15T00:00:00Z' }
			}
		})
	);
});

void test('a tap picks up to two a side and a second tap puts him back', () => {
	assert.deepEqual(toggle([], 'a'), ['a']);
	assert.deepEqual(toggle(['a'], 'b'), ['a', 'b']);
	assert.deepEqual(toggle(['a', 'b'], 'c'), ['a', 'b'], 'a third waits for one put back');
	assert.deepEqual(toggle(['a', 'b'], 'a'), ['b']);
	assert.equal(MAX_A_SIDE, 2);
});

void test('the check is asked only once both sides hold a player', () => {
	assert.equal(checkInput({ team: 3, give: ['a'], get: [] }), null);
	assert.equal(checkInput({ team: null, give: ['a'], get: ['b'] }), null);
	assert.deepEqual(checkInput({ team: 3, give: ['a'], get: ['b', 'c'] }), {
		team: 3,
		give: ['a'],
		get: ['b', 'c']
	});
});

void test("a finder row's Build from this fills the builder with that trade", () => {
	const team = { roster_id: 7 } as TradeTeam;
	assert.deepEqual(builtFrom(team, row({ give: [line('A'), line('B')], get: [line('C', 'WR')] })), {
		team: 7,
		give: ['h-A', 'h-B'],
		get: ['h-C']
	});
	assert.equal(builtFrom(team, row({ give: [line('A', 'RB', { host_id: '' })] })), null);
});

void test("a team is chosen by its name and record, the standings' people", () => {
	assert.equal(
		teamChoice({ name: 'Muttdogs', owner: 'muttdog', record: { wins: 5, losses: 0, ties: 0 } }),
		'Muttdogs, muttdog, 5-0'
	);
});

/** A team with its roster and its trades, best first as the API sends them. */
const team = (id: number, name: string, trades: TradeRow[]): TradeTeam => ({
	roster_id: id,
	name,
	owner: name.toLowerCase(),
	record: { wins: 3, losses: 2, ties: 0 },
	roster: [],
	trades,
	note: null
});

void test('our ideas are the best trade with each team, best first, each loading its picks', () => {
	const muttdogs = team(4, 'Muttdogs', [
		row({ my_gain: 1.8, their_gain: 0.5, close_for_them: false }),
		row({ my_gain: 9, their_gain: 0.1, close_for_them: true })
	]);
	const rangers = team(9, 'Bower Rangers', [
		row({
			give: [line('Jeremiyah Love')],
			get: [line('Tre Tucker', 'WR'), line('MarShawn Lloyd')],
			my_gain: 2.7,
			their_gain: 0.6,
			close_for_them: false
		})
	]);
	const empty = team(2, 'Ball Snatchers', []);
	const presets = presetsFrom([muttdogs, rangers, empty]);
	assert.deepEqual(
		presets.map((p) => [p.team.name, p.deal, p.gains, p.mark]),
		[
			['Bower Rangers', 'Love for Tucker and Lloyd', '+2.7 yours, +0.6 theirs', 'Best'],
			['Muttdogs', 'Williams for Collins', '+1.8 yours, +0.5 theirs', null]
		]
	);
	assert.deepEqual(presets[0]?.picks, {
		team: 9,
		give: ['h-Jeremiyah Love'],
		get: ['h-Tre Tucker', 'h-MarShawn Lloyd']
	});
	// A lone idea is not called Best: there is nothing to be best among.
	assert.equal(presetsFrom([muttdogs])[0]?.mark, null);
	// A trade holding a player the host names no id for cannot be ticked: no preset.
	const unnamed = team(5, 'Nameless', [row({ get: [line('X', 'WR', { host_id: '' })] })]);
	assert.deepEqual(presetsFrom([unnamed]), []);
});

void test("the ideas row names its cards as this league's teams, the best three and the rest behind N more", () => {
	assert.equal(ANALYZER_LINES.ideas, 'Our ideas, by team');
	assert.equal(IDEAS_SHOWN, 3);
	assert.equal(moreWords(8), '8 more');
});

void test('the screen opens on the team our best idea names with nothing ticked, or no team', () => {
	const presets = presetsFrom([team(9, 'Bower Rangers', [row({ close_for_them: false })])]);
	assert.deepEqual(openingPicks(presets), { team: 9, give: [], get: [] });
	assert.deepEqual(openingPicks([]), { team: null, give: [], get: [] });
	assert.equal(
		ANALYZER_LINES.noTeam,
		'Pick a team to trade with, then tick a player on each side.'
	);
});

void test('with no trade worth proposing, no idea is Best and the screen opens on no team', () => {
	// Every team's best trade is a close call for them: the decision proposes none (worthProposing).
	const presets = presetsFrom([
		team(4, 'Muttdogs', [row({ my_gain: 3, close_for_them: true })]),
		team(9, 'Bower Rangers', [row({ my_gain: 1, close_for_them: true })])
	]);
	assert.equal(presets.length, 2);
	assert.ok(presets.every((p) => p.mark === null && !p.lead));
	assert.deepEqual(openingPicks(presets), { team: null, give: [], get: [] });
	// A trade that loses the member's lineup is not proposed either.
	const losing = presetsFrom([team(4, 'Muttdogs', [row({ my_gain: -1, close_for_them: false })])]);
	assert.equal(openingPicks(losing).team, null);
});

/** An answer for picks, both rosters filled unless said. */
const answeredFor = (
	picks: { team: number; give: string[]; get: string[] },
	fills: Partial<TradeCheck['fills']> = {}
) => ({ picks, check: check({}, fills) });

void test('Propose and Share act only on the answer read for the team and ticks on screen', () => {
	const loveForWaddle = { team: 4, give: ['love'], get: ['waddle'] };
	const read = answeredFor(loveForWaddle);
	assert.ok(proposable(read, loveForWaddle));
	assert.ok(proposable(read, { team: 4, give: ['love'], get: ['waddle'] }), 'the same ticks');
	// The race: an idea with another team is tapped, its check still out; the last answer stays drawn
	// but no verb copies Love for Waddle as a trade with Dad Runners.
	assert.ok(!proposable(read, { team: 7, give: ['mahomes'], get: ['burden', 'stevenson'] }));
	// A third tick while the next check is read: the answer is for two players, the ticks hold three.
	assert.ok(!proposable(read, { team: 4, give: ['love', 'gainwell'], get: ['waddle'] }));
	assert.ok(!proposable(null, loveForWaddle), 'no answer yet');
});

void test('a refused answer gates Propose as it gates Share: no verb on a trade a roster cannot make', () => {
	const picks = { team: 4, give: ['love'], get: ['waddle'] };
	assert.ok(!proposable(answeredFor(picks, { yours: false, yours_open: 'RB2' }), picks));
	assert.ok(!proposable(answeredFor(picks, { theirs: false, theirs_open: 'TE' }), picks));
	assert.ok(!proposable(answeredFor(picks, { yours_room: false }), picks));
	assert.ok(!proposable(answeredFor(picks, { theirs_room: false }), picks));
});

void test("a roster row past its kickoff shows his points in the week's cell, as the Lineup's Pts does", () => {
	const base = { proj: 14.1, pts: null as number | null };
	const at = (state: BoxRow['state'], pts: number | null): BoxRow =>
		({ ...base, pts, state }) as BoxRow;
	assert.equal(rosterRow(at('upcoming', null)).proj, 14.1, 'still to play: the projection');
	assert.equal(rosterRow(at(null, null)).proj, 14.1, 'no game state: as drawn');
	assert.equal(rosterRow(at('final', 22.4)).proj, 22.4, 'final: his points');
	assert.equal(rosterRow(at('kicked_off', 6)).proj, 6, 'under way: his points so far');
	assert.equal(rosterRow(at('final', null)).proj, null, 'final with no points read: "--"');
});

void test("the roster switch counts each side's ticks after its name, nothing for none", () => {
	assert.equal(countWords([]), '');
	assert.equal(countWords(['a']), ', 1');
	assert.equal(countWords(['a', 'b']), ', 2');
});

void test('a preset is pressed while the ticks hold its trade, in any order', () => {
	const a = { team: 9, give: ['x'], get: ['y', 'z'] };
	assert.ok(samePicks(a, { team: 9, give: ['x'], get: ['z', 'y'] }));
	assert.ok(!samePicks(a, { team: 8, give: ['x'], get: ['y', 'z'] }));
	assert.ok(!samePicks(a, { team: 9, give: ['x'], get: ['y'] }));
	assert.ok(!samePicks(a, { team: 9, give: ['x', 'w'], get: ['y', 'z'] }));
});

void test('each side draws a bar as a share of the longer gain, small gains short', () => {
	assert.deepEqual(gainBars(4, -2), { yours: 1, theirs: 0.5 });
	assert.deepEqual(gainBars(0.5, 0.25), { yours: 0.5 / BAR_FLOOR, theirs: 0.25 / BAR_FLOOR });
	assert.deepEqual(gainBars(null, null), { yours: 0, theirs: 0 });
});

void test('Share copies the trade in our words, and only a trade both rosters can make is shared', () => {
	assert.equal(
		shareText({ name: 'Muttdogs' }, check({ drop: line('Jaxson Dart', 'QB') })),
		'Trade with Muttdogs: Kyren Williams (RB TB) for Nico Collins (WR TB). Your lineup gains 2.1 points over replacement a week, theirs loses 0.8. You drop Jaxson Dart to make room.'
	);
	assert.ok(fillsBoth(check()));
	assert.ok(!fillsBoth(check({}, { yours: false, yours_open: 'RB2' })));
	assert.ok(!fillsBoth(check({}, { theirs_room: false })));
});

void test('copy guard: the builder says no trading words, dashes or semicolons', () => {
	const said = [
		...Object.values(BUILDER_LINES),
		...Object.values(ANALYZER_LINES),
		shareText({ name: 'Muttdogs' }, check()),
		...presetsFrom([team(4, 'Muttdogs', [row()])]).flatMap((p) => [p.deal, p.gains]),
		checkWords(check()),
		checkWords(check({ my_gain: 1, their_gain: 1, close_for_them: false })),
		checkWords(check({}, { yours: false, yours_open: 'Flex' }))
	];
	for (const text of said) {
		assert.doesNotMatch(text, bannedPattern(/\b(value|win|wins|lose a trade|fair|grade)\b/), text);
	}
});

void test('a side that would not take the trade leads the answer line, the players and drop after (Lane 277)', () => {
	const refused = {
		...check({ drop: line('Jaxson Dart', 'QB') }),
		acceptable: { yours: true, theirs: false }
	};
	assert.equal(
		checkWords(refused),
		'They give up more rest of season than they get. You drop Jaxson Dart to make room.'
	);
	assert.match(
		checkWords({ ...check(), acceptable: { yours: false, theirs: true } }),
		/^You give up more rest of season than you get\./
	);
	// A roster the trade leaves short is said first: no trade to take.
	assert.equal(
		checkWords({
			...check({}, { yours: false, yours_open: 'RB2' }),
			acceptable: refused.acceptable
		}),
		'Your roster would not fill RB2.'
	);
	// Both take it, or an older answer: the gains, as before.
	assert.match(
		checkWords({ ...check(), acceptable: { yours: true, theirs: true } }),
		/^Your lineup gains/
	);
	assert.match(checkWords(check()), /^Your lineup gains/);
});

void test('a team the finder lists no trade with keeps its place in the ideas row, said (B271)', () => {
	const muttdogs = team(4, 'Muttdogs', [
		row({ my_gain: 1.8, their_gain: 0.5, close_for_them: false })
	]);
	const quiet = team(7, 'Carried by QJs', []);
	const none = noIdeasFrom([muttdogs, quiet]);
	assert.deepEqual(
		none.map((n) => [n.key, n.team.name, n.note]),
		[['none:7', 'Carried by QJs', 'No idea they would take.']]
	);
	const places = ideaPlaces(presetsFrom([muttdogs, quiet]), none);
	assert.deepEqual(
		places.map((p) => p.kind),
		['idea', 'none']
	);
	// No idea with any team: every team's line, nothing to load.
	assert.deepEqual(
		ideaPlaces(presetsFrom([quiet]), noIdeasFrom([quiet])).map((p) => p.kind),
		['none']
	);
});

void test("each team's ideas keep the API's order, the teams ranked by their first idea, fills first (Lane 290, B289)", () => {
	// Inside a team the first idea is the API's, even with a higher gain after it.
	const filling = row({ my_gain: 1.2, their_gain: 0.4, close_for_them: false, fills: 'WR' });
	const richer = row({
		get: [line('Davante Adams', 'WR')],
		my_gain: 3.4,
		their_gain: 0.2,
		close_for_them: false,
		fills: null
	});
	const rangers = team(9, 'Bower Rangers', [filling, richer]);
	// A team whose first idea fills nothing of the member's ranks after one that fills, whatever its
	// gain; a close call for them after both.
	const muttdogs = team(4, 'Muttdogs', [
		row({ my_gain: 2.5, their_gain: 0.6, close_for_them: false, fills: null })
	]);
	const close = team(2, 'Ball Snatchers', [
		row({ my_gain: 5, their_gain: 0.1, close_for_them: true, fills: 'RB' })
	]);
	const presets = presetsFrom([close, muttdogs, rangers]);
	assert.deepEqual(
		presets.map((p) => [p.team.name, p.deal, p.mark, p.fills]),
		[
			['Bower Rangers', 'Williams for Collins', 'Best', 'Fills your WR'],
			['Muttdogs', 'Williams for Collins', null, null],
			['Ball Snatchers', 'Williams for Collins', null, 'Fills your RB']
		]
	);
	assert.deepEqual(openingPicks(presets).team, 9);
	// An older answer (no fills): the teams by their first idea's gain to the tenth, ties in the
	// answer's (standings') order.
	const older = (name: string, id: number, gain: number): TradeTeam =>
		team(id, name, [row({ my_gain: gain, their_gain: 0.5, close_for_them: false })]);
	assert.deepEqual(
		presetsFrom([older('A', 1, 1.04), older('B', 2, 1.4), older('C', 3, 1.01)]).map(
			(p) => p.team.name
		),
		['B', 'A', 'C']
	);
});

void test("an idea's second line says what it fills of the member's lineup, nothing on an older answer", () => {
	assert.equal(fillsWords('WR'), 'Fills your WR');
	assert.equal(fillsWords('QB'), 'Fills your QB');
	assert.equal(fillsWords('FLEX'), 'Fills your flex');
	assert.equal(fillsWords('SUPERFLEX'), 'Fills your superflex');
	assert.equal(fillsWords(null), null);
	assert.equal(fillsWords(undefined), null);
});

void test('an empty team says why by the API reason, the old line when the answer gives none (B283)', () => {
	assert.equal(emptyNote({ empty_reason: 'dropped' }), 'No idea they would take.');
	assert.equal(emptyNote({ empty_reason: 'same_need' }), 'They need what you need.');
	assert.equal(emptyNote({ empty_reason: 'no_need' }), 'Nothing they need from you.');
	assert.equal(emptyNote({ empty_reason: 'nothing' }), 'No idea between you.');
	assert.equal(emptyNote({}), TRADES.noIdea);
	assert.equal(emptyNote({ empty_reason: null }), TRADES.noIdea);
	const same = { ...team(7, 'Carried by QJs', []), empty_reason: 'same_need' as const };
	assert.deepEqual(
		noIdeasFrom([same]).map((n) => n.note),
		['They need what you need.']
	);
});

/** A host offer from Muttdogs (roster 4): the member's Williams for their Collins. */
const offer = (over: Partial<TradeOffer> = {}): TradeOffer => ({
	label: 'Offered to you',
	roster_id: 4,
	name: 'Muttdogs',
	give: ['h-Kyren Williams'],
	get: ['h-Nico Collins'],
	drop: [],
	host_offer_id: 'p-1',
	expires_at: '2026-10-17T20:00:00.000Z',
	read_at: '2026-10-16T12:00:00.000Z',
	...over
});

void test("the host's offers head the ideas row and one tap loads the ticks and the team (Lane 290)", () => {
	const roster = [line('Kyren Williams'), line('Jaxson Dart', 'QB'), line('Harrison Butker', 'K')];
	const muttdogs = {
		...team(4, 'Muttdogs', [row({ close_for_them: false })]),
		roster: [line('Nico Collins', 'WR')]
	};
	const answer = { teams: [muttdogs], roster };
	const now = Date.parse('2026-10-16T12:00:00.000Z');
	const zone = 'America/Chicago';
	const made = offerPresets([offer()], answer, 'sleeper', now, zone).at(0);
	assert.ok(made);
	assert.deepEqual(made, {
		key: 'offer:p-1',
		team: muttdogs,
		label: 'Offered to you',
		deal: 'Williams for Collins',
		expires: 'Ends Sat 3:00 pm',
		picks: { team: 4, give: ['h-Kyren Williams'], get: ['h-Nico Collins'] },
		note: null
	});
	// No expiry where the host states none; the host's drop named; a week out, the date.
	const yahoo = offerPresets(
		[offer({ expires_at: null, drop: ['h-Jaxson Dart'] })],
		answer,
		'yahoo',
		now,
		zone
	).at(0);
	assert.ok(yahoo);
	assert.equal(yahoo.expires, null);
	assert.equal(yahoo.deal, 'Williams for Collins, drop Dart');
	// The check cannot be told the host's drop (it picks its own), so an offer that requires one is
	// answered on the host, never loaded into a verdict for another trade (review M1).
	assert.equal(yahoo.picks, null);
	assert.equal(yahoo.note, 'Answer it on Yahoo.');
	const far = offerPresets(
		[offer({ expires_at: '2026-10-30T20:00:00.000Z' })],
		answer,
		'espn',
		now,
		zone
	);
	assert.match(far[0]?.expires ?? '', /^Ends Oct 30$/);
	// One the builder cannot hold (a kicker) loads nothing and says where to answer it.
	const kicker = offerPresets(
		[offer({ give: ['h-Harrison Butker'] })],
		answer,
		'espn',
		now,
		zone
	).at(0);
	assert.ok(kicker);
	assert.equal(kicker.picks, null);
	assert.equal(kicker.note, 'Answer it on ESPN.');
	// A one-sided offer (Lane 279) says the side that names no player, and loads nothing.
	const oneSided = offerPresets([offer({ give: [] })], answer, 'mfl', now, zone).at(0);
	assert.ok(oneSided);
	assert.equal(oneSided.deal, 'Nothing for Collins');
	assert.equal(oneSided.picks, null);
	// A player the rosters here do not draw (injured reserve or taxi: the API keeps him on the offer)
	// keeps the offer, said and answered on the host (review H1); so does a drop of one.
	for (const unseen of [offer({ get: ['h-On IR'] }), offer({ drop: ['h-On Taxi'] })]) {
		const shown = offerPresets([unseen], answer, 'espn', now, zone).at(0);
		assert.ok(shown);
		assert.equal(shown.deal, 'With an IR or taxi player');
		assert.equal(shown.picks, null);
		assert.equal(shown.note, 'Answer it on ESPN.');
	}
	// Only a team the answer does not hold leaves the offer out.
	assert.deepEqual(offerPresets([offer({ roster_id: 99 })], answer, 'espn', now, zone), []);
	// An offer whose expiry has passed at the page's clock goes, as it lapses with the page open
	// (review L2); one still to come stays.
	const lapses = offer({ expires_at: '2026-10-16T13:00:00.000Z' });
	assert.equal(offerPresets([lapses], answer, 'espn', now, zone).length, 1);
	assert.equal(
		offerPresets([lapses], answer, 'espn', Date.parse('2026-10-16T13:00:00.000Z'), zone).length,
		0
	);
	// At the row's head, before our ideas and the empty teams.
	const places = ideaPlaces(presetsFrom([muttdogs]), noIdeasFrom([team(7, 'Quiet', [])]), [made]);
	assert.deepEqual(
		places.map((p) => p.kind),
		['offer', 'idea', 'none']
	);
	// However many offers are pending, the three cards in sight hold the newest offer and Best, the
	// other offers after Best (review M2).
	const rangers = team(9, 'Bower Rangers', [row({ my_gain: 1, close_for_them: false })]);
	const many = ideaPlaces(presetsFrom([muttdogs, rangers]), [], [made, made, made]);
	assert.deepEqual(
		many.map((p) => (p.kind === 'idea' ? `idea ${p.preset.team.name}` : p.kind)),
		['offer', 'idea Muttdogs', 'offer', 'offer', 'idea Bower Rangers']
	);
	assert.equal(many[1]?.kind === 'idea' && many[1].preset.mark, 'Best');
});
