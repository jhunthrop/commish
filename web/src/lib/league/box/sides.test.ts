// The Matchup and Lineup boxes' rows and totals (Lane 66d): run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { MatchupSide } from '../api.ts';
import type { LineupSlot, MatchupBox, PlayerLine, WeekFacts } from '../inseason/api.ts';
import { lineupBox } from './lineup.ts';
import { nextKickoff, sideBox } from './matchup.ts';

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
	held: false,
	facts: facts(over)
});

const collins = line('Nico Collins', 'WR', 'HOU', 15.2);
const texans = line('Texans D/ST', 'DEF', 'HOU', 7);
const bench = line('Jordan Addison', 'WR', 'MIN', null, { bye: true, opponent: null });

void test("a side's box is the API's rows in their slots, its projection summed", () => {
	const side: MatchupSide = { roster_id: 1, points: 0, points_read: true, starters: [] };
	const box = sideBox(
		side,
		{
			roster_id: 1,
			starters: [
				{ slot: 'WR', line: collins },
				{ slot: 'DEF', line: texans }
			],
			bench: [bench]
		},
		false,
		null,
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
		starters: [{ player: collins.player, points: 18.2 }]
	};
	const box = sideBox(side, null, true, 31.4, ZONE);
	assert.equal(box.starters[0]?.row.pts, 18.2);
	assert.equal(box.starters.at(0)?.row.slot, 'WR');
	assert.equal(box.totals.proj, null);
	assert.equal(box.totals.pts, 31.4);
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

void test('a lineup change starts ours over the host starter it sits, with its reason', () => {
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
		sentence: changed ? 'Ranked higher on our order.' : null
	});
	const box = lineupBox(
		{
			slots: [
				slot('WR', collins, collins, false),
				slot('DEF', texans, line('Vikings', 'DEF', 'MIN', 6), true)
			],
			bench: [line('Vikings', 'DEF', 'MIN', 6)]
		},
		ZONE
	);
	assert.equal(box.starters[0]?.sits, undefined);
	assert.equal(box.starters[1]?.sits?.slot, 'Sit');
	assert.equal(box.starters.at(1)?.sentence, 'Ranked higher on our order.');
	assert.ok(box.benchSat.has('Vikings'));
	assert.equal(box.totals.proj, 22.2);
});

void test("the fixture's bye rows show no projection and its totals leave them out", () => {
	const url = new URL('../../../../scripts/inseason-fixture/data/matchup.json', import.meta.url);
	const box = JSON.parse(readFileSync(url, 'utf8')) as MatchupBox;
	let byes = 0;
	for (const side of box.sides) {
		const read: MatchupSide = {
			roster_id: side.roster_id,
			points: 0,
			points_read: true,
			starters: []
		};
		const drawn = sideBox(read, side, false, null, ZONE);
		for (const row of [...drawn.starters.map((s) => s.row), ...drawn.bench]) {
			if (row.game !== 'bye') continue;
			byes += 1;
			assert.equal(row.proj, null, `${row.name} on a bye`);
		}
		const playing = drawn.starters.flatMap((s) =>
			s.row.game === 'bye' || s.row.proj === null ? [] : [s.row.proj]
		);
		assert.equal(
			drawn.totals.proj,
			playing.reduce((a, b) => a + b, 0)
		);
	}
	assert.ok(byes > 0, 'the fixture holds a bye');
});
