// A held page (Lane 136): the season rules name every page they refuse, each by its file, so the
// nightly can hold a refused page back and publish the rest; a held page with no earlier copy is its
// board figures alone; `held.json` parses as the nightly writes it. The pages, boards and slate are the
// in-season contract fixture's (research/nightly/contract/fixture). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RefusedPages, boardFormats } from './held.ts';
import { checkRunSeasons, seasonRefusals, type SeasonedPlayer } from './season-checks.ts';
import type { GameLogRow } from './season.ts';
import { boardSchema, heldSchema, playerSchema, scheduleSchema, type Board } from './schema.ts';
import { splitBoard } from './market.ts';

const RUN = new URL(
	'../../../../research/nightly/contract/fixture/runs/2026-10-21T12-ros/',
	import.meta.url
);
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, RUN), 'utf8'));
const IDS = ['4429795', '3918298', '4429023', '4047365'] as const;
const pages: SeasonedPlayer[] = IDS.map((id) => playerSchema.parse(read(`players/${id}.json`)));
const schedule = scheduleSchema.parse(read('schedule.json'));
const FORMATS = ['ppr-12', 'half-ppr-12', 'standard-12'] as const;
const boards: { id: string; board: Board }[] = FORMATS.map((id) => ({
	id,
	board: splitBoard(boardSchema.parse(read(`boards/${id}.json`)))
}));

/** A page with one week's row rewritten. */
function withRow(p: SeasonedPlayer, week: number, row: Partial<GameLogRow>): SeasonedPlayer {
	const log = p.season.log.map((r) => (r.week === week ? { ...r, ...row } : r));
	return { ...p, season: { ...p.season, log } };
}

function at(index: number): SeasonedPlayer {
	const p = pages[index];
	if (!p) throw new Error(`The fixture has no page ${String(index)}.`);
	return p;
}

void test('the fixture pages break no rule', () => {
	assert.deepEqual([...seasonRefusals(pages, schedule)], []);
});

void test('every page a rule refuses is named, not only the first', () => {
	const gibbs = at(0);
	const other = at(1);
	const byeOnGame = withRow(gibbs, 7, { status: 'bye', opponent: null, home: null });
	const lastGame = { ...other, lastGameClub: { club: other.team, week: 1 } };
	const refused = seasonRefusals([byeOnGame, lastGame, at(2), at(3)], schedule);
	assert.deepEqual([...refused.keys()], [gibbs.id, other.id]);
	assert.match(refused.get(gibbs.id) ?? '', /has a bye in week 7, but DET plays that week/);
	assert.match(refused.get(other.id) ?? '', /line was for BUF, but that is his club/);
});

void test('the one basis is the one most blocks share, so the odd page is named even when first', () => {
	const odd = { ...at(0), season: { ...at(0).season, through: 4 } };
	const refused = seasonRefusals([odd, at(1), at(2), at(3)], schedule);
	assert.deepEqual([...refused.keys()], [odd.id]);
	assert.match(
		refused.get(odd.id) ?? '',
		/^Season blocks disagree: ppr-12 through week 5, but players\/4429795\.json is ppr-12 through week 4\.$/
	);
	// An earlier run's copy is through an earlier week: the one basis is not held to it.
	assert.deepEqual([...seasonRefusals([odd], schedule, { basis: false })], []);
});

void test('the stand-in, which holds nothing, still fails on the first refusal', () => {
	const odd = withRow(at(0), 7, { status: 'bye', opponent: null, home: null });
	assert.throws(() => {
		checkRunSeasons([odd, at(1)], schedule);
	}, /has a bye in week 7/);
	assert.doesNotThrow(() => {
		checkRunSeasons(pages, schedule);
	});
});

void test('the reader names each refused page and copy by its file', () => {
	const error = new RefusedPages(
		new Map([['4429795', 'Week 6 is played but names no opponent.']]),
		new Map([['3918298', 'held/3918298.json logs 17 weeks, the schedule runs 18.']])
	);
	assert.equal(error.pages.size, 1);
	assert.equal(error.copies.size, 1);
	assert.match(error.message, /refused 2 player files/);
	assert.match(error.message, /players\/4429795\.json: Week 6 is played/);
	assert.match(error.message, /held\/3918298\.json: held\/3918298\.json logs 17 weeks/);
});

void test('a held page with no copy is his row on every board that ranks him, and nothing of his page', () => {
	const formats = boardFormats(boards, '4429795');
	assert.deepEqual(Object.keys(formats), [...FORMATS]);
	const row = boards[0]?.board.rows.find((r) => r.id === '4429795');
	assert.ok(row);
	const ppr = formats['ppr-12'];
	assert.ok(ppr);
	assert.equal(ppr.ourRank, row.ourRank);
	assert.equal(ppr.projected, row.projected);
	assert.equal('team' in ppr, false);
	assert.deepEqual(boardFormats(boards, '0000000'), {});
});

void test('held.json parses as the nightly writes it, and holds at least one page', () => {
	const held = {
		pages: [
			{
				id: '4429795',
				refusal: 'Week 6 is played but names no opponent.',
				copy: { runId: '2026-10-21T05', runAt: '2026-10-21T05:41:00.000Z' }
			},
			{ id: '3918298', refusal: 'The log has 2 byes, a club has one.', copy: null }
		]
	};
	assert.deepEqual(heldSchema.parse(held), held);
	assert.equal(heldSchema.safeParse({ pages: [] }).success, false);
	assert.equal(
		heldSchema.safeParse({
			pages: [{ ...held.pages[1], copy: { runId: 'yesterday', runAt: 'x' } }]
		}).success,
		false
	);
});
