import type { components } from '#lib/api/types.ts';
import type { RailIconName } from './rail-icons.ts';
import { SHELL } from './shell-words.ts';

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
	| 'league'
	| 'lineup'
	| 'matchup'
	| 'waivers'
	| 'trades';

/** A followed league's screen, as its route segment names it: /league/<id>/<screen>. */
export type LeagueScreen = 'start' | 'matchup' | 'waivers' | 'trades';
/** A followed league's own page (/league/<id>: standings, roster, moves, pool). */
export const LEAGUE_HOME = 'league';
/** A followed league's pages: its own page and its screens. */
export type LeaguePage = typeof LEAGUE_HOME | LeagueScreen;

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
	/** The league's page the item opens, for the selected league. */
	screen?: LeaguePage;
}

export const HOME_HREF = '/';

/** The board's name once the league plays: the bar's word and the rail's with no league selected. */
export const REST_OF_SEASON = 'Rest of season';
/** The rail's item for the board with a league selected, apart from Players (Lane 104, B40): our
 * order in your league's view. */
export const REST_IN_YOUR_LEAGUE = `${REST_OF_SEASON}, your league`;

/** The week's order (Lane 140, C19; Lane 142): in season the Players page under the week's name, on
 * every season rail, a league followed or not. Its label is built with the page (run/week-names.ts),
 * so no page's script carries it. */
export const WEEK_RANKINGS_KEY = 'week';
/** The page's name with no week named (before the first kickoff, or while the season has not
 * answered), the Players item's label and the week item's until a week is known, so the label never
 * promises a page it does not open (Lane 142 fix round 1). The word table's root (run/week-names.ts). */
export const PLAYERS_NAME = 'Players';
/** The page's name in season (run/week-names.ts), and the rail's on a page the Worker draws once the
 * context names a week. Never "Week 7 rankings": the page orders by our rest-of-season total, and no
 * week-by-week order of ours exists to name (Lane 164, D11). */
export const RANKINGS_NAME = 'Rankings';
/** The week item's label while the season is read (Shell's held, Lane 143 fix round 1), never drawn:
 * the longer of the item's two names, so its room at any width is the room the named label takes and
 * nothing below moves when it lands (run/week-names.test.ts proves it the longer). */
export const HELD_WEEK_LABEL = RANKINGS_NAME;

/** Where a mock draft starts: the room's setup. */
export const MOCK_SETUP = '/mock/new' as const;
/** The verb to a mock draft, wherever a page offers one: the season's pages and the league's. */
export const MOCK_VERB = 'Start a mock draft';
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

/** The selected league's own page, leading its screens; the follow page for a visitor with none. Its
 * glyph is the standings' trophy, apart from the switch's flag. */
const LEAGUE_ITEM: RailItem = {
	key: 'league',
	section: 'league',
	label: 'League',
	href: LEAGUE_START,
	icon: 'standings',
	owns: [],
	screen: LEAGUE_HOME
};

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

/** Every item any rail holds, in the one order the shell draws them: each phase's rail is a run of
 * this list read top to bottom, and the rail styles (rail-css.ts) show only its own items, so the
 * order a reader tabs through is the order they see, and the page carries one list and no phase
 * table. An item a phase places elsewhere is drawn twice under its own key (the advisor first on
 * draft day, the mock draft after the sheet then). The board is "Board" before the draft and "Rest
 * of season" once the league plays (spec §2): the same page. A page lights the item whose `owns`
 * holds its first path segment (the board's companions, ADP and schedule strength, light the
 * board), a league's page the item that opens it. The league's own page leads its screens: the rail
 * is the one way between them (Lane 66r). */
export const RAIL_ITEMS: readonly RailItem[] = [
	LEAGUE_ITEM,
	screenItem('lineup', 'Lineup', 'start'),
	screenItem('matchup', 'Matchup', 'matchup'),
	screenItem('waivers', 'Waivers', 'waivers'),
	screenItem('trades', 'Trades', 'trades'),
	// The season's rail with no league selected puts the board after League (rail-order.ts, Lane 83).
	{ ...BOARD, key: 'rest_first', label: REST_OF_SEASON },
	{ ...ADVISOR, key: 'advisor_first' },
	BOARD,
	// The week's order, on every season rail (rail-order.ts): Players, our order with the week's Proj
	// and game beside each player, named for the week in season. Players' glyph and Players' section,
	// so the page lights it and it never wears Lineup's glyph beside Lineup (Lane 142).
	{
		key: WEEK_RANKINGS_KEY,
		section: 'players',
		label: PLAYERS_NAME,
		href: '/players',
		icon: 'players',
		owns: []
	},
	{
		key: 'players',
		section: 'players',
		label: PLAYERS_NAME,
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
	{ ...BOARD, key: 'rest', label: REST_IN_YOUR_LEAGUE },
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
	label: SHELL.account,
	href: '/account',
	icon: 'account',
	owns: ['account', 'pass']
};

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

/** Whether a rail is the season's: the rails that hold the in-season screens. */
export function railInSeason(rail: RailKey): boolean {
	return rail === 'in_season' || rail.startsWith('playoffs');
}

/** The rail the shell shows before any context is read: the site before its draft. */
export const DEFAULT_RAIL: RailKey = 'pre_draft';

/** The two sets of words a page that follows the season draws, each shown by the root's rail: the
 * draft's (before the draft and after the season) and the season's (rail-css.ts). */
export const WORD_SETS = ['draft', 'season'] as const;
export type WordSet = (typeof WORD_SETS)[number];

export function wordSetOf(rail: RailKey): WordSet {
	return railInSeason(rail) ? 'season' : 'draft';
}

/** A rail that stands for each set: the words of every rail in a set are the same. */
export const RAIL_OF_WORD_SET: Readonly<Record<WordSet, RailKey>> = {
	draft: DEFAULT_RAIL,
	season: 'in_season'
};

/** The member's every-league Lineup (Lane 257). */
export const EVERY_LINEUP = '/league';

/** Where an item goes: a league's page for the selected league, the follow page with none, every
 * other item its own page; Lineup, off a league's page for an account with more than one league,
 * the every-league Lineup (Lane 257). */
export function railHref(item: RailItem, leagueId: string | null, every = false): string {
	if (every && item.screen === 'start') return EVERY_LINEUP;
	if (item.screen === undefined || leagueId === null) return item.href;
	const screen = item.screen === LEAGUE_HOME ? '' : `/${item.screen}`;
	return `/league/${encodeURIComponent(leagueId)}${screen}`;
}

const EVERY_ITEM: readonly RailItem[] = [...RAIL_ITEMS, RAIL_FOOT];

/** The section a path belongs to, or null for a page outside the sections (the front door, the
 * system page): its first segment's owner. A league's pages (/league/...) name their item
 * themselves (rail-league.ts screenSection), so none is read from the path. */
export function sectionOf(pathname: string): Section | null {
	const [first = ''] = pathname.split('/').filter((segment) => segment !== '');
	return EVERY_ITEM.find((candidate) => candidate.owns.includes(first))?.section ?? null;
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
