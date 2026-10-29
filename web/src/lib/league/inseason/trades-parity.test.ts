// The Trades parity file (shared/fixtures/parity/trades.json, Lane 277) held to the web's builder-first
// screen over the shared fixtures: at every clock the ideas row is our ideas then each team the finder
// lists no trade with, its line in its place (B271); every trade the finder lists is one both sides
// take on the rest-of-season rule its line states; every check's rest-of-season cells are the check's
// figures; and the word cases where a side would not take it lead with that side's sentence and tag
// its cell; and with the finder's newer fields (Lane 290) the host's offers head the row, each idea
// says what it fills, each empty team says why, and the verdict answers as before. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { restFigure, TRADES } from '../box/trades.ts';
import type { TradeAdvice, TradeCheck } from './api.ts';
import { ANALYZER_LINES, emptyNote, ideaPlaces, noIdeasFrom, presetsFrom } from './builder.ts';

const ROOT = new URL('../../../../../', import.meta.url);
const LEAGUE = '6f1d1c52-2626-4a26-9a26-000000000026';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const dataOf = (fixture: string): unknown => (read(fixture) as { data: unknown }).data;
const advice = (fixture: string): TradeAdvice => dataOf(fixture) as TradeAdvice;

interface Place {
	kind: 'idea' | 'none';
	key: string;
	rosterId: number;
	team: string;
	note: string | null;
	fills: string | null;
}

interface Cell {
	text: string;
	tone: string;
	refuses: boolean;
}

interface ParitySide {
	rest: Cell;
}

interface ParityCheck {
	yours: ParitySide;
	theirs: ParitySide;
	restBasis: string | null;
}

interface WordCase {
	name: string;
	acceptable: { yours: boolean; theirs: boolean } | null;
	sentence: string;
	refusal: string | null;
	cells: { yours: Cell; theirs: Cell };
	fills: { yours: boolean; theirs: boolean; yours_room: boolean; theirs_room: boolean };
}

interface Parity {
	clocks: Record<string, { ideas: { head: string; places: Place[] }; restBasis: string | null }>;
	checks: Record<string, ParityCheck[]>;
	words: { checks: WordCase[] };
	needs: {
		clock: string;
		offers: { rosterId: number; picks: unknown; note: string | null; label: string }[];
		ideas: { places: Place[] };
		empty: { rosterId: number; reason: string | null; note: string }[];
		check: ParityCheck;
		builderBasis: string;
	};
}

const parity = read('shared/fixtures/parity/trades.json') as Parity;
const clocks = Object.keys(parity.clocks);

/** The most a side gives up, as the finder's line states it ("falls by more than 12.0."). */
function limitOf(line: string | null): number {
	const said = /more than (\d+\.\d)\./.exec(line ?? '');
	assert.ok(said, `no limit in ${String(line)}`);
	return Number(said[1]);
}

void test('the ideas row is our ideas, then each team with none, said (B271)', () => {
	assert.ok(clocks.length > 0);
	let quiet = 0;
	for (const clock of clocks) {
		const answer = advice(`shared/fixtures/inseason/trades-${LEAGUE}-${clock}.json`);
		const { ideas } = parity.clocks[clock] ?? { ideas: { head: '', places: [] } };
		assert.equal(ideas.head, ANALYZER_LINES.ideas);
		const ours = ideaPlaces(presetsFrom(answer.teams), noIdeasFrom(answer.teams));
		assert.deepEqual(
			ideas.places.map((p) => [p.kind, p.rosterId]),
			ours.map((p) =>
				p.kind === 'idea'
					? ['idea', p.preset.team.roster_id]
					: p.kind === 'none'
						? ['none', p.none.team.roster_id]
						: ['offer', p.offer.team.roster_id]
			),
			clock
		);
		const none = ideas.places.filter((p) => p.kind === 'none');
		for (const place of none) {
			assert.equal(place.note, TRADES.noIdea);
			const team = answer.teams.find((t) => t.roster_id === place.rosterId);
			assert.equal(team?.trades.length, 0, `${clock} ${place.team}`);
		}
		quiet += none.length;
	}
	// The fixture's finder drops every idea with at least one team, so the line is drawn.
	assert.ok(quiet > 0);
});

void test('every trade the finder lists is one both sides take on its stated rule (Lane 269)', () => {
	for (const clock of clocks) {
		const answer = advice(`shared/fixtures/inseason/trades-${LEAGUE}-${clock}.json`);
		const limit = limitOf(answer.rest_of_season_basis ?? null);
		assert.equal(parity.clocks[clock]?.restBasis, answer.rest_of_season_basis);
		for (const row of answer.teams.flatMap((t) => t.trades)) {
			assert.ok((row.my_rest_of_season ?? 0) >= -limit, clock);
			assert.ok((row.their_rest_of_season ?? 0) >= -limit, clock);
		}
	}
});

void test("every check's rest-of-season cells are its figures", () => {
	for (const [clock, checks] of Object.entries(parity.checks)) {
		checks.forEach((drawn, i) => {
			const check = dataOf(
				`shared/fixtures/inseason/trade-check-${LEAGUE}-${clock}-${String(i + 1)}.json`
			) as TradeCheck;
			assert.deepEqual(drawn.yours.rest, restFigure(check, 'yours'));
			assert.deepEqual(drawn.theirs.rest, restFigure(check, 'theirs'));
			assert.notEqual(drawn.yours.rest.text, '');
			assert.equal(drawn.restBasis, check.rest_of_season_basis);
		});
	}
});

void test('a side that would not take it leads the line and is tagged', () => {
	const refused = parity.words.checks.filter(
		(c) => c.acceptable !== null && (!c.acceptable.yours || !c.acceptable.theirs)
	);
	assert.ok(refused.length >= 3);
	for (const c of refused) {
		const accepted = c.acceptable;
		if (accepted === null) continue;
		assert.equal(c.cells.yours.refuses, !accepted.yours, c.name);
		assert.equal(c.cells.theirs.refuses, !accepted.theirs, c.name);
		const fills = c.fills.yours && c.fills.theirs && c.fills.yours_room && c.fills.theirs_room;
		if (fills) assert.ok(c.refusal !== null && c.sentence.startsWith(c.refusal), c.name);
	}
	const older = parity.words.checks.find((c) => c.name === 'an older answer');
	assert.ok(older);
	assert.equal(older.cells.yours.text, '');
	assert.equal(older.refusal, null);
});

void test("with the finder's newer fields the row and the verdict draw them (Lane 290)", () => {
	const { needs } = parity;
	const clock = '2026-10-17T17-00-00Z';
	const answer = advice(`shared/fixtures/inseason/trades-${LEAGUE}-needs-${clock}.json`);
	const check = dataOf(
		`shared/fixtures/inseason/trade-check-${LEAGUE}-needs-${clock}-1.json`
	) as TradeCheck;
	// Offers head the row: one the builder holds loads picks, one it cannot says where to answer it.
	assert.equal(needs.offers.length, answer.offers?.length);
	assert.ok(needs.offers.every((o) => o.label === 'Offered to you'));
	assert.ok(needs.offers.some((o) => o.picks !== null && o.note === null));
	assert.ok(needs.offers.some((o) => o.picks === null && o.note !== null));
	// Every idea says what it fills; the ideas keep presetsFrom's order.
	const ideas = needs.ideas.places.filter((p) => p.kind === 'idea');
	assert.ok(ideas.length > 0 && ideas.every((p) => p.fills?.startsWith('Fills your ')));
	assert.deepEqual(
		ideas.map((p) => p.rosterId),
		presetsFrom(answer.teams).map((p) => p.team.roster_id)
	);
	// Every empty team's line is its reason's, and all four reasons are drawn.
	const reasons = new Set(needs.empty.map((e) => e.reason));
	assert.equal(reasons.size, 4);
	for (const e of needs.empty) {
		const team = answer.teams.find((t) => t.roster_id === e.rosterId);
		assert.ok(team);
		assert.equal(team.trades.length, 0);
		assert.equal(e.note, emptyNote(team));
	}
	// The verdict's cells stay the players' figure a side takes a trade on, beside the lineup's the
	// answer now sends (Lane 290's choice), and the basis says what they are.
	assert.ok(check.trade.my_lineup_rest_of_season !== undefined);
	assert.deepEqual(needs.check.yours.rest, restFigure(check, 'yours'));
	assert.equal(
		needs.check.yours.rest.text,
		restFigure(
			{ ...check, trade: { ...check.trade, my_lineup_rest_of_season: undefined } },
			'yours'
		).text
	);
	assert.ok(needs.builderBasis.includes(TRADES.restBasis));
});
