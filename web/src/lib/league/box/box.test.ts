// The box score's words (Lane 66d), and the copy guard over every one: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { onListWords } from '#lib/format/designation.ts';
import type { LeaguePlayer } from '../api.ts';
import type { PlayerLine, WeekFacts } from '../inseason/api.ts';
import {
	BOX,
	boxNumber,
	boxRow,
	deltaWord,
	easeOf,
	fitName,
	oppRankWord,
	expectedScoreWords,
	expectedWords,
	gameOf,
	heldGame,
	hostRow,
	positionWord,
	totalsNote,
	totalsPts,
	projTotal,
	ptsTotal,
	slotWord,
	statusOf,
	weatherCell,
	initialName,
	onReserve,
	reserveRow
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
	assert.deepEqual(gameOf({ facts: facts({ kickoff: SUNDAY_NOON }) }, 'ATL', ZONE, NOW), {
		where: 'at ATL',
		when: 'Sun 12:00 pm'
	});
	assert.deepEqual(gameOf({ facts: facts({ home: true, played: true }) }, 'ATL', ZONE, NOW), {
		where: 'vs ATL',
		when: 'Final'
	});
	assert.equal(gameOf({ facts: facts({ bye: true }) }, 'ATL', ZONE, NOW), 'bye');
	assert.equal(gameOf({ facts: facts({ opponent: null }) }, 'ATL', ZONE, NOW), null);
	// A free agent (Lane 123): his club cell is FA and his game cell says he has no club, never a
	// game or a bye of a club he left.
	assert.equal(gameOf({ facts: facts({ opponent: null }) }, 'FA', ZONE, NOW), 'no-club');
	assert.equal(gameOf({ facts: facts({ kickoff: SUNDAY_NOON }) }, 'FA', ZONE, NOW), 'no-club');
	assert.equal(heldGame('no-club'), null);
	assert.equal(heldGame('bye'), null);
	assert.equal(BOX.noClub, 'No club');
});

void test("a cached field behind the page's clock: the row turns at kickoff, the web's word (Lane 178)", () => {
	const cached = line(
		{ game_state: { state: 'not_started', word: 'Next kickoff' } },
		{ kickoff: SUNDAY_NOON, game_state: 'upcoming' }
	);
	const before = boxRow(cached, 'QB', ZONE, true, NOW);
	assert.equal(before.state, 'upcoming');
	assert.deepEqual(before.game, { where: 'at ATL', when: 'Sun 12:00 pm' });
	// On Monday the page's clock is past the kickoff the field was read before.
	const monday = Date.parse('2026-10-19T16:00:00.000Z');
	const after = boxRow(cached, 'QB', ZONE, true, monday);
	assert.equal(after.state, 'kicked_off');
	assert.equal(after.toCome, false);
	assert.deepEqual(after.game, { where: 'at ATL', when: 'Kicked off' });
	assert.equal(after.expected, null);
});

void test('the game cell reads the API field first and prints its word (Lane 178)', () => {
	const upcoming = facts({ kickoff: SUNDAY_NOON });
	assert.deepEqual(
		gameOf({ facts: upcoming, game_state: { state: 'final', word: 'Final' } }, 'ATL', ZONE, NOW),
		{ where: 'at ATL', when: 'Final' }
	);
	assert.deepEqual(
		gameOf(
			{ facts: upcoming, game_state: { state: 'kicked_off', word: 'Under way' } },
			'ATL',
			ZONE,
			NOW
		),
		{ where: 'at ATL', when: 'Under way' }
	);
	// Before his kickoff the cell is the kickoff on the member's clock, whatever the field's word.
	assert.deepEqual(
		gameOf(
			{ facts: upcoming, game_state: { state: 'not_started', word: 'Next kickoff' } },
			'ATL',
			ZONE,
			NOW
		),
		{ where: 'at ATL', when: 'Sun 12:00 pm' }
	);
});

void test("a game kicked off with no final says so, by the API's state (Lane 80)", () => {
	const monday = facts({ kickoff: SUNDAY_NOON, game_state: 'kicked_off' });
	assert.deepEqual(gameOf({ facts: monday }, 'ATL', ZONE, NOW), {
		where: 'at ATL',
		when: 'Kicked off'
	});
	assert.deepEqual(
		gameOf({ facts: facts({ game_state: 'final', played: true }) }, 'ATL', ZONE, NOW),
		{
			where: 'at ATL',
			when: 'Final'
		}
	);
	// No expected score and no weather once kicked off, whatever the browser's clock says.
	const row = boxRow(
		line({}, { kickoff: SUNDAY_NOON, game_state: 'kicked_off' }),
		'QB',
		ZONE,
		true,
		NOW
	);
	assert.equal(row.expected, null);
	assert.equal(row.weather, null);
	assert.deepEqual(row.game, { where: 'at ATL', when: 'Kicked off' });
});

void test("a status is Lane 63's pill: the week's word, a season-long list's word in his rank", () => {
	const asOf = '2026-10-16T21:00:00.000Z';
	assert.deepEqual(statusOf({ status: 'questionable', as_of: asOf }, false), {
		rank: null,
		mark: 'Questionable',
		short: 'Q',
		sits: false,
		line: null,
		question: true
	});
	assert.deepEqual(statusOf({ status: 'out', as_of: asOf }, false), {
		rank: null,
		mark: 'Out',
		short: 'Out',
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
		// The tight row's chip is none: the pill already says IR (Lane 268).
		{ rank: 'IR', mark: 'IR since Sep 28', short: null, sits: true, line: null }
	);
	assert.deepEqual(statusOf({ status: 'injured_reserve', as_of: asOf }, false, ZONE), {
		rank: 'IR',
		mark: 'IR',
		short: null,
		sits: true,
		line: null
	});
	assert.deepEqual(statusOf(null, true), {
		rank: 'IR',
		mark: 'IR',
		short: null,
		sits: true,
		line: null
	});
	assert.equal(statusOf(null, false), null);
	assert.deepEqual(boxRow(line(), 'QB', ZONE, true, NOW).pill, {
		position: 'QB',
		rank: 7,
		ranked: true
	});
	// A screen that draws no rank says none, and the shelf takes the build's (Lane 115, B93).
	assert.deepEqual(boxRow(line(), 'QB', ZONE, false, NOW).pill, {
		position: 'QB',
		rank: null,
		ranked: false
	});
});

void test('a row on a season-long list carries no rank, whatever the API sends (Lane 128, B106)', () => {
	const asOf = '2026-10-14T02:03:35.613Z';
	const ir = { status: 'injured_reserve', as_of: asOf, since: '2026-09-24T22:00:00.000Z' } as const;
	const listed = boxRow(line({}, { designation: ir }), 'QB', ZONE, true, NOW);
	assert.deepEqual(listed.pill, { position: 'QB', rank: null, ranked: true });
	assert.equal(listed.status?.rank, 'IR');
	// The platform's own IR mark is the same list.
	const hostIr = boxRow(line({ player: player({ injured_reserve: true }) }), 'BN', ZONE, true, NOW);
	assert.equal(hostIr.pill?.rank, null);
	// A PUP or NFI list too; a week's designation keeps his rank.
	// His week is not his (fix round 1): no Proj, no Opp rank and no change in either, on any screen.
	assert.equal(listed.proj, null);
	assert.deepEqual(
		[listed.evidence.oppRank, listed.evidence.oppOf, listed.evidence.delta],
		[null, null, null]
	);
	assert.equal(listed.evidence.avg, 17.94, 'his season stands');
	assert.equal(hostIr.proj, null);
	const pup = boxRow(
		line({}, { designation: { status: 'pup', as_of: asOf } }),
		'QB',
		ZONE,
		true,
		NOW
	);
	assert.equal(pup.pill?.rank, null);
	// The one list (fix round 1, MEDIUM-1): suspended by itself, and an out the API flags as for the
	// season; his pill says the list ("WR Susp"), his week is not his.
	const susp = boxRow(
		line({}, { designation: { status: 'suspended', as_of: asOf } }),
		'WR',
		ZONE,
		true,
		NOW
	);
	assert.deepEqual([susp.pill?.rank, susp.status?.rank, susp.proj], [null, 'Susp', null]);
	const season = boxRow(
		line({}, { designation: { status: 'out', as_of: asOf, season_long: true } }),
		'WR',
		ZONE,
		true,
		NOW
	);
	assert.deepEqual([season.pill?.rank, season.status?.rank, season.proj], [null, 'Out', null]);
	assert.equal(onListWords('Susp'), 'On Susp');
	assert.equal(onListWords('Out'), 'Out for the season');
	assert.equal(onListWords('IR'), 'On IR');
	for (const status of ['questionable', 'doubtful', 'out'] as const) {
		const week = boxRow(line({}, { designation: { status, as_of: asOf } }), 'QB', ZONE, true, NOW);
		assert.equal(week.pill?.rank, 7, status);
		assert.equal(week.proj, 19.44, status);
		assert.equal(week.evidence.oppRank, 24, status);
	}
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

void test('Questionable and Doubtful draw only before his game, Out and IR whatever the clock (Lane 104, B57)', () => {
	const asOf = '2026-10-16T21:00:00.000Z';
	const played = { kickoff: '2026-10-17T01:59:00.000Z', state: 'final' as const };
	const tagged = (status: 'questionable' | 'doubtful' | 'out', facts = {}, ir = false) =>
		boxRow(
			line(
				{ player: player({ injured_reserve: ir }) },
				{ ...facts, designation: { status, as_of: asOf } }
			),
			'WR',
			ZONE,
			false,
			NOW
		).status?.mark ?? null;
	assert.equal(tagged('questionable'), 'Questionable');
	assert.equal(tagged('doubtful'), 'Doubtful');
	assert.equal(tagged('questionable', played), null);
	assert.equal(tagged('doubtful', played), null);
	assert.equal(tagged('out', played), 'Out');
	// A Questionable word gone, the platform's injured reserve is what the row still says.
	assert.equal(tagged('questionable', played, true), 'IR');
});

void test("a defense's face is its club's mark, said in words", () => {
	const defense = boxRow(
		line({
			player: player({ name: 'Texans D/ST', position: 'DEF', team: 'HOU', board_id: null }),
			headshot: null
		}),
		slotWord('DEF'),
		ZONE,
		true,
		NOW
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

void test("Totals' note: the projection not in yet, else the playing starters without a Proj by name (Lane 99, B49)", () => {
	const game = { where: 'at LV', when: 'Final' };
	const held = { proj: 10, game, name: 'Josh Downs', toCome: false };
	const lacking = { proj: null, game, name: 'DJ Moore', toCome: false };
	const bye = { proj: null, game: 'bye' as const, name: 'Jahmyr Gibbs', toCome: false };
	assert.equal(totalsNote([held, lacking, bye], false, 6), 'No projection yet for week 6');
	assert.equal(totalsNote([held, lacking, bye], true, 6), 'DJ Moore had no Proj');
	assert.equal(totalsNote([held, bye], true, 6), null);
	// Still to come he has none; two are named; past two they are counted.
	const ahead = { ...lacking, toCome: true };
	assert.equal(totalsNote([held, ahead], true, 6), 'DJ Moore has no Proj');
	const other = { ...lacking, name: 'Kyle Pitts Sr.' };
	assert.equal(totalsNote([lacking, other], true, 6), 'DJ Moore and Kyle Pitts Sr. had no Proj');
	assert.equal(totalsNote([lacking, other, lacking], true, 6), '3 starters had no Proj');
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
	const row = boxRow(line(), 'QB', ZONE, false, NOW);
	assert.deepEqual(row.evidence, {
		oppRank: 24,
		oppOf: null,
		avg: 17.94,
		last: 22.4,
		delta: 0.4,
		season: 17.8
	});
	assert.equal(row.pill?.rank, null, 'the Lineup leaves the rest-of-season rank out');
	assert.equal(boxRow(line(), 'QB', ZONE, true, NOW).pill?.rank, 7, 'the Matchup keeps it');
});

/** The site's copy guard. */
const BANNED = bannedPattern();

void test('copy guard: every box word is fantasy words, with no dash or semicolon', () => {
	const said = [
		...Object.values(BOX),
		totalsNote([{ proj: null, game: null, name: 'DJ Moore', toCome: false }], true, 6) ?? '',
		totalsNote([], false, 6) ?? ''
	];
	for (const text of said) {
		assert.doesNotMatch(text, BANNED, text);
	}
});

void test('a player designated to return is this week’s question: his day, his rank, his week (Lane 153)', () => {
	// The Mason shape: questionable with Sunday's return day, the platform still marking him IR.
	const back = { status: 'questionable' as const, as_of: READ, returning: '2026-10-18' };
	const mason = line(
		{ player: player({ injured_reserve: true }), position_rank: 14, week_projection: 11.2 },
		{ designation: back, kickoff: SUNDAY_NOON }
	);
	assert.deepEqual(statusOf(back, true, ZONE), {
		rank: null,
		mark: 'Due back Sun Oct 18',
		// The tight row's chip (Lane 268): his weekday, whole in a box-score cell.
		short: 'Back Sun',
		sits: false,
		line: null,
		question: true
	});
	assert.equal(onReserve(mason), false);
	const drawn = boxRow(mason, 'RB', ZONE, true, NOW);
	assert.equal(drawn.status?.mark, 'Due back Sun Oct 18');
	assert.equal(drawn.reserve, false);
	assert.equal(drawn.proj, 11.2);
	assert.notEqual(drawn.game, null);
	// Once his game kicks off the week's word drops, and the platform's IR mark does not come back.
	const kicked = boxRow(mason, 'RB', ZONE, true, Date.parse(SUNDAY_NOON) + 60_000);
	assert.equal(kicked.status, null);
	// Due back after this week: still on his list, the day said in place of the since.
	const later = {
		status: 'injured_reserve' as const,
		as_of: READ,
		since: '2026-09-22T15:00:00.000Z',
		season_long: true,
		returning: '2026-11-08'
	};
	assert.deepEqual(statusOf(later, false, ZONE), {
		rank: 'IR',
		mark: 'IR, back Nov 8',
		short: 'Back Nov 8',
		sits: true,
		line: null
	});
	assert.equal(onReserve(line({}, { designation: later })), true);
	// The day is the provider's calendar day on every clock, never moved by a zone.
	assert.equal(statusOf(back, false, 'Pacific/Honolulu')?.mark, 'Due back Sun Oct 18');
	assert.equal(statusOf(back, false, 'Asia/Tokyo')?.mark, 'Due back Sun Oct 18');
});

void test('an injured reserve row draws no matchup: the bench one says why he is a drop, the slot no points (Lane 98, B34)', () => {
	const ir = line({}, { designation: { status: 'injured_reserve', as_of: READ, since: null } });
	assert.equal(onReserve(ir), true);
	assert.equal(onReserve(line({ player: player({ injured_reserve: true }) })), true);
	assert.equal(onReserve(line()), false);
	const drawn = boxRow(
		{ ...ir, facts: { ...ir.facts, points_this_week: 3 } },
		'Bench',
		ZONE,
		false,
		NOW
	);
	assert.equal(drawn.reserve, true);
	const bench = reserveRow(drawn, 'bench');
	assert.equal(bench.game, null);
	assert.equal(bench.expected, null);
	assert.equal(bench.evidence.oppRank, null);
	assert.equal(bench.evidence.avg, drawn.evidence.avg);
	assert.equal(bench.pts, 3);
	assert.equal(reserveRow(drawn, 'slot').pts, null);
	assert.equal(reserveRow(drawn, 'slot').proj, null);
	assert.equal(bench.proj, drawn.proj);
	assert.equal(reserveRow(drawn, null), drawn);
	assert.equal(BOX.irBench, 'IR-eligible, taking a bench spot');
	assert.doesNotMatch(BOX.irBench, bannedPattern());
});

void test('a name too long for its phone line: a player by initial, a defense by its nickname (Lane 115 fix round 1, LOW-1)', () => {
	const face = { src: null, mark: false, alt: '' };
	assert.equal(fitName({ name: 'Jacory Croskey-Merritt', face }), 'J. Croskey-Merritt');
	assert.equal(fitName({ name: 'Minnesota Vikings', face: { ...face, mark: true } }), 'Vikings');
	assert.equal(fitName({ name: 'Chiefs D/ST', face: { ...face, mark: true } }), 'Chiefs');
});

void test('the labelled expected score names both clubs, his first (Lane 139, C07)', () => {
	assert.equal(
		expectedScoreWords(facts(), 'DET'),
		`Expected score DET 26.5, ${facts().opponent ?? ''} 23`
	);
	assert.equal(expectedScoreWords(facts({ game_total: null }), 'DET'), null);
	assert.equal(expectedScoreWords(facts({ opponent: null }), 'DET'), null);
});
