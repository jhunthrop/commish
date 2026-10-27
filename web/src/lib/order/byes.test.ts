// The Players page's week rankings put the byes last under their own head (Lane 163, D06), and every
// row, a bye too, draws the player's number in the full order (Lane 234, B233): run with `npm test`.
// The rows are the fixture order's (scripts/inseason-fixture/data/order.json, the recorded league's
// week 6, where CIN, DET, MIN and others are on bye), drawn at the fixture week's clock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FIXTURE_WEEK_CLOCK } from '../../../scripts/inseason-fixture/clock.ts';
import { onList } from '#lib/league/box/box.ts';
import type { OrderAdvice, OrderRow } from './api.ts';
import { orderSections, orderView, type OrderSection } from './order.ts';
import { BYES_LAST, orderPath } from './path.ts';
import { WEEK_TAB, weekSections, type WeekView } from './week.ts';
import { byeHead } from './words.ts';

const ZONE = 'America/Chicago';
const NOW = Date.parse(FIXTURE_WEEK_CLOCK);
const ORDER = JSON.parse(
	readFileSync(
		new URL('../../../scripts/inseason-fixture/data/order.json', import.meta.url),
		'utf8'
	)
) as OrderAdvice;

const listed = (row: OrderRow): boolean => row.line.facts.designation?.season_long === true;

/** The API's answer with byes=last (order.go placesOf, Lane 227): each row's overall_rank its place in
 * the full order (the available players, then the listed), then the playing rows, the listed and the
 * available byes, each row's rank its place as drawn. */
function byesLast(rows: readonly OrderRow[]): OrderRow[] {
	const full = [...rows.filter((row) => !listed(row)), ...rows.filter(listed)].map((row, i) => ({
		...row,
		overall_rank: i + 1
	}));
	const bye = (row: OrderRow): boolean => row.line.facts.bye && !listed(row);
	return [
		...full.filter((row) => !listed(row) && !bye(row)),
		...full.filter(listed),
		...full.filter(bye)
	].map((row, i) => ({ ...row, rank: i + 1 }));
}

/** A section by its key; the test fails when it is not drawn. */
function sectionOf(sections: readonly OrderSection[], key: OrderSection['key']): OrderSection {
	const found = sections.find((section) => section.key === key);
	assert.ok(found, `no ${key} section`);
	return found;
}

const qbs = byesLast(ORDER.rows.filter((row) => row.line.player.position === 'QB'));
const all = byesLast(ORDER.rows);

void test('the week rankings put the byes in their own section, each with his full-order number', () => {
	for (const [rows, pillRank] of [
		[qbs, false],
		[all, true]
	] as const) {
		const views = rows.map((row) => orderView(row, ZONE, pillRank, NOW, true));
		const sections = orderSections(views, ORDER.week);
		const playing = sectionOf(sections, 'playing');
		const byes = sectionOf(sections, 'bye');
		assert.equal(sections.length, 2);
		assert.equal(playing.head, null);
		assert.equal(byes.head, `Bye in week ${String(ORDER.week)}`);
		// Every row draws overall_rank, never rank: a bye keeps the number he has in the full order.
		views.forEach((view, i) => {
			const row = rows[i] ?? assert.fail('no row');
			if (onList(view.box.status)) assert.doesNotMatch(view.place, /^\d+$/);
			else assert.equal(view.place, String(row.overall_rank), view.box.name);
		});
		for (const view of byes.rows) {
			assert.match(view.place, /^\d+$/, `${view.box.name} on bye draws no number`);
			assert.equal(view.box.game, 'bye');
		}
		// The rows that play are not consecutive: the numbers skip where the byes moved out.
		const numbered = playing.rows.filter((v) => !onList(v.box.status)).map((v) => Number(v.place));
		assert.ok(
			numbered.some((n, i) => i > 0 && n !== (numbered[i - 1] ?? 0) + 1),
			'the fixture has a bye inside the playing rows'
		);
		assert.deepEqual(
			numbered,
			numbered.toSorted((a, b) => a - b)
		);
		// One number for a player on every view: the same row read without byes=last draws the same.
		const unmoved = new Map(
			rows.map((row) => [row.line.player.board_id, orderView(row, ZONE, pillRank, NOW).place])
		);
		for (const view of views) assert.equal(view.place, unmoved.get(view.key));
		for (const view of playing.rows) assert.ok(!view.bye);
	}
	const qbViews = qbs.map((row) => orderView(row, ZONE, false, NOW, true));
	assert.deepEqual(
		orderSections(qbViews, ORDER.week)[1]?.rows.map((v) => v.box.name),
		['Joe Burrow']
	);
});

void test('an answer from before overall_rank draws its rank (the deploy window)', () => {
	const [first] = all;
	assert.ok(first);
	// The previous API's row, the field absent.
	const older = Object.fromEntries(
		Object.entries({ ...first, rank: 7 }).filter(([key]) => key !== 'overall_rank')
	) as OrderRow;
	assert.ok(!('overall_rank' in older));
	assert.equal(orderView(older, ZONE, true, NOW, true).place, '7');
	assert.equal(orderView({ ...first, rank: 7, overall_rank: 9 }, ZONE, true, NOW, true).place, '9');
});

void test('a listed player on bye stays with the listed, his list word in the # cell', () => {
	const achane = all.find((row) => row.line.player.name === "De'Von Achane");
	assert.ok(achane?.line.facts.bye);
	const view = orderView(achane, ZONE, true, NOW, true);
	assert.equal(view.bye, false);
	assert.ok(view.place.length > 0 && !/^\d+$/.test(view.place));
});

void test('Rest of season keeps every bye in its place, numbered', () => {
	const views = ORDER.rows.map((row) => orderView(row, ZONE, true, NOW));
	assert.equal(orderSections(views, ORDER.week).length, 1);
	const burrow = views.find((v) => v.box.name === 'Joe Burrow');
	assert.equal(burrow?.bye, false);
	assert.match(burrow.place, /^\d+$/);
});

void test('the byes read one head on the week box score and the week rankings', () => {
	assert.equal(byeHead(7), 'Bye in week 7');
	const bye = { section: 'bye' } as WeekView;
	assert.equal(weekSections([bye], 7)[0]?.head, byeHead(7));
	assert.equal(WEEK_TAB.byeIn, 'Bye in week');
});

void test('the public route alone asks for the byes last', () => {
	const query = { position: null, q: null, roster: null, limit: 100, byes: BYES_LAST };
	assert.equal(orderPath(null, query), '/order?limit=100&byes=last');
	assert.equal(orderPath('7f', query), '/leagues/attached/7f/order?limit=100');
	assert.equal(orderPath(null, { ...query, byes: null }), '/order?limit=100');
});
