// The box score's words (Lane 66d), and the copy guard over every one: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LeaguePlayer } from '../api.ts';
import type { PlayerLine, WeekFacts } from '../inseason/api.ts';
import {
	BOX,
	PTS_BASIS,
	boxNumber,
	boxRow,
	expectedWords,
	factsReadLine,
	figureCount,
	figureCountWords,
	gameOf,
	hostRow,
	positionWord,
	projBasis,
	projTotal,
	ptsTotal,
	slotWord,
	statusOf,
	weatherCell
} from './box.ts';

const ZONE = 'America/Chicago';
/** Friday 9:00 pm Central, before every game of the week. */
const READ = '2026-10-17T02:00:00.000Z';
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
	const ir = { rank: 'IR', mark: 'On injured reserve', sits: true, line: null };
	assert.deepEqual(statusOf({ status: 'injured_reserve', as_of: asOf }, false), ir);
	assert.deepEqual(statusOf(null, true), ir);
	assert.equal(statusOf(null, false), null);
	assert.deepEqual(boxRow(line(), 'QB', ZONE).pill, { position: 'QB', rank: 7 });
});

void test('a row carries the projection, not the points a game, and no facts once kicked off', () => {
	const row = boxRow(line(), 'QB', ZONE);
	assert.equal(row.proj, 19.44);
	assert.equal(row.pts, null);
	assert.equal(row.expected, '26.5 to 23');
	assert.equal(row.face.mark, false);
	assert.equal(row.position, 'QB');
	const kicked = boxRow(
		line({}, { kickoff: '2020-01-01T00:00:00.000Z', points_this_week: 12.3 }),
		'QB'
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
		src: 'https://a.espncdn.com/i/teamlogos/nfl/500/hou.png',
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

void test('Totals say how many playing starters have a figure when one lacks it', () => {
	const bye = 'bye' as const;
	const game = { where: 'at ATL', when: 'Sun 12:00 pm' };
	assert.equal(
		figureCount([
			{ proj: 10, game },
			{ proj: null, game: bye }
		]),
		null
	);
	const count = figureCount([
		{ proj: 10, game },
		{ proj: null, game },
		{ proj: null, game: bye }
	]);
	assert.deepEqual(count, { held: 1, of: 2 });
	assert.equal(figureCountWords({ held: 1, of: 2 }), '1 of 2 starters with a figure');
});

void test('totals sum what is held, and a number not held prints as --', () => {
	assert.equal(projTotal([{ proj: 19.44 }, { proj: null }, { proj: 8.1 }]), 27.54);
	assert.equal(projTotal([{ proj: null }]), null);
	assert.equal(ptsTotal([{ pts: null }]), null);
	assert.equal(ptsTotal([{ pts: 3 }, { pts: 4.5 }]), 7.5);
	assert.equal(boxNumber(27.54), '27.5');
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

void test("the screen's basis lines say the Game cell's figures and the facts' read once", () => {
	const older = '2026-10-16T20:00:00.000Z';
	assert.equal(
		factsReadLine(
			[line(), line({}, { game_total: { points: 40, team_points: 20, read_at: older } })],
			ZONE
		),
		"The Game cell shows each club's expected points, his club first, then the kickoff weather, read Fri 3:00 pm Central."
	);
	assert.equal(factsReadLine([line({}, { bye: true })], ZONE), null);
});

/** The words a fantasy screen never uses: the trading and betting registers. */
const BANNED =
	/\b(market|prices?|buy|sell|stock|odds|lines?|spreads?|favou?red|underdog|bets?|betting|vegas)\b/i;

void test('copy guard: every box word is fantasy words, with no dash or semicolon', () => {
	const said = [
		...Object.values(BOX),
		PTS_BASIS,
		projBasis(READ, OWN, true, ZONE),
		projBasis(null, CLOSEST, false, ZONE),
		figureCountWords({ held: 7, of: 8 }),
		factsReadLine([line()], ZONE) ?? ''
	];
	for (const text of said) {
		assert.doesNotMatch(text, BANNED, text);
		assert.doesNotMatch(text, /[–—;]/, text);
	}
});
