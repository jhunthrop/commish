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
import { BOX, reserveRow, type BoxRow } from '#lib/league/box/box.ts';
import { heldLineup, lineupBox, swapOf, swapWords } from '#lib/league/box/lineup.ts';
import { addVerbWords, poolRows } from '#lib/league/box/waivers.ts';
import type { LineupAdvice, WaiverAdvice } from '#lib/league/inseason/api.ts';
import { BUILDER_LINES } from '#lib/league/inseason/builder.ts';
import { CARD, NONE } from './card.ts';
import {
	gameTiles,
	rankedTiles,
	rowNext,
	rowSource,
	rowTiles,
	SHELF,
	shelfHead,
	shelfSource,
	shelfVerb,
	type ShelfVerb
} from './shelf.ts';
import {
	SHELF_PARAM,
	ShelfHost,
	backToLineupOffer,
	compareOffer,
	lineupOffer,
	plainClick,
	rowBySlug,
	shelfHref,
	shelfSlug,
	shelfScope,
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

/** The card's source from a row, failing the test for a row our board does not place. */
function rowSourceOf(row: BoxRow): NonNullable<ReturnType<typeof rowSource>> {
	const source = rowSource(row);
	if (source === null) throw new Error(`${row.name} has no source.`);
	return source;
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
	const gainwell = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'kenny-gainwell');
	const tiles = gameTiles(rowTiles(gainwell, null), gainwell.state, gainwell.pts);
	assert.deepEqual(
		tiles.map((t) => t.key),
		['proj', 'rest', 'opp', 'avg', 'last', 'delta']
	);
	const proj = tiles.find((t) => t.key === 'proj');
	assert.ok(proj);
	assert.equal(proj.label, CARD.proj);
	assert.notEqual(proj.value, NONE);
	assert.equal(tiles.find((t) => t.key === 'rest')?.value, NONE);

	const sunday = rowOf(lineupRows(FIXTURE_SUNDAY_CLOCK), 'kenny-gainwell');
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

/** The fixture's answer with one player as the API answers a free agent (Lane 123): his club cell
 * "FA", no game, no bye and no Proj. */
function asFreeAgent(answer: unknown, slug: string): unknown {
	const walk = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(walk);
		if (value === null || typeof value !== 'object') return value;
		const record = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
		if (record.slug !== slug || typeof record.player !== 'object' || record.player === null)
			return record;
		const facts = record.facts as Record<string, unknown>;
		return {
			...record,
			player: { ...(record.player as Record<string, unknown>), team: 'FA' },
			facts: { ...facts, opponent: null, home: null, kickoff: null, bye: false },
			week_projection: null,
			opp_rank: null
		};
	};
	return walk(answer);
}

void test("a free agent's shelf reads FA in the club cell and No club in the game cell (Lane 123)", () => {
	const now = Date.parse(FIXTURE_WEEK_CLOCK);
	const answer = asFreeAgent(data('lineup', FIXTURE_WEEK_CLOCK), 'jaxson-dart') as LineupAdvice;
	const box = lineupBox(heldLineup(answer, now), ZONE, now);
	const rows = [...box.starters.map((e) => e.row), ...box.bench.map((e) => e.row), ...box.reserve];
	const dart = rowOf(rows, 'jaxson-dart');
	assert.equal(dart.club, 'FA');
	assert.equal(dart.game, 'no-club');
	assert.equal(rowNext(dart), null);
	assert.equal(rowSource(dart)?.player.team, 'FA');
	// The rest of the fixture keeps its clubs and games.
	assert.notEqual(rowOf(rows, 'sam-laporta').club, 'FA');
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
		},
		warm: () => {
			nav.log.push('warm');
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
const options = {
	screen: 'waivers' as const,
	now: () => Date.parse(FIXTURE_WEEK_CLOCK),
	league: () => null,
	offer: () => null
};

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
	assert.deepEqual(host.tap('jaxson-dart'), { row: dart, note: null });
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
	assert.equal(host.tap('jaxson-dart')?.row.name, 'Jaxson Dart');
	assert.deepEqual(nav.log, [`replace ${reloaded}`]);
	host.close();
	assert.deepEqual(nav.log.at(-1), `replace ${SCREEN}`);
	assert.equal(host.slug, null);
});

void test("on a page of many, a card opens over its own block's rows only (Lane 257)", () => {
	const nav = fakeNav(SCREEN);
	let cardIn: string | undefined;
	const go = nav.go;
	const scoped: ShelfNav = {
		...nav,
		cardIn: () => cardIn,
		go: (href, options) => {
			go(href, options);
			if (options.state !== undefined) cardIn = options.state.cardIn;
		}
	};
	const a = new ShelfHost({ ...options, scope: 'a' }, scoped);
	const b = new ShelfHost({ ...options, scope: 'b' }, scoped);
	a.open(click(), rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart'));
	assert.equal(a.slug, 'jaxson-dart');
	assert.equal(b.slug, null);
	assert.equal(shelfScope(nav.at), 'a');
	// A reload reopens it in the block the address names, and no other.
	const reloaded = fakeNav(nav.at);
	let reloadedIn: string | undefined;
	const reloadedNav: ShelfNav = {
		...reloaded,
		cardIn: () => reloadedIn,
		go: (href, options) => {
			reloaded.go(href, options);
			if (options.state !== undefined) reloadedIn = options.state.cardIn;
		}
	};
	new ShelfHost({ ...options, scope: 'b' }, reloadedNav).restore();
	assert.deepEqual(reloaded.log, []);
	const again = new ShelfHost({ ...options, scope: 'a' }, reloadedNav);
	again.restore();
	assert.equal(again.slug, 'jaxson-dart');
	// Closed, the address names neither the card nor its block.
	assert.equal(shelfScope(shelfHref(nav.at, null)), null);
	assert.equal(shelfSlug(shelfHref(nav.at, null)), null);
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

void test("the tapped row's facts stay over his page's build: its IR words and its rank", () => {
	const laporta = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'sam-laporta');
	assert.equal(laporta.pill?.rank, 11, "the run's playing-first rank, one on every screen");
	const built = { position: 'TE' as const, rank: 12, status: null };
	assert.equal(shelfHead({ row: laporta, note: null }, built).rank, 11);
	// A tag the row drops once his game kicks off (Lane 104) stays dropped: the build's never returns.
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	const tagged = { position: 'TE' as const, rank: 12, status: dart.status };
	assert.equal(shelfHead({ row: laporta, note: null }, tagged).status, laporta.status);
	// With no row (a shared link to a card the screen does not hold) the build's head stands.
	assert.deepEqual(shelfHead(null, built), { position: 'TE', rank: 12, status: null, note: null });
});

void test('a player designated to return this week starts with his week, his day on the pill (Lane 153)', () => {
	// Travis Etienne is due back Sunday Oct 18 on the capture the stand-in run is marked with: the
	// fixture league reads him as this week's question, ranked as playing, his Proj his own.
	const lineup = lineupRows(FIXTURE_WEEK_CLOCK);
	const etienne = rowOf(lineup, 'travis-etienne-jr');
	assert.equal(etienne.status?.mark, 'Due back Sun Oct 18');
	assert.equal(etienne.status.rank, null);
	assert.equal(etienne.reserve, false);
	assert.equal(typeof etienne.pill?.rank, 'number');
	assert.equal(etienne.proj, 14.2);
	assert.notEqual(etienne.evidence.oppRank, null);
	assert.notEqual(etienne.slot, 'Bench', 'a week’s designation moves nothing: he starts');
	const head = shelfHead({ row: etienne, note: null }, { position: 'RB', rank: 30, status: null });
	assert.equal(head.rank, etienne.pill?.rank);
	assert.equal(head.status, etienne.status);
	for (const key of ['proj', 'opp', 'delta'] as const) {
		const t = rowTiles(etienne, null).find((x) => x.key === key);
		assert.notEqual(t?.caption, 'On IR', key);
	}
});

void test('an IR row carries no rank: the shelf says the list where the rank would be (Lane 128)', () => {
	// Jaxson Dart is on injured reserve on the capture the stand-in run is marked with, and the
	// fixture league reads the same capture: his row draws no rest-of-season rank.
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	assert.equal(dart.status?.rank, 'IR');
	assert.equal(dart.status.mark, 'IR since Sep 24');
	assert.deepEqual(dart.pill, { position: 'QB', rank: null, ranked: true });
	const built = { position: 'QB' as const, rank: 31, status: null };
	const head = shelfHead({ row: dart, note: null }, built);
	assert.equal(head.rank, null, "the build's rank never returns");
	assert.equal(head.status, dart.status);
	// The rest-of-season tile names no rank beside the pill's IR.
	const rest = rowTiles(dart, null).map((t) =>
		t.key === 'rest' ? { ...t, caption: 'PPR points for 2026, QB31 in our order' } : t
	);
	const tiles = rankedTiles(rest, 'QB', 31, head.rank);
	assert.equal(tiles.find((t) => t.key === 'rest')?.caption, 'PPR points for 2026');
	// His week is not his (fix round 1): no Proj on the row, and his tiles say the list.
	assert.equal(dart.proj, null);
	assert.equal(dart.evidence.oppRank, null);
	for (const key of ['proj', 'opp', 'delta'] as const) {
		const t = rowTiles(dart, null).find((x) => x.key === key);
		assert.deepEqual([t?.value, t?.caption], [NONE, 'On IR'], key);
	}
	// The shelf reads his week with the row's list, never the build's beside it.
	const fromBuild = { ...rowSourceOf(dart), held: null };
	assert.equal(shelfSource(fromBuild, dart).held, 'IR');
	assert.equal(shelfSource(fromBuild, null).held, null);
	// The platform's own IR spot (Tank Bigsby) carries none either.
	const bigsby = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'tank-bigsby');
	assert.equal(bigsby.pill?.rank, null);
	assert.equal(bigsby.status?.rank, 'IR');
	// The bench's IR row says why he is a drop, as Lane 98 draws it.
	const onBench = shelfHead({ row: reserveRow(dart, 'bench'), note: BOX.irBench }, built);
	assert.equal(onBench.note, 'IR-eligible, taking a bench spot');
	assert.equal(onBench.rank, null);
});

void test("the Lineup's own verb closes onto his row, his swap under it", () => {
	const now = Date.parse(FIXTURE_WEEK_CLOCK);
	const box = lineupBox(
		heldLineup(data('lineup', FIXTURE_WEEK_CLOCK) as LineupAdvice, now),
		ZONE,
		now
	);
	const mahomes = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'patrick-mahomes');
	const swap = swapOf(box.swaps, mahomes);
	assert.ok(swap);
	const verb = actOf(
		shelfVerb('lineup', mahomes.state, backToLineupOffer(NOTHING, swapWords(swap)))
	);
	assert.equal(verb.label, SHELF.backToLineup);
	assert.notEqual(verb.label, CARD.openLineup);
	assert.equal(verb.line, 'QB, Mahomes in, Rodgers out');
	// The bench player the swap sits carries the same line.
	const rodgers = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'aaron-rodgers');
	assert.equal(swapOf(box.swaps, rodgers), swap);
});

void test('a card whose build cannot be read still reads his week from the row', () => {
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	const source = rowSource(dart);
	assert.ok(source);
	assert.equal(source.player.id, dart.boardId);
	assert.equal(source.player.name, 'Jaxson Dart');
	assert.equal(source.tiles.length, 6);
	assert.equal(rowSource({ ...dart, boardId: null }), null);
});

void test("the rest-of-season tile names the row's rank, never the build's beside it", () => {
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	const built = rowTiles(dart, null).map((t) =>
		t.key === 'rest' ? { ...t, caption: 'PPR points for 2026, QB12 in our order' } : t
	);
	const tiles = rankedTiles(built, 'QB', 12, 31);
	assert.equal(
		tiles.find((t) => t.key === 'rest')?.caption,
		'PPR points for 2026, QB31 in our order'
	);
	assert.deepEqual(rankedTiles(built, 'QB', 12, undefined), built);
	// A row drawn unranked names no rank in the caption either (Lane 115, B93).
	assert.equal(
		rankedTiles(built, 'QB', 12, null).find((t) => t.key === 'rest')?.caption,
		'PPR points for 2026'
	);
});

void test("a Lineup or Matchup row drawn unranked shows no rank, never the build's (Lane 115, B93)", () => {
	const dart = rowOf(lineupRows(FIXTURE_WEEK_CLOCK), 'jaxson-dart');
	assert.ok(dart.pill?.ranked === true);
	const built = { position: 'QB' as const, rank: 12, status: null };
	const unranked = { ...dart, pill: { position: 'QB' as const, rank: null, ranked: true } };
	assert.equal(shelfHead({ row: unranked, note: null }, built).rank, null);
	// A screen that draws no rank (Waivers, Trades) leaves the build's.
	const waivers = { ...dart, pill: { position: 'QB' as const, rank: null, ranked: false } };
	assert.equal(shelfHead({ row: waivers, note: null }, built).rank, 12);
});
