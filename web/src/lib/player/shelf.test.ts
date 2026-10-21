// The player shelf (Lane 113): its verb by the screen and the row's game state, its tiles from the
// row's own cells, and its address (open, close, back, reload) through the host with a fake browser.
// Rows come through the engine from the fixture league at fixed clocks. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	FIXTURE_MONDAY_CLOCK,
	FIXTURE_SUNDAY_CLOCK,
	FIXTURE_WEEK_CLOCK
} from '../../../scripts/inseason-fixture/clock.ts';
import { stamped } from '../../../scripts/inseason-fixture/game-state.ts';
import { inTenths } from '../../../scripts/inseason-fixture/tenths.ts';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { BOX, type BoxRow } from '#lib/league/box/box.ts';
import { heldLineup, lineupBox } from '#lib/league/box/lineup.ts';
import { addVerbWords, poolRows } from '#lib/league/box/waivers.ts';
import type { LineupAdvice, WaiverAdvice } from '#lib/league/inseason/api.ts';
import { BUILDER_LINES } from '#lib/league/inseason/builder.ts';
import { CARD, NONE } from './card.ts';
import { gameTiles, rowNext, rowTiles, SHELF, shelfVerb, type ShelfVerb } from './shelf.ts';
import {
	SHELF_PARAM,
	ShelfHost,
	compareOffer,
	lineupOffer,
	plainClick,
	rowBySlug,
	shelfHref,
	shelfSlug,
	type ScreenOffer,
	type ShelfClick,
	type ShelfGo,
	type ShelfNav
} from './shelf-state.ts';

const ZONE = 'America/Chicago';
const data = (name: string, clock: string): unknown =>
	inTenths(
		stamped(
			JSON.parse(
				readFileSync(
					new URL(`../../../scripts/inseason-fixture/data/${name}.json`, import.meta.url),
					'utf8'
				)
			),
			Date.parse(clock)
		)
	);

/** The fixture's lineup rows through the Lineup's engine at a clock, every row of the box. */
function lineupRows(clock: string): BoxRow[] {
	const now = Date.parse(clock);
	const box = lineupBox(heldLineup(data('lineup', clock) as LineupAdvice, now), ZONE, now);
	return [...box.starters.map((e) => e.row), ...box.bench.map((e) => e.row), ...box.reserve];
}

function rowOf(rows: readonly BoxRow[], slug: string): BoxRow {
	const row = rowBySlug(rows, slug);
	if (row === null) throw new Error(`The fixture has no row for ${slug}.`);
	return row;
}

const OPEN_LINEUP = lineupOffer({ href: '/league/x/start?player=1' });
/** A screen's action that does nothing the test reads. */
const NOTHING = (): void => undefined;

/** The verb's offer, failing the test when the shelf gives none or the held words. */
function actOf(verb: ShelfVerb | null): Extract<ShelfVerb, { kind: 'act' }> {
	if (verb?.kind !== 'act') throw new Error(`No verb: ${JSON.stringify(verb)}`);
	return verb;
}

void test("a lineup screen's verb is the way to his row while his game is to come", () => {
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	assert.equal(dart.state, 'upcoming');
	for (const screen of ['lineup', 'matchup', 'league'] as const) {
		assert.equal(actOf(shelfVerb(screen, dart.state, OPEN_LINEUP)).label, CARD.openLineup);
	}
});

void test('on a bye his lineup verb stands: no game holds him', () => {
	const laporta = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'sam-laporta');
	assert.equal(laporta.state, null);
	assert.equal(shelfVerb('lineup', laporta.state, OPEN_LINEUP)?.kind, 'act');
});

void test("once his game has kicked off a lineup screen gives the held row's words, no verb", () => {
	const sunday = lineupRows(FIXTURE_SUNDAY_CLOCK);
	const dart = rowOf(sunday, 'jaxson-dart');
	assert.equal(dart.state, 'kicked_off');
	assert.deepEqual(shelfVerb('lineup', dart.state, OPEN_LINEUP), {
		kind: 'held',
		words: CARD.kickedOff
	});
	// Thursday's game is final by Saturday.
	const charbonnet = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'zach-charbonnet');
	assert.equal(charbonnet.state, 'final');
	assert.deepEqual(shelfVerb('matchup', charbonnet.state, OPEN_LINEUP), {
		kind: 'held',
		words: CARD.gameFinal
	});
	const monday = rowOf(lineupRows(FIXTURE_MONDAY_CLOCK), 'jaxson-dart');
	assert.equal(shelfVerb('league', monday.state, OPEN_LINEUP)?.kind, 'held');
});

void test("Waivers gives the screen's own add with the drop, at any game state", () => {
	const advice = data('waivers', FIXTURE_SUNDAY_CLOCK) as WaiverAdvice;
	const now = Date.parse(FIXTURE_SUNDAY_CLOCK);
	const pool = poolRows(advice, ZONE, now);
	const first = pool[0];
	assert.ok(first);
	const label = addVerbWords(advice.moves, first.source.add.player.host_id, 'sleeper');
	const offer: ScreenOffer = {
		label,
		line: 'Add Otton, drop Mason',
		href: null,
		run: NOTHING,
		focus: null
	};
	for (const state of ['upcoming', 'kicked_off', 'final', null] as const) {
		const verb = actOf(shelfVerb('waivers', state, offer));
		assert.equal(verb.label, label);
		assert.equal(verb.line, 'Add Otton, drop Mason');
	}
});

void test('Trades builds a trade, Players compares, and a screen with no offer gives no verb', () => {
	const trade: ScreenOffer = {
		label: BUILDER_LINES.open,
		line: null,
		href: null,
		run: NOTHING,
		focus: null
	};
	assert.equal(actOf(shelfVerb('trades', 'kicked_off', trade)).label, BUILDER_LINES.open);
	const compare = actOf(shelfVerb('players', 'upcoming', compareOffer('/compare?a=jaxson-dart')));
	assert.equal(compare.label, CARD.compare);
	assert.equal(compare.href, '/compare?a=jaxson-dart');
	assert.equal(shelfVerb('rest', 'upcoming', null), null);
	assert.equal(shelfVerb('matchup', 'upcoming', null), null);
});

void test("the shelf opens on the row's own cells, Proj while his game is to come and Pts after", () => {
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	const tiles = gameTiles(rowTiles(dart, null), dart.state, dart.pts);
	assert.deepEqual(
		tiles.map((t) => t.key),
		['proj', 'rest', 'opp', 'avg', 'last', 'delta']
	);
	const proj = tiles.find((t) => t.key === 'proj');
	assert.ok(proj);
	assert.equal(proj.label, CARD.proj);
	assert.notEqual(proj.value, NONE);
	assert.equal(tiles.find((t) => t.key === 'rest')?.value, NONE);

	const sunday = rowOf(lineupRows(FIXTURE_SUNDAY_CLOCK), 'jaxson-dart');
	const live = gameTiles(rowTiles(sunday, null), sunday.state, 14.2);
	assert.deepEqual(
		live.find((t) => t.key === 'proj'),
		{
			key: 'proj',
			label: BOX.pts,
			value: '14.2',
			caption: CARD.kickedOff,
			tone: 'lead'
		}
	);
});

void test("the row's cells stand over his page's build, the build's rest of season kept", () => {
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	const built = rowTiles(dart, null).map((t) =>
		t.key === 'rest' ? { ...t, value: '174.0', caption: 'from week 6' } : { ...t, caption: 'built' }
	);
	const tiles = rowTiles(dart, built);
	assert.equal(tiles.find((t) => t.key === 'rest')?.value, '174.0');
	assert.equal(tiles.find((t) => t.key === 'avg')?.caption, 'built');
});

void test("his game line is the row's Game cell, none on a bye", () => {
	const rows = lineupRows(FIXTURE_WEEK_CLOCK);
	const dart = rowOf(rows, 'jaxson-dart');
	assert.equal(rowNext(dart)?.where, 'vs NO');
	assert.equal(rowNext(rowOf(rows, 'sam-laporta')), null);
});

void test("the shelf's words pass the copy guard", () => {
	for (const words of Object.values(SHELF)) assert.doesNotMatch(words, bannedPattern());
});

/** A fake browser: its address, the page's state and every navigation asked of it. */
function fakeNav(
	start: string
): ShelfNav & { at: string; state: string | undefined; log: string[] } {
	const nav = {
		at: start,
		state: undefined as string | undefined,
		log: [] as string[],
		href: () => nav.at,
		card: () => nav.state,
		go: (href: string, options: ShelfGo) => {
			nav.log.push(`${options.replace === true ? 'replace' : 'push'} ${href}`);
			nav.at = href;
			if (options.state !== undefined) nav.state = options.state.card;
		},
		back: () => {
			nav.log.push('back');
			nav.state = undefined;
			nav.at = shelfHref(nav.at, null);
		},
		focus: (target: string) => {
			nav.log.push(`focus ${target}`);
			return target === OPENED_PANEL;
		}
	};
	return nav;
}

function click(over: Partial<ShelfClick> = {}): ShelfClick & { prevented: boolean } {
	const event = {
		defaultPrevented: false,
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		currentTarget: null as unknown,
		prevented: false,
		preventDefault: () => {
			event.prevented = true;
		},
		...over
	};
	return event;
}

const SCREEN = 'https://trycommish.com/league/x/waivers?player=4689114';
/** The panel a verb opens on the screen, which the fake browser finds. */
const OPENED_PANEL = 'claim-move';
const options = { screen: 'waivers' as const, league: () => null, offer: () => null };

void test('a tap opens his card at ?card=, keeping the screen and its asked player', () => {
	const nav = fakeNav(SCREEN);
	const host = new ShelfHost(options, nav);
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	const event = click();
	host.open(event, dart);
	assert.equal(event.prevented, true);
	assert.equal(host.slug, 'jaxson-dart');
	assert.equal(shelfSlug(nav.at), 'jaxson-dart');
	assert.equal(new URL(nav.at).searchParams.get('player'), '4689114');
	assert.deepEqual(nav.log, [`push ${shelfHref(SCREEN, 'jaxson-dart')}`]);
	assert.equal(host.row('jaxson-dart'), dart);
});

void test('a modified click goes to his page as the link does', () => {
	const nav = fakeNav(SCREEN);
	const host = new ShelfHost(options, nav);
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	for (const over of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
		const event = click(over);
		host.open(event, dart);
		assert.equal(event.prevented, false);
	}
	assert.equal(plainClick(click({ defaultPrevented: true })), false);
	assert.deepEqual(nav.log, []);
});

void test('closing goes back through the entry the tap pushed, and the focus returns to his name', () => {
	const nav = fakeNav(SCREEN);
	const host = new ShelfHost(options, nav);
	let focused = 0;
	const name = { focus: () => (focused += 1), isConnected: true };
	host.open(click({ currentTarget: name }), rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart'));
	host.close();
	assert.equal(nav.log.at(-1), 'back');
	assert.equal(host.slug, null);
	assert.equal(nav.at, SCREEN);
	host.refocus();
	assert.equal(focused, 1);
});

void test('a reload reopens the card the address names, and closing it then clears the address', () => {
	const reloaded = shelfHref(SCREEN, 'jaxson-dart');
	const nav = fakeNav(reloaded);
	const rows = lineupRows(FIXTURE_WEEK_CLOCK);
	const host = new ShelfHost({ ...options, rowOf: (slug) => rowBySlug(rows, slug) }, nav);
	host.restore();
	assert.equal(host.slug, 'jaxson-dart');
	assert.equal(host.row('jaxson-dart')?.name, 'Jaxson Dart');
	assert.deepEqual(nav.log, [`replace ${reloaded}`]);
	host.close();
	assert.deepEqual(nav.log.at(-1), `replace ${SCREEN}`);
	assert.equal(host.slug, null);
});

void test('a verb that opens a panel on the screen gives it the focus, the name otherwise', () => {
	const nav = fakeNav(SCREEN);
	const host = new ShelfHost(options, nav);
	let focused = 0;
	const name = { focus: () => (focused += 1), isConnected: true };
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	host.open(click({ currentTarget: name }), dart);
	host.close(OPENED_PANEL);
	host.refocus();
	assert.equal(nav.log.at(-1), `focus ${OPENED_PANEL}`);
	assert.equal(focused, 0);
	// A panel not drawn after all: the name takes it back.
	host.open(click({ currentTarget: name }), dart);
	host.close('trade-builder');
	host.refocus();
	assert.equal(focused, 1);
});

void test("a verb that leaves the screen replaces the card's entry", () => {
	const nav = fakeNav(SCREEN);
	const host = new ShelfHost(options, nav);
	host.open(click(), rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart'));
	host.leave('/league/x/start?player=4689114');
	assert.equal(nav.log.at(-1), 'replace /league/x/start?player=4689114');
});

void test('the address field is its own, never the asked player', () => {
	assert.notEqual(SHELF_PARAM, 'player');
	assert.equal(shelfSlug(`${SCREEN}&${SHELF_PARAM}=`), null);
});
