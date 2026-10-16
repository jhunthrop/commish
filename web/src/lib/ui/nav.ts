import type { components } from '#lib/api/types.ts';
import type { RailIconName } from './rail-icons.ts';

type Schemas = components['schemas'];
/** A followed league's place in its season (spec 2026-10-16 §1). */
export type LeaguePhase = Schemas['ContextLeague']['phase'];
/** The site's own season, for a visitor with no league selected. */
export type SitePhase = Schemas['Account']['season']['phase'];

export const LEAGUE_PHASES: readonly LeaguePhase[] = [
	'pre_draft',
	'draft_day',
	'in_season',
	'playoffs',
	'offseason'
];

export type Section =
	| 'board'
	| 'players'
	| 'mock'
	| 'sheet'
	| 'advisor'
	| 'record'
	| 'account'
	| 'lineup'
	| 'matchup'
	| 'waivers'
	| 'trades';

/** A followed league's screen, as its route segment names it: /league/<id>/<screen>. */
export type LeagueScreen = 'start' | 'matchup' | 'waivers' | 'trades';

export interface RailItem {
	/** The item, one word: the shell marks its link with it, and the rail's styles place it. */
	key: string;
	section: Section;
	label: string;
	/** Its page. An item for a league's screen is the follow page here: railHref makes it the
	 * selected league's. */
	href: string;
	icon: RailIconName;
	/** The first path segments of every page the item lights, its own first. */
	owns: readonly string[];
	/** The league screen the item opens, for the selected league. */
	screen?: LeagueScreen;
}

/** An item in a phase's rail, and whether the phone's bottom rail leaves it to the wide rail. */
export interface RailEntry extends RailItem {
	wideOnly: boolean;
}

export const HOME_HREF = '/';

/** Where a mock draft starts: the room's setup. */
const MOCK_SETUP = '/mock/new';
/** The advisor's own page: our call beside your real draft (the live draft companion). */
export const COMPANION_START = '/companion/new' as const;
/** Where a league on another host is attached. */
export const LEAGUE_START = '/league/new' as const;
/** The follow page's search parameter naming the league screen a rail item led there from:
 * `/league/new?screen=start`. */
export const SCREEN_PARAM = 'screen';
/** The anchor of the account page's Your leagues, where every league the account follows is. */
export const LEAGUES_ANCHOR = 'your-leagues';
/** The account page's search parameter for how many leagues were just followed: `?followed=2`. */
export const FOLLOWED_PARAM = 'followed';

/** How many items the phone's bottom rail holds in every phase. */
export const PHONE_RAIL_ITEMS = 5;

const BOARD_OWNS = ['board', 'adp', 'schedule'];

/** An item opening one of the selected league's screens. Its href is the follow page naming the
 * screen, for a visitor with no league (railHref). Signed out in season the rail still shows them:
 * the free followed league is the trust loop (spec §2). */
function screenItem(key: Section & RailIconName, label: string, screen: LeagueScreen): RailItem {
	const href = `${LEAGUE_START}?${SCREEN_PARAM}=${screen}`;
	return { key, section: key, label, href, icon: key, owns: [], screen };
}

const BOARD: RailItem = {
	key: 'board',
	section: 'board',
	label: 'Board',
	href: '/board',
	icon: 'board',
	owns: BOARD_OWNS
};
const MOCK: RailItem = {
	key: 'mock',
	section: 'mock',
	label: 'Mock draft',
	href: MOCK_SETUP,
	icon: 'mock',
	owns: ['mock', 'lobby']
};
const ADVISOR: RailItem = {
	key: 'advisor',
	section: 'advisor',
	label: 'Advisor',
	href: COMPANION_START,
	icon: 'advisor',
	owns: ['advisor', 'companion']
};
const WAIVERS = screenItem('waivers', 'Waivers', 'waivers');

/** Every item any rail holds, in the one order the shell draws them: each phase's rail is a run of
 * this list read top to bottom, and the rail styles (rail-css.ts) show only its own items, so the
 * order a reader tabs through is the order they see, and the page carries one list and no phase
 * table. An item a phase places elsewhere is drawn twice under its own key (the advisor first on
 * draft day, the mock draft after the sheet then, waivers after the board in the playoffs). The
 * board is "Board" before the draft and "Rest of season" once the league plays (spec §2): the same
 * page. A page lights the item whose `owns` holds its first path segment (the board's companions,
 * ADP and schedule strength, light the board), a league's screen the item that opens it. */
export const RAIL_ITEMS: readonly RailItem[] = [
	screenItem('lineup', 'Lineup', 'start'),
	screenItem('matchup', 'Matchup', 'matchup'),
	WAIVERS,
	screenItem('trades', 'Trades', 'trades'),
	{ ...ADVISOR, key: 'advisor_first' },
	BOARD,
	{
		key: 'players',
		section: 'players',
		label: 'Players',
		href: '/players',
		icon: 'players',
		owns: ['players', 'clubs', 'compare']
	},
	MOCK,
	{
		key: 'sheet',
		section: 'sheet',
		label: 'Cheat sheet',
		href: '/sheet',
		icon: 'sheet',
		owns: ['sheet']
	},
	{ ...MOCK, key: 'mock_late' },
	ADVISOR,
	{ ...BOARD, key: 'rest', label: 'Rest of season' },
	{ ...WAIVERS, key: 'waivers_late' },
	{
		key: 'record',
		section: 'record',
		label: 'Our record',
		href: '/record',
		icon: 'record',
		owns: ['record']
	}
];

/** A rail glyph's symbol id in the page's sprite (rail-icons.ts railSprite). */
export function railIconId(name: RailIconName): string {
	return `rail-${name}`;
}

/** Pinned to the foot of the wide rail, apart from the phases' items. */
export const RAIL_FOOT: RailItem = {
	key: 'account',
	section: 'account',
	label: 'Account',
	href: '/account',
	icon: 'account',
	owns: ['account', 'pass', 'claim']
};

/** Each phase's rail, top to bottom: the phone's five in order, then what the wide rail adds above
 * the Account foot (spec §2). Waivers return to the playoffs' wide rail only while the host runs
 * them (railFor). */
const RAIL_ORDER: Readonly<Record<LeaguePhase, readonly string[]>> = {
	pre_draft: ['board', 'players', 'mock', 'sheet', 'advisor', 'record'],
	draft_day: ['advisor_first', 'board', 'players', 'sheet', 'mock_late', 'record'],
	in_season: ['lineup', 'matchup', 'waivers', 'trades', 'players', 'rest', 'record'],
	playoffs: ['lineup', 'matchup', 'trades', 'players', 'rest', 'waivers_late', 'record'],
	offseason: ['board', 'players', 'mock', 'sheet', 'advisor', 'record']
};

function itemNamed(key: string): RailItem {
	const item = RAIL_ITEMS.find((candidate) => candidate.key === key);
	if (!item) throw new Error(`No rail item ${key}.`);
	return item;
}

/** The rail for a phase: the phone's five first, the wide rail's own after them. */
export function railFor(phase: LeaguePhase, waiversOpen: boolean): readonly RailEntry[] {
	const keys = RAIL_ORDER[phase].filter((key) => !(key === 'waivers_late' && !waiversOpen));
	return keys.map((key, i) => ({ ...itemNamed(key), wideOnly: i >= PHONE_RAIL_ITEMS }));
}

/** The rail a visitor sees: a phase, and in the playoffs whether waivers still run. */
export interface RailState {
	phase: LeaguePhase;
	waiversOpen: boolean;
}

/** The rail's phase: the selected league's, else the site's season, preseason read as before the
 * draft. A league from an API before the phase (no phase) reads as the site. */
export function railPhase(
	league: Partial<{ phase: LeaguePhase; waivers_open: boolean }> | null,
	season: SitePhase
): RailState {
	if (league?.phase !== undefined) {
		return { phase: league.phase, waiversOpen: league.waivers_open ?? false };
	}
	return { phase: season === 'preseason' ? 'pre_draft' : season, waiversOpen: false };
}

/** Every rail the shell can show, one word each: the root's `data-rail` names it. */
export const RAIL_KEYS = [...LEAGUE_PHASES, 'playoffs_waivers'] as const;
export type RailKey = (typeof RAIL_KEYS)[number];

export function railKey(state: RailState): RailKey {
	return state.phase === 'playoffs' && state.waiversOpen ? 'playoffs_waivers' : state.phase;
}

/** Whether a word is a rail key: what the boot script and the kept copy are checked against. */
export function isRailKey(word: unknown): word is RailKey {
	return (RAIL_KEYS as readonly unknown[]).includes(word);
}

/** A rail key's items. */
export function railOfKey(key: RailKey): readonly RailEntry[] {
	return key === 'playoffs_waivers' ? railFor('playoffs', true) : railFor(key, false);
}

/** The rail the shell shows before any context is read: the site before its draft. */
export const DEFAULT_RAIL: RailKey = 'pre_draft';

/** Where an item goes: a league's screen for the selected league, the follow page naming it with
 * none, every other item its own page. */
export function railHref(item: RailItem, leagueId: string | null): string {
	if (item.screen === undefined || leagueId === null) return item.href;
	return `/league/${encodeURIComponent(leagueId)}/${item.screen}`;
}

const EVERY_ITEM: readonly RailItem[] = [...RAIL_ITEMS, RAIL_FOOT];

/** The section a path belongs to, or null for a page outside the sections (the front door, a
 * league's own page, the follow page, the system page): its first segment's owner, or under
 * /league/<id>/ the screen's item. */
export function sectionOf(pathname: string): Section | null {
	const [first = '', , screen] = pathname.split('/').filter((segment) => segment !== '');
	const item = EVERY_ITEM.find((candidate) =>
		first === 'league'
			? screen !== undefined && candidate.screen === screen
			: candidate.owns.includes(first)
	);
	return item?.section ?? null;
}

/** The rail item a league's screen lights: Lineup for start, and the rest by their own names. */
export function screenSection(screen: LeagueScreen): Section {
	const item = EVERY_ITEM.find((candidate) => candidate.screen === screen);
	if (!item) throw new Error(`No rail item opens the ${screen} screen.`);
	return item.section;
}

/** The league screen a search parameter names (the follow page's ?screen=), null for any other. */
export function leagueScreenOf(word: string | null): LeagueScreen | null {
	return (
		EVERY_ITEM.find((item) => item.screen !== undefined && item.screen === word)?.screen ?? null
	);
}

/** Every href the shell links to before a league is selected. The mock room's routes arrive with
 * their lane, so until they exist the prerender crawl tolerates a 404 on exactly these paths and
 * fails on any other. A function, so only the build's config reads it and no page carries it. */
export function shellHrefs(): readonly string[] {
	return [...new Set([HOME_HREF, LEAGUE_START, ...EVERY_ITEM.map((item) => item.href)])];
}

/** A section's page, the way a link from another page reaches it: the verb to a mock, the sheet. */
export function sectionHref(section: Section): string {
	const item = EVERY_ITEM.find((candidate) => candidate.section === section);
	if (!item) throw new Error(`No rail item for the ${section} section.`);
	return item.href;
}
