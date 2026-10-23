// The Players page's week rankings never number a player on bye (Lane 163, D06): run with `npm test`.
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

/** The API's answer with byes=last (order.go playingFirst): the playing rows, the listed, then the
 * available byes, numbered on. */
function byesLast(rows: readonly OrderRow[]): OrderRow[] {
	const listed = (row: OrderRow): boolean => row.line.facts.designation?.season_long === true;
	const bye = (row: OrderRow): boolean => row.line.facts.bye && !listed(row);
	return [
		...rows.filter((row) => !listed(row) && !bye(row)),
		...rows.filter(listed),
		...rows.filter(bye)
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

void test('the week rankings put the byes in their own section, with no number', () => {
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
		for (const view of byes.rows) {
			assert.equal(view.place, '', `${view.box.name} on bye draws a number`);
			assert.equal(view.box.game, 'bye');
		}
		// The rows that play are numbered 1..n first; a listed row keeps its list's word.
		const numbered = playing.rows.filter((v) => !onList(v.box.status));
		assert.deepEqual(
			numbered.map((v) => v.place),
			numbered.map((_, i) => String(i + 1))
		);
		for (const view of playing.rows) assert.ok(!view.bye);
	}
	const qbViews = qbs.map((row) => orderView(row, ZONE, false, NOW, true));
	assert.deepEqual(
		orderSections(qbViews, ORDER.week)[1]?.rows.map((v) => v.box.name),
		['Joe Burrow']
	);
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
