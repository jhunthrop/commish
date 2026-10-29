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
import { FIGURE_WORDS, POWER_HEADS, gapFigure, powerPanel, startSitRow } from './figures.ts';

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
		matched: '3 of 5',
		ours: '+12.4',
		tone: 'ahead',
		basis: START_SIT_BASIS
	});
	assert.equal(startSitRow(record(-3.1))?.tone, 'behind');
	assert.equal(startSitRow(record(-3.1))?.ours, '−3.1');
	assert.equal(startSitRow(record(0))?.tone, 'even');
	assert.equal(startSitRow({} as LeagueRecord), null);
	assert.equal(startSitRow(null), null);
});

void test('every figure word and sentence passes the copy guard', () => {
	const words = [
		...Object.values(FIGURE_WORDS),
		...Object.values(POWER_HEADS),
		GAP_BASIS,
		GAP_BEST_LINEUP_BASIS,
		POWER_BASIS,
		START_SIT_BASIS
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
