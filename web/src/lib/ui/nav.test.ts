// The rail as a function of the season's phase (spec 2026-10-16 §2). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	LEAGUE_PHASES,
	PHONE_RAIL_ITEMS,
	RAIL_FOOT,
	RAIL_KEYS,
	RAIL_ITEMS,
	SCREEN_PARAM,
	shellHrefs,
	railHref,
	NO_LEAGUE_RAIL,
	railInSeason,
	railKey,
	railPhase,
	sectionHref,
	sectionOf,
	type LeaguePhase
} from './nav.ts';
import { leagueScreenOf, screenSection } from './rail-league.ts';
import { BANNED_MARKS, BANNED_WORDS } from '#lib/format/copy-guard.ts';
import { railFor, railOfKey, type RailEntry } from './rail-order.ts';

const labels = (items: readonly RailEntry[]): string[] => items.map((item) => item.label);
const phone = (items: readonly RailEntry[]): string[] =>
	labels(items.filter((item) => !item.wideOnly));
const wide = (items: readonly RailEntry[]): string[] =>
	labels(items.filter((item) => item.wideOnly));

/** §2's table: the phone's five in order, then what the wide rail adds above the Account foot. */
const TABLE: Readonly<Record<LeaguePhase, { phone: string[]; wide: string[] }>> = {
	pre_draft: {
		phone: ['Board', 'Players', 'Mock draft', 'Cheat sheet', 'Advisor'],
		wide: ['Our record']
	},
	draft_day: {
		phone: ['Advisor', 'Board', 'Players', 'Cheat sheet', 'Mock draft'],
		wide: ['Our record']
	},
	in_season: {
		phone: ['League', 'Lineup', 'Matchup', 'Waivers', 'Trades'],
		wide: ['Players', 'Rest of season', 'Our record']
	},
	playoffs: {
		phone: ['League', 'Lineup', 'Matchup', 'Trades', 'Players'],
		wide: ['Rest of season', 'Our record']
	},
	offseason: {
		phone: ['Board', 'Players', 'Mock draft', 'Cheat sheet', 'Advisor'],
		wide: ['Our record']
	}
};

for (const phase of LEAGUE_PHASES) {
	void test(`the ${phase} rail: the phone's five in order, the wide rail the rest`, () => {
		const items = railFor(phase, false);
		assert.deepEqual(phone(items), TABLE[phase].phone);
		assert.equal(phone(items).length, PHONE_RAIL_ITEMS);
		assert.deepEqual(wide(items), TABLE[phase].wide);
		// The five come first, so the wide rail reads them in the phone's order.
		assert.deepEqual(labels(items).slice(0, PHONE_RAIL_ITEMS), TABLE[phase].phone);
		assert.equal(RAIL_FOOT.label, 'Account');
		assert.ok(!labels(items).includes('Leagues'));
	});
}

void test("waivers stay on the phone's five in the playoffs while the host runs them", () => {
	const open = railFor('playoffs', true);
	assert.deepEqual(phone(open), TABLE.in_season.phone);
	assert.deepEqual(wide(open), TABLE.in_season.wide);
	// Outside the playoffs the flag changes nothing.
	for (const phase of LEAGUE_PHASES.filter((p) => p !== 'playoffs')) {
		assert.deepEqual(railFor(phase, true), railFor(phase, false));
	}
});

/** A league's pages a phase has: its own page and every screen its rail opens. */
const leaguePages = (items: readonly RailEntry[]): string[] =>
	items.flatMap((item) => (item.screen === undefined ? [] : [item.screen]));

void test("the rail is the one way between a league's pages: the phone reaches every one", () => {
	for (const phase of LEAGUE_PHASES) {
		for (const open of [true, false]) {
			const items = railFor(phase, open);
			const pages = leaguePages(items);
			assert.deepEqual(leaguePages(items.filter((item) => !item.wideOnly)), pages);
			// The league page leads whenever the phase has a screen, and only then.
			assert.equal(pages[0] === 'league', pages.length > 0);
		}
	}
	assert.deepEqual(leaguePages(railFor('in_season', true)), [
		'league',
		'start',
		'matchup',
		'waivers',
		'trades'
	]);
	assert.deepEqual(leaguePages(railFor('pre_draft', true)), []);
	assert.deepEqual(leaguePages(railFor('offseason', true)), []);
});

void test('the rail is the selected league phase, else the site season, preseason as pre_draft', () => {
	assert.deepEqual(railPhase({ phase: 'in_season', waivers_open: true }, 'preseason'), {
		phase: 'in_season',
		waiversOpen: true,
		league: true
	});
	assert.deepEqual(railPhase(null, 'preseason'), {
		phase: 'pre_draft',
		waiversOpen: false,
		league: false
	});
	assert.deepEqual(railPhase(null, 'playoffs'), {
		phase: 'playoffs',
		waiversOpen: false,
		league: false
	});
	assert.deepEqual(railPhase(null, 'offseason'), {
		phase: 'offseason',
		waiversOpen: false,
		league: false
	});
	// An API from before the phase answers none: the site season stands, the league still selected.
	assert.deepEqual(railPhase({}, 'in_season'), {
		phase: 'in_season',
		waiversOpen: false,
		league: true
	});
	assert.equal(railKey({ phase: 'playoffs', waiversOpen: true, league: true }), 'playoffs_waivers');
	assert.equal(railKey({ phase: 'playoffs', waiversOpen: false, league: true }), 'playoffs');
	assert.equal(railKey({ phase: 'in_season', waiversOpen: true, league: true }), 'in_season');
});

void test('in season with no league selected, the rail draws no league tabs (Lane 83)', () => {
	// The season's own rail, signed out or with no league followed: League still opens the follow
	// page, and none of the four screens that only led there is drawn.
	assert.equal(railKey(railPhase(null, 'in_season')), NO_LEAGUE_RAIL);
	assert.equal(railKey(railPhase(null, 'playoffs')), NO_LEAGUE_RAIL);
	// Before the draft and after the season the rail never had them.
	assert.equal(railKey(railPhase(null, 'preseason')), 'pre_draft');
	assert.equal(railKey(railPhase(null, 'offseason')), 'offseason');
	assert.ok(RAIL_KEYS.includes(NO_LEAGUE_RAIL));
	assert.ok(railInSeason(NO_LEAGUE_RAIL));
	const items = railOfKey(NO_LEAGUE_RAIL);
	assert.deepEqual(phone(items), [
		'League',
		'Rest of season',
		'Players',
		'Mock draft',
		'Our record'
	]);
	assert.deepEqual(wide(items), []);
	assert.deepEqual(leaguePages(items), ['league']);
	assert.equal(railHref(items[0] ?? RAIL_FOOT, null), '/league/new');
	assert.equal(railHref(items[1] ?? RAIL_FOOT, null), '/board');
});

void test('the shell draws every item once, marked for the rail styles', () => {
	const keys = RAIL_ITEMS.map((item) => item.key);
	assert.equal(new Set(keys).size, keys.length);
	for (const phase of LEAGUE_PHASES) {
		for (const entry of railFor(phase, true)) assert.ok(keys.includes(entry.key), entry.key);
	}
	const shell = readFileSync(new URL('./Shell.svelte', import.meta.url), 'utf8');
	assert.ok(shell.includes('{#each RAIL_ITEMS as item (item.key)}'));
	assert.ok(shell.includes('data-k={foot ? undefined : item.key}'));
	assert.ok(RAIL_KEYS.includes('playoffs_waivers'));
});

void test("the in-season items open the selected league's screens, else the follow page naming it", () => {
	const items = railFor('in_season', false);
	const href = (label: string, id: string | null): string =>
		railHref(items.find((item) => item.label === label) ?? RAIL_FOOT, id);
	const id = '6f1d1c52-2626-4a26-9a26-000000000026';
	assert.equal(href('League', id), `/league/${id}`);
	assert.equal(href('League', null), '/league/new');
	assert.equal(href('Lineup', id), `/league/${id}/start`);
	assert.equal(href('Matchup', id), `/league/${id}/matchup`);
	assert.equal(href('Waivers', id), `/league/${id}/waivers`);
	assert.equal(href('Trades', id), `/league/${id}/trades`);
	assert.equal(href('Lineup', null), `/league/new?${SCREEN_PARAM}=start`);
	assert.equal(href('Trades', null), `/league/new?${SCREEN_PARAM}=trades`);
	// The rest keep their pages, a league or none.
	assert.equal(href('Players', id), '/players');
	assert.equal(href('Rest of season', id), '/board');
});

void test('a page lights the item that owns it, a league page the item it names', () => {
	assert.equal(sectionOf('/board/ppr-12'), 'board');
	assert.equal(sectionOf('/adp/ppr-12'), 'board');
	assert.equal(sectionOf('/players/puka-nacua'), 'players');
	assert.equal(sectionOf('/companion/new'), 'advisor');
	// A league's pages pass their item to the shell (screenSection): no path under /league/ owns one,
	// so the follow page lights nothing of its own.
	assert.equal(sectionOf('/league/abc/start'), null);
	assert.equal(sectionOf('/league/abc'), null);
	assert.equal(sectionOf('/league/new'), null);
	assert.equal(sectionOf('/'), null);
	assert.equal(sectionOf('/pass'), 'account');
});

void test('the shell links every page it can reach, and a section href is its page', () => {
	assert.ok(shellHrefs().includes('/board'));
	assert.ok(shellHrefs().includes('/league/new'));
	assert.ok(shellHrefs().includes('/record'));
	assert.equal(sectionHref('mock'), '/mock/new');
	assert.equal(sectionHref('board'), '/board');
});

void test("a league's screen lights its rail item, and the follow page reads the screen it was sent for", () => {
	assert.equal(screenSection('league'), 'league');
	assert.equal(screenSection('start'), 'lineup');
	assert.equal(screenSection('matchup'), 'matchup');
	assert.equal(screenSection('waivers'), 'waivers');
	assert.equal(screenSection('trades'), 'trades');
	assert.equal(leagueScreenOf('matchup'), 'matchup');
	assert.equal(leagueScreenOf('league'), null);
	assert.equal(leagueScreenOf(null), null);
});

void test('every rail word passes the copy guard', () => {
	for (const item of [...RAIL_ITEMS, RAIL_FOOT]) {
		assert.ok(!BANNED_WORDS.test(item.label), item.label);
		assert.ok(!BANNED_MARKS.test(item.label), item.label);
	}
	assert.ok(RAIL_ITEMS.some((item) => item.label === 'League'));
});
