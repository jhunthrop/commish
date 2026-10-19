// The box score's words (Lane 66d), and the copy guard over every one: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { LeaguePlayer } from '../api.ts';
import type { PlayerLine, WeekFacts } from '../inseason/api.ts';
import {
	BOX,
	boxNumber,
	boxRow,
	deltaBasis,
	deltaWord,
	easeOf,
	EVIDENCE_BASIS,
	oppRankWord,
	expectedWords,
	factsReadLine,
	gameOf,
	hostRow,
	positionWord,
	projBasis,
	ptsBasis,
	totalsNote,
	totalsPts,
	projTotal,
	ptsTotal,
	slotWord,
	statusOf,
	weatherCell,
	initialName
} from './box.ts';

void test("a name's short form keeps the surname whole: the first initial, then the last name (rereview N2)", () => {
	assert.equal(initialName('Aaron Rodgers'), 'A. Rodgers');
	assert.equal(initialName('Jacory Croskey-Merritt'), 'J. Croskey-Merritt');
	assert.equal(initialName('Marvin Harrison Jr.'), 'M. Harrison');
	assert.equal(initialName('Pele'), 'Pele');
});

const ZONE = 'America/Chicago';
/** Friday 9:00 pm Central, before every game of the week. */
const READ = '2026-10-17T02:00:00.000Z';
/** The clock the facts-read lines are drawn at: the read's own time. Never the real clock. */
const NOW = Date.parse(READ);
const SUNDAY_NOON = '2026-10-18T17:00:00.000Z';

const facts = (over: Partial<WeekFacts> = {}): WeekFacts => ({
	week: 6,
	opponent: 'ATL',
	home: false,
	kickoff: '2099-10-18T17:00:00.000Z',
	bye: false,
	designation: null,
	played: false,
	points_this_week: null,
	last_games: [],
	allowed_to_position: null,
	game_total: { points: 49.5, team_points: 26.5, read_at: READ },
	spread: { side: 'win', points: 3, read_at: READ },
	roof: { kind: 'retractable', abroad: false },
	weather: null,
	...over
});

const player = (over: Partial<LeaguePlayer> = {}): LeaguePlayer => ({
	host_id: 'h1',
	board_id: '4431611',
	name: 'Caleb Williams',
	position: 'QB',
	team: 'CHI',
	injured_reserve: false,
	...over
});

const line = (over: Partial<PlayerLine> = {}, factsOver: Partial<WeekFacts> = {}): PlayerLine => ({
	player: player(),
	headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/4431611.png',
	slug: 'caleb-williams',
	position_rank: 7,
	points_over_replacement: 1.2,
	rest_of_season_per_game: 17.8,
	week_projection: 19.44,
	projection_delta: 0.4,
	opp_rank: 24,
	season_avg: 17.94,
	last_points: 22.4,
	held: false,
	facts: facts(factsOver),
	...over
});

void test("the expected score names his club's points first, the rest of the game second", () => {
	assert.equal(expectedWords(facts()), '26.5 to 23');
	assert.equal(
		expectedWords(facts({ game_total: { points: 42.5, team_points: 20, read_at: READ } })),
		'20 to 22.5'
	);
	assert.equal(expectedWords(facts({ game_total: null })), null);
});

void test('the weather is a glyph and two or three words, the venue first', () => {
	assert.deepEqual(weatherCell(facts({ roof: { kind: 'outdoors', abroad: true } })), {
		glyph: 'abroad',
		words: 'Abroad, no forecast'
	});
	assert.deepEqual(weatherCell(facts({ roof: { kind: 'dome', abroad: false } })), {
		glyph: 'indoors',
		words: 'Indoors'
	});
	assert.deepEqual(weatherCell(facts()), { glyph: 'roof', words: 'Roof TBD' });
	const outdoors = { kind: 'outdoors', abroad: false } as const;
	const weather = (temperature: number, wind: number, chance: number, kind: 'none' | 'snow') => ({
		temperature_f: temperature,
		wind_mph: wind,
		precipitation_chance: chance,
		precipitation_kind: kind,
		read_at: READ
	});
	assert.deepEqual(
		weatherCell(facts({ roof: outdoors, weather: weather(63.4, 12.7, 2, 'none') })),
		{
			glyph: 'wind',
			words: '63°, 13 mph'
		}
	);
	assert.deepEqual(weatherCell(facts({ roof: outdoors, weather: weather(31, 9, 40, 'snow') })), {
		glyph: 'wind',
		words: '31°, 9 mph, 40% snow'
	});
	assert.deepEqual(weatherCell(facts({ roof: outdoors })), {
		glyph: 'outdoors',
		words: 'Outdoors'
	});
	assert.equal(weatherCell(facts({ roof: null })), null);
});

void test('the game cell: the opponent and kickoff, Final once played, the bye', () => {
	assert.deepEqual(gameOf(facts({ kickoff: SUNDAY_NOON }), ZONE), {
		where: 'at ATL',
		when: 'Sun 12:00 pm'
	});
	assert.deepEqual(gameOf(facts({ home: true, played: true }), ZONE), {
		where: 'vs ATL',
		when: 'Final'
	});
	assert.equal(gameOf(facts({ bye: true }), ZONE), 'bye');
	assert.equal(gameOf(facts({ opponent: null }), ZONE), null);
});

void test("a status is Lane 63's pill: the week's word, a season-long list's word in his rank", () => {
	const asOf = '2026-10-16T21:00:00.000Z';
	assert.deepEqual(statusOf({ status: 'questionable', as_of: asOf }, false), {
		rank: null,
		mark: 'Questionable',
		sits: false,
		line: null
	});
	assert.deepEqual(statusOf({ status: 'out', as_of: asOf }, false), {
		rank: null,
		mark: 'Out',
		sits: true,
		line: null
	});
	// A season-long list's chip is the board's (Lane 66n): the API's start of his run under it, or the
	// word alone when the API knows none. Never the read's stamp, which the basis line says.
	assert.deepEqual(
		statusOf(
			{ status: 'injured_reserve', as_of: asOf, since: '2026-09-28T15:00:00.000Z' },
			false,
			ZONE
		),
		{ rank: 'IR', mark: 'IR since Sep 28', sits: true, line: null }
	);
	assert.deepEqual(statusOf({ status: 'injured_reserve', as_of: asOf }, false, ZONE), {
		rank: 'IR',
		mark: 'IR',
		sits: true,
		line: null
	});
	assert.deepEqual(statusOf(null, true), { rank: 'IR', mark: 'IR', sits: true, line: null });
	assert.equal(statusOf(null, false), null);
	assert.deepEqual(boxRow(line(), 'QB', ZONE).pill, { position: 'QB', rank: 7 });
});

void test('a row carries the projection, not the points a game, and no facts once kicked off', () => {
	const row = boxRow(line(), 'QB', ZONE, true, NOW);
	assert.equal(row.proj, 19.44);
	assert.equal(row.pts, null);
	assert.equal(row.expected, '26.5 to 23');
	assert.equal(row.face.mark, false);
	assert.equal(row.position, 'QB');
	const kicked = boxRow(
		line({}, { kickoff: '2026-10-17T01:59:00.000Z', points_this_week: 12.3 }),
		'QB',
		ZONE,
		true,
		NOW
	);
	assert.equal(kicked.expected, null);
	assert.equal(kicked.weather, null);
	assert.equal(kicked.pts, 12.3);
});

void test("a defense's face is its club's mark, said in words", () => {
	const defense = boxRow(
		line({
			player: player({ name: 'Texans D/ST', position: 'DEF', team: 'HOU', board_id: null }),
			headshot: null
		}),
		slotWord('DEF')
	);
	assert.deepEqual(defense.face, {
		src: '/img/clubs/nfl/hou/64',
		mark: true,
		alt: 'Texans defense'
	});
	assert.equal(defense.position, 'D/ST');
	assert.equal(defense.slot, 'D/ST');
	assert.equal(
		hostRow(player({ position: 'DEF', team: 'NO' }), 'D/ST', null).face.alt,
		'Saints defense'
	);
	assert.equal(positionWord('K'), 'K');
});

void test("Totals' note: the projection not in yet, else the playing starters with a Proj when one lacks it", () => {
	const game = { where: 'at ATL', when: 'Sun 12:00 pm' };
	const held = { proj: 10, game };
	const lacking = { proj: null, game };
	const bye = { proj: null, game: 'bye' as const };
	assert.equal(totalsNote([held, lacking, bye], false, 6), 'No projection yet for week 6');
	assert.equal(totalsNote([held, lacking, bye], true, 6), '1 of 2 starters with a Proj');
	assert.equal(totalsNote([held, bye], true, 6), null);
});

void test('Totals add the tenths the column prints, so a reader adding the column gets the bar', () => {
	// The API sends tenths (1.3, 2.4, 3.5, its rule on 1.25, 2.35, 3.45): the total is their sum,
	// cleaned of binary noise, never rounded again.
	const rows = [{ proj: 1.3 }, { proj: 2.4 }, { proj: 3.5 }];
	const column = rows.reduce((sum, r) => sum + Number(boxNumber(r.proj)), 0);
	assert.equal(boxNumber(projTotal(rows)), boxNumber(Math.round(column * 10) / 10));
	assert.equal(projTotal(rows), 7.2);
	assert.equal(ptsTotal([{ pts: 8.8 }, { pts: 0.1 }]), 8.9);
});

void test("Totals' Pts: the printed rows where the host gives each player's, else the host's team total", () => {
	assert.equal(totalsPts([{ pts: 8.7 }, { pts: 3.1 }], true, 87.4), 11.8);
	assert.equal(totalsPts([{ pts: null }, { pts: null }], false, 87.4), 87.4);
	assert.equal(totalsPts([{ pts: null }], false, null), null);
});

void test('totals sum what is held, and a number not held prints as --', () => {
	assert.equal(projTotal([{ proj: 19.4 }, { proj: null }, { proj: 8.1 }]), 27.5);
	assert.equal(projTotal([{ proj: null }]), null);
	assert.equal(ptsTotal([{ pts: null }]), null);
	assert.equal(ptsTotal([{ pts: 3 }, { pts: 4.5 }]), 7.5);
	assert.equal(boxNumber(27.5), '27.5');
	assert.equal(boxNumber(null), '--');
});

const OWN = { format: 'ppr', league_own: true } as const;
const CLOSEST = { format: 'half_ppr', league_own: false } as const;

void test("the Proj line names the scoring, whose it is, the read, and the defenses' scoring when one shows", () => {
	assert.equal(
		projBasis(READ, OWN, false, ZONE),
		"Proj is this week's published projection in PPR scoring, this league's own, read Fri 9:00 pm Central. Our own weekly model replaces it when it passes its test."
	);
	assert.equal(
		projBasis(READ, CLOSEST, true, ZONE),
		"Proj is this week's published projection in half-PPR scoring, the closest match to this league's rules, read Fri 9:00 pm Central. Defenses are on its default defense scoring. Our own weekly model replaces it when it passes its test."
	);
	assert.match(
		projBasis(null, OWN, false, ZONE),
		/in PPR scoring, this league's own, not in yet for this week\./
	);
});

void test("the Pts line names the member's platform where it gives no player's points", () => {
	assert.equal(
		ptsBasis(true, 'sleeper'),
		"Pts are this week's points as your league scores them, -- until his game kicks off."
	);
	assert.equal(
		ptsBasis(false, 'espn'),
		"Pts are this league's team points from ESPN, which gives no points by player."
	);
	assert.equal(
		ptsBasis(false, 'yahoo'),
		"Pts are this league's team points from Yahoo, which gives no points by player."
	);
	assert.equal(
		ptsBasis(false, 'ffpc'),
		"Pts are this league's team points from FFPC, which gives no points by player."
	);
	for (const host of ['espn', 'yahoo', 'ffpc', 'sleeper', 'mfl'] as const) {
		assert.doesNotMatch(ptsBasis(false, host), /\bhost\b/i);
	}
});

void test('the evidence columns print as the Lineup draws them', () => {
	assert.equal(oppRankWord(24), '24th');
	assert.equal(oppRankWord(1), '1st');
	assert.equal(oppRankWord(null), '--');
	assert.equal(easeOf(24, 32), 'easy');
	assert.equal(easeOf(22, 32), 'easy');
	assert.equal(easeOf(21, 32), 'even');
	assert.equal(easeOf(10, 32), 'hard');
	assert.equal(easeOf(11, 32), 'even');
	assert.equal(deltaWord(0.4), '+0.4');
	assert.equal(deltaWord(-0.3), '−0.3');
	// The API sends the change in tenths (api tenth.Round): the cell formats it, signed, and no more.
	assert.equal(deltaWord(0), '0.0');
	assert.equal(deltaWord(-1.2), '−1.2');
	assert.equal(deltaWord(10.4), '+10.4');
	assert.equal(deltaWord(null), '--');
	const row = boxRow(line(), 'QB', ZONE, false);
	assert.deepEqual(row.evidence, {
		oppRank: 24,
		oppOf: null,
		avg: 17.94,
		last: 22.4,
		delta: 0.4,
		season: 17.8
	});
	assert.equal(row.pill?.rank, null, 'the Lineup leaves the rest-of-season rank out');
	assert.equal(boxRow(line(), 'QB', ZONE).pill?.rank, 7, 'the Matchup keeps it');
	assert.equal(
		deltaBasis('2026-10-16T02:00:00.000Z', ZONE),
		'Δ Proj is its change since the read before, Thu 9:00 pm Central.'
	);
	assert.equal(deltaBasis(null, ZONE), null);
});

void test("the screen's basis lines say the Game cell's figures and the facts' read once", () => {
	const older = '2026-10-16T20:00:00.000Z';
	assert.equal(
		factsReadLine(
			[line(), line({}, { game_total: { points: 40, team_points: 20, read_at: older } })],
			ZONE,
			NOW
		),
		"The Game cell shows each club's expected points, his club first, then the kickoff weather, read Fri 3:00 pm Central."
	);
	assert.equal(factsReadLine([line({}, { bye: true })], ZONE, NOW), null);
});

/** The site's copy guard. */
const BANNED = bannedPattern();

void test('copy guard: every box word is fantasy words, with no dash or semicolon', () => {
	const said = [
		...Object.values(BOX),
		ptsBasis(true, 'espn'),
		ptsBasis(false, 'espn'),
		EVIDENCE_BASIS,
		deltaBasis(READ, ZONE) ?? '',
		projBasis(READ, OWN, true, ZONE),
		projBasis(null, CLOSEST, false, ZONE),
		totalsNote([{ proj: null, game: null }], true, 6) ?? '',
		totalsNote([], false, 6) ?? '',
		factsReadLine([line()], ZONE, NOW) ?? ''
	];
	assert.ok(
		said.at(-1)?.startsWith("The Game cell shows each club's expected points"),
		said.at(-1)
	);
	for (const text of said) {
		assert.doesNotMatch(text, BANNED, text);
		assert.doesNotMatch(text, /[–—;]/, text);
	}
});
