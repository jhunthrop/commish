// The Matchup and Lineup boxes' rows and totals (Lane 66d): run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIXTURE_WEEK_CLOCK } from '../../../../scripts/inseason-fixture/clock.ts';
import { inTenths } from '../../../../scripts/inseason-fixture/tenths.ts';
import { test } from 'node:test';
import type { MatchupSide } from '../api.ts';
import type { LineupSlot, MatchupBox, PlayerLine, WeekFacts } from '../inseason/api.ts';
import { ptsPart } from './basis.ts';
import { boxNumber } from './box.ts';
import { lineupBox, type LineupBox } from './lineup.ts';
import { nextKickoff, sideBox, type SideBox } from './matchup.ts';

const ZONE = 'America/Chicago';
const FRIDAY = Date.parse('2026-10-17T02:00:00.000Z');

const facts = (over: Partial<WeekFacts> = {}): WeekFacts => ({
	week: 6,
	opponent: 'JAX',
	home: false,
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
	proj: number | null,
	over: Partial<WeekFacts> = {}
): PlayerLine => ({
	player: { host_id: name, board_id: name, name, position, team, injured_reserve: false },
	headshot: null,
	slug: null,
	position_rank: null,
	points_over_replacement: null,
	rest_of_season_per_game: 12,
	week_projection: proj,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: facts(over)
});

const collins = line('Nico Collins', 'WR', 'HOU', 15.2);
const texans = line('Texans D/ST', 'DEF', 'HOU', 7);
const bench = line('Jordan Addison', 'WR', 'MIN', null, { bye: true, opponent: null });

/** A side before kickoff with the week's projection in. */
/** The fixture week's clock, Saturday noon Central: every Sunday game is still to be played. */
const NOW = Date.parse(FIXTURE_WEEK_CLOCK);
const NOT_STARTED = { hostTotal: null, landed: true, week: 6, now: NOW };

void test("a side's box is the API's rows in their slots, its projection summed", () => {
	const side: MatchupSide = {
		roster_id: 1,
		points: 0,
		points_read: true,
		player_points: true,
		team_total: false,
		starters: []
	};
	const box = sideBox(
		side,
		{
			roster_id: 1,
			player_points: true,
			team_total: false,
			starters: [
				{ slot: 'WR', line: collins },
				{ slot: 'DEF', line: texans }
			],
			bench: [bench]
		},
		NOT_STARTED,
		ZONE
	);
	assert.deepEqual(
		box.starters.map((s) => s.row.slot),
		['WR', 'D/ST']
	);
	assert.equal(box.bench[0]?.game, 'bye');
	assert.equal(box.totals.proj, 22.2);
	assert.equal(box.totals.pts, null);
	assert.equal(box.lines.length, 3);
});

void test("without the API's rows a side is the read's starters with their points", () => {
	const side: MatchupSide = {
		roster_id: 7,
		points: 31.4,
		points_read: true,
		player_points: true,
		team_total: false,
		starters: [{ player: collins.player, points: 18.2 }]
	};
	const box = sideBox(side, null, { ...NOT_STARTED, hostTotal: 31.4 }, ZONE);
	assert.equal(box.starters[0]?.row.pts, 18.2);
	assert.equal(box.starters.at(0)?.row.slot, 'WR');
	assert.equal(box.totals.proj, null);
	assert.equal(box.totals.pts, 18.2);
	// The API's rule decides, never a guess from the figures (Lane 79 fix 7): a platform total alone
	// leaves the rows blank and its total in Totals; a starter the read left out stays blank.
	const total = sideBox(
		{
			...side,
			player_points: false,
			team_total: true,
			starters: [{ player: collins.player, points: null }]
		},
		null,
		{ ...NOT_STARTED, hostTotal: 31.4 },
		ZONE
	);
	assert.equal(total.starters[0]?.row.pts, null);
	assert.equal(total.totals.pts, 31.4);
});

void test('the bug names the first kickoff, then the next once one has started', () => {
	const sunday = line('Bucky Irving', 'RB', 'TB', 11, {
		opponent: 'PIT',
		home: true,
		kickoff: '2026-10-18T17:00:00.000Z'
	});
	assert.deepEqual(nextKickoff([sunday, collins, bench], FRIDAY, ZONE), {
		head: 'First kickoff',
		words: 'Sun 8:30 am, HOU at JAX'
	});
	const afterLondon = Date.parse('2026-10-18T15:00:00.000Z');
	assert.deepEqual(nextKickoff([sunday, collins], afterLondon, ZONE), {
		head: 'Next kickoff',
		words: 'Sun 12:00 pm, TB vs PIT'
	});
	assert.equal(nextKickoff([collins], Date.parse('2026-10-19T00:00:00.000Z'), ZONE), null);
});

void test('a lineup swap moves ours in and the platform starter it sits out to the bench', () => {
	const slot = (
		s: LineupSlot['slot'],
		ours: PlayerLine,
		host: PlayerLine | null,
		changed: boolean
	) => ({
		slot: s,
		ours,
		host,
		changed,
		no_one_can_play: false,
		sentence: changed ? 'The API sentence.' : null
	});
	const vikings = line('Vikings', 'DEF', 'MIN', 6);
	const box = lineupBox(
		{
			slots: [slot('WR', collins, collins, false), slot('DEF', texans, vikings, true)],
			bench: [vikings],
			reserve: [line('A.J. Brown', 'WR', 'NE', null)],
			empty_slots: [],
			player_points: true,
			team_points: null,
			projection_read_at: '2026-10-17T02:00:00.000Z',
			week: 6
		},
		ZONE,
		NOW
	);
	assert.equal(box.starters[0]?.move, null);
	assert.equal(box.starters[1]?.move, 'in');
	assert.deepEqual(
		box.starters.map((s) => s.row.slot),
		['WR', 'D/ST']
	);
	assert.equal(box.bench[0]?.move, 'out');
	assert.deepEqual(
		box.bench.map((b) => b.row.slot),
		['Sit'],
		'the bench arrow reads Sit, never the designation word'
	);
	assert.equal(box.reserve[0]?.name, 'A.J. Brown');
	assert.equal(box.totals.proj, 22.2);
	assert.equal(box.asSet, 21.2);
	assert.equal(box.gain, 1);
	assert.deepEqual(box.swaps, [{ key: 'Texans D/ST', slot: 'D/ST', in: 'Texans', out: 'Vikings' }]);
});

void test("the fixture's bye rows show no projection and its totals leave them out", () => {
	const url = new URL('../../../../scripts/inseason-fixture/data/matchup.json', import.meta.url);
	// The recording in tenths, as the API sends it (the fixture's tenths.ts, the API's rule).
	const box = inTenths(JSON.parse(readFileSync(url, 'utf8')) as MatchupBox);
	let byes = 0;
	for (const side of box.sides) {
		const read: MatchupSide = {
			roster_id: side.roster_id,
			points: 0,
			points_read: true,
			player_points: side.player_points,
			team_total: false,
			starters: []
		};
		const drawn = sideBox(read, side, NOT_STARTED, ZONE);
		for (const row of [...drawn.starters.map((s) => s.row), ...drawn.bench]) {
			if (row.game !== 'bye') continue;
			byes += 1;
			assert.equal(row.proj, null, `${row.name} on a bye`);
		}
		const playing = drawn.starters.flatMap((s) =>
			s.row.game === 'bye' || s.row.proj === null ? [] : [Number(boxNumber(s.row.proj))]
		);
		assert.equal(boxNumber(drawn.totals.proj), boxNumber(playing.reduce((a, b) => a + b, 0)));
	}
	assert.ok(byes > 0, 'the fixture holds a bye');
});

/** The same team after kickoff on both screens, as a host shapes it: the host's total for the team,
 * and each starter's points only where the host gives them (Sleeper, MFL). */
function bothScreens(
	byPlayer: boolean,
	teamTotal = !byPlayer
): { matchup: SideBox; lineup: LineupBox } {
	const kicked = { kickoff: '2026-10-18T13:30:00.000Z', played: true };
	const pts = (v: number) => (byPlayer ? v : null);
	const qb = line('Caleb Williams', 'QB', 'CHI', 17.8, { ...kicked, points_this_week: pts(21.4) });
	const wr = line('Nico Collins', 'WR', 'HOU', 15.2, { ...kicked, points_this_week: pts(12.0) });
	const hostTotal = 87.4;
	const read: MatchupSide = {
		roster_id: 1,
		points: hostTotal,
		points_read: true,
		player_points: byPlayer,
		team_total: teamTotal,
		starters: []
	};
	const matchup = sideBox(
		read,
		{
			roster_id: 1,
			player_points: byPlayer,
			team_total: teamTotal,
			starters: [
				{ slot: 'QB', line: qb },
				{ slot: 'WR', line: wr }
			],
			bench: []
		},
		{ hostTotal, landed: true, week: 6, now: NOW },
		ZONE
	);
	const unchanged = (s: LineupSlot['slot'], l: PlayerLine) => ({
		slot: s,
		ours: l,
		host: l,
		changed: false,
		no_one_can_play: false,
		sentence: null
	});
	const lineup = lineupBox(
		{
			slots: [unchanged('QB', qb), unchanged('WR', wr)],
			bench: [],
			reserve: [],
			empty_slots: [],
			player_points: byPlayer,
			team_points: hostTotal,
			projection_read_at: '2026-10-17T02:00:00.000Z',
			week: 6
		},
		ZONE,
		NOW
	);
	return { matchup, lineup };
}

void test("a host that gives no player's points: rows say --, both screens' Totals say the host's total, and the Pts line says so", () => {
	const { matchup, lineup } = bothScreens(false);
	for (const rows of [matchup.starters.map((s) => s.row), lineup.starters.map((s) => s.row)]) {
		assert.deepEqual(
			rows.map((r) => boxNumber(r.pts)),
			['--', '--']
		);
	}
	assert.equal(boxNumber(matchup.totals.pts), '87.4');
	assert.equal(boxNumber(lineup.totals.pts), '87.4');
	assert.equal(matchup.byPlayer, false);
	assert.equal(
		ptsPart(matchup.byPlayer, 'yahoo', 'platform'),
		"Pts are Yahoo's team points, none by player."
	);
});

void test("Sleeper and MFL, points by player alone: the Matchup's Totals and score add the printed rows, the Lineup's too", () => {
	const { matchup, lineup } = bothScreens(true, false);
	assert.deepEqual(
		matchup.starters.map((s) => boxNumber(s.row.pts)),
		['21.4', '12.0']
	);
	assert.equal(boxNumber(matchup.totals.pts), '33.4');
	assert.equal(boxNumber(lineup.totals.pts), '33.4');
	assert.equal(
		ptsPart(matchup.byPlayer, 'sleeper', 'rows'),
		"Pts are Sleeper's points by player so far, and Team adds the rows."
	);
});

void test("ESPN, points by player and its own total: the Matchup's Totals is ESPN's score, the bug's figure, and the Lineup's Team adds its rows (rulings a and b)", () => {
	const { matchup, lineup } = bothScreens(true, true);
	assert.deepEqual(
		matchup.starters.map((s) => boxNumber(s.row.pts)),
		['21.4', '12.0']
	);
	assert.equal(boxNumber(matchup.totals.pts), '87.4');
	assert.equal(boxNumber(lineup.totals.pts), '33.4');
	assert.equal(
		ptsPart(matchup.byPlayer, 'espn', 'platform'),
		"Pts are ESPN's points by player so far, each to a tenth, and Team is ESPN's score."
	);
	assert.equal(
		ptsPart(true, 'espn', 'rows'),
		"Pts are ESPN's points by player so far, and Team adds the rows."
	);
});
