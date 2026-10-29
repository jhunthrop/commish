// The League page's figures (Lane 292): the Proj gap cell, the power panel's rows and heads, the
// start and sit row, each with the API's sentence, and an older answer drawing none. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { LeagueSync } from '../api.ts';
import type { LeagueRecord, Scoreboard } from '../inseason/api.ts';
import {
	GAP_BASIS,
	GAP_BEST_LINEUP_BASIS,
	POWER_BASIS
} from '../../../../scripts/inseason-fixture/figures.ts';
import { START_SIT_BASIS } from '../../../../scripts/inseason-fixture/record.ts';
import {
	CHANCE_BASIS,
	VS_MEDIAN_BASIS,
	withLeagueFigures
} from '../../../../scripts/inseason-fixture/league-figures.ts';
import {
	FIGURE_WORDS,
	POWER_HEADS,
	chanceCell,
	chanceShown,
	gapFigure,
	medianRow,
	powerPanel,
	startSitRow
} from './figures.ts';

type Game = Scoreboard['games'][number];

function game(first: number, second: number, gap: number | null | undefined): Game {
	const side = (roster: number): Game['sides'][number] => ({
		roster_id: roster,
		points: 0,
		points_read: true,
		projection: 90,
		starters: 9,
		played: 0
	});
	return {
		state: 'upcoming',
		next_kickoff: null,
		sides: [side(first), side(second)],
		...(gap === undefined ? {} : { projection_gap: gap })
	};
}

function board(games: Game[], extra: Partial<Scoreboard> = {}): Scoreboard {
	return {
		week: 6,
		read_at: '2026-10-17T17:00:00Z',
		projection_read_at: null,
		projection_scoring: { format: 'ppr', own: true },
		games,
		projection_gap_basis: GAP_BASIS,
		...extra
	} as Scoreboard;
}

void test('the member’s game draws its signed Proj gap with the API’s sentence before kickoff', () => {
	const b = board([game(1, 2, -23.7), game(3, 4, 5)]);
	assert.deepEqual(gapFigure(b, 1, true), { cell: 'Proj gap −23.7', basis: GAP_BASIS });
	assert.deepEqual(gapFigure(board([game(1, 2, 6.4)]), 1, true)?.cell, 'Proj gap +6.4');
});

void test('no Proj gap once the game kicks off, with none, or from an older answer', () => {
	assert.equal(gapFigure(board([game(1, 2, 6.4)]), 1, false), null);
	assert.equal(gapFigure(board([game(1, 2, null)]), 1, true), null);
	assert.equal(gapFigure(board([game(2, 1, 6.4)]), 1, true), null, 'another team’s game');
	const older = board([game(1, 2, undefined)]);
	delete (older as Partial<Scoreboard>).projection_gap_basis;
	assert.equal(gapFigure(older, 1, true), null);
	assert.equal(gapFigure(null, 1, true), null);
});

const sync = {
	me: 2,
	teams: [
		{ roster_id: 1, name: 'Muttdogs', avatar: null },
		{ roster_id: 2, name: 'McConkey Kong Country', avatar: 'a.png' }
	]
} as unknown as LeagueSync;

void test('the power panel draws a row a team in overall order, the member’s marked, with its heads', () => {
	const b = board([], {
		power: {
			basis: POWER_BASIS,
			columns: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX'],
			teams: [
				{ roster_id: 2, rank: 1, ranks: [1, 2, 1, 2, 1, 1] },
				{ roster_id: 1, rank: 2, ranks: [2, 1, 2, 1, 2, 2] },
				{ roster_id: 9, rank: 3, ranks: [3, 3, 3, 3, 3, 3] }
			]
		}
	});
	const panel = powerPanel(b, sync);
	assert.ok(panel);
	assert.deepEqual(panel.heads, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SFLX']);
	assert.equal(panel.basis, POWER_BASIS);
	assert.deepEqual(
		panel.rows.map((r) => [r.name, r.me, r.rank, r.ranks.join(' ')]),
		[
			['McConkey Kong Country', true, 1, '1 2 1 2 1 1'],
			['Muttdogs', false, 2, '2 1 2 1 2 2']
		],
		'a team the league read does not list is left out'
	);
	assert.equal(powerPanel(board([]), sync), null, 'an older answer draws no panel');
});

void test('the start and sit row: matched of weeks, our picks less the set lineup, signed and toned', () => {
	const record = (ours: number): LeagueRecord =>
		({
			start_sit: { weeks: 5, matched: 3, ours_less_set: ours, basis: START_SIT_BASIS }
		}) as LeagueRecord;
	assert.deepEqual(startSitRow(record(12.4)), {
		figure: 'start-sit',
		head: FIGURE_WORDS.startSit,
		cells: [
			{ label: FIGURE_WORDS.matched, value: '3 of 5', tone: 'even' },
			{ label: FIGURE_WORDS.ours, value: '+12.4', tone: 'short' }
		],
		basis: START_SIT_BASIS
	});
	assert.equal(startSitRow(record(-3.1))?.cells[1]?.tone, 'over');
	assert.equal(startSitRow(record(-3.1))?.cells[1]?.value, '−3.1');
	assert.equal(startSitRow(record(0))?.cells[1]?.tone, 'even');
	assert.equal(startSitRow({} as LeagueRecord), null);
	assert.equal(startSitRow(null), null);
});

void test('points against the median: weeks above of weeks read, the net signed and toned (Lane 298)', () => {
	const median = (total: number, above: number): Pick<LeagueSync, 'points_vs_median'> => ({
		points_vs_median: {
			weeks: [1, 2, 3, 4].map((week) => ({ week, points: 100, median: 100, diff: 0 })),
			above,
			total,
			basis: VS_MEDIAN_BASIS
		}
	});
	assert.deepEqual(medianRow(median(12.4, 3)), {
		figure: 'vs-median',
		head: FIGURE_WORDS.vsMedian,
		cells: [
			{ label: FIGURE_WORDS.above, value: '3 of 4', tone: 'even' },
			{ label: FIGURE_WORDS.net, value: '+12.4', tone: 'over' }
		],
		basis: VS_MEDIAN_BASIS
	});
	assert.equal(medianRow(median(-8, 1))?.cells[1]?.tone, 'short');
	assert.equal(medianRow({}), null);
	assert.equal(medianRow(null), null);
});

void test('the playoff chance column: a percent per team, drawn only when every team has one (Lane 298)', () => {
	assert.equal(chanceCell({ playoff_chance: 64 }), '64%');
	assert.equal(chanceCell({ playoff_chance: 100 }), '100%');
	assert.equal(chanceCell({ playoff_chance: null }), null);
	assert.equal(chanceCell({}), null);
	const team = (pct: number | undefined) =>
		({ playoff_chance: pct }) as LeagueSync['teams'][number];
	assert.equal(
		chanceShown({ teams: [team(50), team(50)], playoff_chance_basis: CHANCE_BASIS }),
		true
	);
	assert.equal(
		chanceShown({ teams: [team(50), team(undefined)], playoff_chance_basis: CHANCE_BASIS }),
		false
	);
	assert.equal(chanceShown({ teams: [team(50)] }), false);
	assert.equal(chanceShown({ teams: [], playoff_chance_basis: CHANCE_BASIS }), false);
	// The fixture's stand-in carries both figures on every team.
	const sync = withLeagueFigures({
		teams: Array.from({ length: 12 }, (_, i) => ({ roster_id: i + 1 }))
	} as unknown as LeagueSync);
	assert.equal(chanceShown(sync), true);
	assert.equal(sync.teams[0]?.playoff_chance, 100);
	assert.equal(sync.teams[11]?.playoff_chance, 0);
	assert.equal(medianRow(sync)?.cells[0]?.value, '3 of 5');
});

void test('every figure word and sentence passes the copy guard', () => {
	const words = [
		...Object.values(FIGURE_WORDS),
		...Object.values(POWER_HEADS),
		GAP_BASIS,
		GAP_BEST_LINEUP_BASIS,
		POWER_BASIS,
		START_SIT_BASIS,
		CHANCE_BASIS,
		VS_MEDIAN_BASIS
	].join(' ');
	assert.doesNotMatch(words, bannedPattern());
	assert.doesNotMatch(words, /\bour model\b/i);
});

void test('the fixture’s sentences are the API’s, word for word (dashboard.go)', () => {
	const go = readFileSync(
		new URL('../../../../../api/internal/inseason/dashboard.go', import.meta.url),
		'utf8'
	).replace(/" \+\n\s*"/g, '');
	const closing = 'not a win chance: we show none until one is measured on a past season.';
	assert.ok(go.includes(`gapNoChance = "${closing}"`), 'gapNoChance');
	assert.ok(go.includes(GAP_BASIS.replace(closing, '" +\n\tgapNoChance')), 'ProjectionGapBasis');
	assert.ok(
		go.includes(GAP_BEST_LINEUP_BASIS.replace(closing, '" + gapNoChance')),
		'ProjectionGapBestLineupBasis'
	);
	assert.ok(go.includes(START_SIT_BASIS), 'StartSitBasis');
	assert.ok(go.includes(POWER_BASIS.replace('weeks 6 to 17', '%s')), 'powerWords, the weeks aside');
});

void test('the fixture’s median sentence is the API’s, word for word (median.go)', () => {
	const go = readFileSync(
		new URL('../../../../../api/internal/leaguesync/median.go', import.meta.url),
		'utf8'
	).replace(/" \+\n\s*"/g, '');
	assert.ok(go.includes(`VsMedianBasis = "${VS_MEDIAN_BASIS}"`), 'VsMedianBasis');
});
