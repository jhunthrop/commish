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
	EVERY_LINEUP,
	type RailItem,
	railKey,
	railPhase,
	sectionHref,
	sectionOf,
	type LeaguePhase
} from './nav.ts';
import { leagueScreenOf, screenSection } from './rail-league.ts';
import { BANNED_MARKS, BANNED_WORDS } from '#lib/format/copy-guard.ts';
import { railFor, railShown, type RailEntry } from './rail-order.ts';
import { siteRailAt } from '#lib/run/site-season.ts';

const labels = (items: readonly RailEntry[]): string[] => items.map((item) => item.label);
const phone = (items: readonly RailEntry[]): string[] =>
	labels(items.filter((item) => !item.wideOnly));
const wide = (items: readonly RailEntry[]): string[] =>
	labels(items.filter((item) => item.wideOnly));

/** §2's table: the phone's five in order, then what the wide rail adds above the Account foot. */
/** In season Players is the week's rankings on every rail, a league followed or not (Lane 142); its
 * label is Players until a week is named (fix round 1). */
const WEEK_ITEM = 'Players';

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
		wide: [WEEK_ITEM, 'Rest of season, your league', 'Our record']
	},
	playoffs: {
		phone: ['League', 'Lineup', 'Matchup', 'Trades', WEEK_ITEM],
		wide: ['Rest of season, your league', 'Our record']
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
		waiversOpen: true
	});
	assert.deepEqual(railPhase(null, 'preseason'), { phase: 'pre_draft', waiversOpen: false });
	assert.deepEqual(railPhase(null, 'playoffs'), { phase: 'playoffs', waiversOpen: false });
	assert.deepEqual(railPhase(null, 'offseason'), { phase: 'offseason', waiversOpen: false });
	// An API from before the phase answers none: the site season stands.
	assert.deepEqual(railPhase({}, 'in_season'), { phase: 'in_season', waiversOpen: false });
	assert.equal(railKey({ phase: 'playoffs', waiversOpen: true }), 'playoffs_waivers');
	assert.equal(railKey({ phase: 'playoffs', waiversOpen: false }), 'playoffs');
	assert.equal(railKey({ phase: 'in_season', waiversOpen: true }), 'in_season');
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
	assert.equal(href(WEEK_ITEM, id), '/players');
	assert.equal(href('Rest of season, your league', id), '/board');
});

void test("Lineup opens every league's Lineup for an account with more than one, off a league's page", () => {
	const items = railFor('in_season', false);
	const item = (label: string): RailItem => {
		const found = items.find((candidate) => candidate.label === label);
		assert.ok(found, label);
		return found;
	};
	const id = '6f1d1c52-2626-4a26-9a26-000000000026';
	assert.equal(railHref(item('Lineup'), id, true), EVERY_LINEUP);
	assert.equal(railHref(item('Lineup'), null, true), EVERY_LINEUP);
	// Every other item keeps its league's page.
	assert.equal(railHref(item('Matchup'), id, true), `/league/${id}/matchup`);
	assert.equal(railHref(item('League'), id, true), `/league/${id}`);
	assert.equal(railHref(item('Lineup'), id), `/league/${id}/start`);
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

void test("the Advisor, a draft-day tool, is off the site's rail in season and back from the offseason, by the week names' clock rule (Lane 150)", () => {
	// A season of two game days: week 1's kickoff and the last regular-season game (site-season.ts).
	const kickoffs = ['2026-09-10T00:20:00Z', '2027-01-03T18:00:00Z'];
	const advisorOn = (now: string, league: boolean): boolean =>
		railShown(siteRailAt(new Date(now), kickoffs), league).some(
			(item) => item.section === 'advisor'
		);
	for (const league of [false, true]) {
		assert.equal(advisorOn('2026-08-20T12:00:00Z', league), true, 'preseason');
		assert.equal(advisorOn('2026-10-22T16:00:00Z', league), false, 'week 7');
		assert.equal(advisorOn('2027-01-20T16:00:00Z', league), false, 'the NFL playoffs');
		assert.equal(advisorOn('2027-03-01T16:00:00Z', league), true, 'the offseason');
	}
});
