// One value and one order for a player on every in-season view (Lane 220, B184): run with `npm test`.
// The order is the fixture's (scripts/inseason-fixture/data/order.json) at the Sunday clock, the one the
// Rankings read, and the run is the same rows at the run's instant, Thursday morning before any week 6
// game (rest-now.ts orderAtClock, the API's rule between runs). STAND-IN, named so: the fixture's ranks
// do not move with its clock, so the run's rows here are placed one lower than the order's, as a run
// made before a kickoff ranks a player the read has since moved past. Three players, one per position
// the brief names: an RB whose game has kicked off, a WR whose game is final and a QB on bye. Every
// view's rank, place at his position, points and Over repl. are the order's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FIXTURE_SUNDAY_CLOCK } from '../../../scripts/inseason-fixture/clock.ts';
import { orderAtClock } from '../../../scripts/inseason-fixture/rest-now.ts';
import type { components } from '#lib/api/types.ts';
import { STRIP_ROWS, liveStrip } from '#lib/front/live-board.ts';
import { FORMATS_RANK } from '#lib/player/formats-words.ts';
import { lineFiguresAt, lineRanksAt } from '#lib/player/live-figures.ts';
import type { LiveFormats } from '#lib/player/week-words.ts';
import { livePlaces, placedAt, placedLeads, placedRows } from './live-order.ts';
import type { Position } from '#lib/types/player.ts';
import type { BoardRowView } from './schema.ts';

type OrderAdvice = components['schemas']['OrderAdvice'];
type OrderRow = OrderAdvice['rows'][number];

/** The run's instant: Thursday Oct 15 2026, 8:50 am Central, before week 6's first kickoff. */
const RUN_AT = Date.parse('2026-10-15T13:50:00.000Z');
const SUNDAY = Date.parse(FIXTURE_SUNDAY_CLOCK);
const TEAMS = 12;
/** A read whose rest-of-season figures stand on the table (its figures are not what these tests read). */
const FIGURES: LiveFormats = { head: 'Rest of season', figures: {} };
const PLAYERS = ["D'Andre Swift", 'Parker Washington', 'Joe Burrow'] as const;

const ORDER = JSON.parse(
	readFileSync(
		new URL('../../../scripts/inseason-fixture/data/order.json', import.meta.url),
		'utf8'
	)
) as OrderAdvice;
const AT_RUN = orderAtClock(ORDER, RUN_AT);
const AT_SUNDAY = orderAtClock(ORDER, SUNDAY);

/** An order row as the run's board row for him: the run's figures, placed one lower (the stand-in). */
function runRow(row: OrderRow): BoardRowView {
	const { player, slug, position_rank: positionRank } = row.line;
	return {
		id: player.board_id ?? '',
		slug: slug ?? '',
		name: player.name,
		position: player.position as Position,
		positionRank: (positionRank ?? 0) + 1,
		team: player.team,
		headshot: 'https://a.espncdn.com/x.png',
		orderBasis: 'projection',
		ourRank: row.rank + 1,
		vorRound: Math.ceil((row.rank + 1) / TEAMS),
		adp: 10.2,
		gap: 0.4,
		projected: row.rest_of_season_points ?? 0,
		vor: (row.points_over_replacement ?? 0) + 1,
		expectedGames: 11,
		floor: null,
		median: null,
		ceiling: null,
		tier: 1
	};
}

/** The run's board rows: every row the order values and places at his position (no season-long
 * list, whose rank the pages say as the list's word), with a board id and both figures. */
const RUN_ROWS = AT_RUN.rows
	.filter(
		(row) =>
			row.line.player.board_id !== null &&
			row.line.position_rank !== null &&
			row.rest_of_season_points !== null &&
			row.points_over_replacement !== null
	)
	.map(runRow);

interface Shown {
	rank: number;
	positionRank: number;
	projected: number;
	vor: number;
}

function orderOf(name: string): Shown {
	const row = AT_SUNDAY.rows.find((candidate) => candidate.line.player.name === name);
	assert.ok(row?.rest_of_season_points != null && row.points_over_replacement !== null, name);
	return {
		rank: row.rank,
		positionRank: row.line.position_rank ?? 0,
		projected: row.rest_of_season_points,
		vor: row.points_over_replacement
	};
}

const shown = (
	row: Pick<BoardRowView, 'ourRank' | 'positionRank' | 'projected' | 'vor'>
): Shown => ({
	rank: row.ourRank,
	positionRank: row.positionRank,
	projected: row.projected,
	vor: row.vor
});

function runOf(name: string): BoardRowView {
	const row = RUN_ROWS.find((candidate) => candidate.name === name);
	assert.ok(row, name);
	return row;
}

void test('the run and the order disagree for the three players, the case the views must settle', () => {
	// Swift's week 6 game has kicked off at the clock: the order counts one game fewer.
	assert.notEqual(runOf(PLAYERS[0]).projected, orderOf(PLAYERS[0]).projected);
	// A guard on the stand-in, not evidence: its run rows sit one place lower by construction.
	for (const name of PLAYERS)
		assert.notEqual(
			runOf(name).ourRank,
			orderOf(name).rank,
			`the stand-in run places ${name} one lower than the order`
		);
});

void test('every view prints the order rank, place, points and Over repl. for each of the three', () => {
	const places = livePlaces(AT_SUNDAY);
	const strip = liveStrip(RUN_ROWS, AT_SUNDAY, TEAMS) ?? assert.fail('the strip keeps the run');
	for (const name of PLAYERS) {
		const want = orderOf(name);
		const run = runOf(name);
		const club = placedRows(
			RUN_ROWS.filter((row) => row.team === run.team),
			places,
			TEAMS
		);
		const views: Record<
			string,
			Pick<BoardRowView, 'ourRank' | 'positionRank' | 'projected' | 'vor'> | undefined
		> = {
			// The front door's top ten draws the order's first ten alone.
			...(want.rank <= STRIP_ROWS ? { home: strip.find((row) => row.name === name) } : {}),
			club: club?.find((row) => row.name === name),
			compare: placedAt(run, places.get(run.id) ?? assert.fail(name), TEAMS)
		};
		for (const [view, row] of Object.entries(views)) {
			assert.ok(row, `${view} draws no ${name}`);
			assert.deepEqual(shown(row), want, `${view}: ${name}`);
		}
		// The player page: the head's place and the formats table's in the read's format agree.
		const head = want.positionRank;
		const lines = [
			{ run: run.positionRank, format: 'ppr' as const, label: 'PPR' },
			{ run: run.positionRank, format: 'half_ppr' as const, label: 'Half PPR' }
		];
		const read = { format: 'ppr' as const, positionRank: head };
		assert.deepEqual(lineRanksAt(lines, FIGURES, read), {
			ranks: [head, null],
			unranked: ['Half PPR']
		});
	}
});

void test("the formats table's ranks stay the run's while its figures do (review H1)", () => {
	const lines = [
		{ run: 3, format: 'ppr' as const, label: 'PPR' },
		{ run: 4, format: 'half_ppr' as const, label: 'Half PPR' },
		{ run: 2, format: 'standard' as const, label: 'Standard' }
	];
	const read = { format: 'ppr' as const, positionRank: 5 };
	// Preseason, or a read that carries no rest-of-season figures: the run's figures and ranks stand.
	assert.deepEqual(lineFiguresAt({ points: 183.2, vor: 95.3 }, 'half_ppr', null), {
		points: 183.2,
		vor: 95.3
	});
	assert.deepEqual(lineRanksAt(lines, null, read), { ranks: [3, 4, 2], unranked: [] });
	// No read at all: the run's.
	assert.deepEqual(lineRanksAt(lines, FIGURES, null), { ranks: [3, 4, 2], unranked: [] });
	// The read's figures stand: its format takes the head's rank, the others none, named for the note.
	assert.deepEqual(lineRanksAt(lines, FIGURES, read), {
		ranks: [5, null, null],
		unranked: ['Half PPR', 'Standard']
	});
	assert.equal(
		FORMATS_RANK.unranked(['Half PPR', 'Standard']),
		'Half PPR and Standard show no position rank at this read, only their points.'
	);
	assert.equal(
		FORMATS_RANK.unranked(['Standard']),
		'Standard shows no position rank at this read, only its points.'
	);
});

void test('a club page or a pair the order does not place keeps the run, every row of it', () => {
	const places = livePlaces({
		rows: AT_SUNDAY.rows.filter((row) => row.line.player.name !== PLAYERS[0])
	});
	const run = runOf(PLAYERS[0]);
	const club = RUN_ROWS.filter((row) => row.team === run.team);
	assert.equal(placedRows(club, places, TEAMS), null);
});

void test("the clubs index's leads are the order's, and its first players keep the run when one is missing", () => {
	const places = livePlaces(AT_SUNDAY);
	const teams = [...new Set(RUN_ROWS.map((row) => row.team))];
	const cards = teams.map((team) => {
		const pool = RUN_ROWS.filter((row) => row.team === team).slice(0, 3);
		return { abbr: team, lead: pool[0] ?? null, pool };
	});
	const leads = placedLeads(cards, places, TEAMS);
	assert.ok(leads);
	for (const card of leads) {
		const lead = card.lead;
		if (lead === null) continue;
		const want = orderOf(lead.name);
		assert.deepEqual(shown(lead), want, card.abbr);
		const first = card.pool
			.map((row) => orderOf(row.name))
			.reduce((best, row) => (row.rank < best.rank ? row : best));
		assert.equal(want.rank, first.rank, `${card.abbr} leads with its first player at the clock`);
	}
	const missing = new Map(places);
	const someone = cards[0]?.pool[1]?.id ?? cards[0]?.pool[0]?.id ?? '';
	missing.delete(someone);
	assert.equal(placedLeads(cards, missing, TEAMS), null);
});
