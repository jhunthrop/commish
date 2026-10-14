import type { IconName } from './icons.ts';

export type Section =
	'board' | 'players' | 'mock' | 'sheet' | 'league' | 'advisor' | 'record' | 'account';

export interface RailItem {
	section: Section;
	label: string;
	href: string;
	icon: IconName;
	/** Kept off the phone's bottom rail, which holds five items. */
	wideOnly: boolean;
	/** The first path segments of every page the item lights, its own first. */
	owns: readonly string[];
}

export const HOME_HREF = '/';

/** Where a mock draft starts: the room's setup. */
const MOCK_SETUP = '/mock/new';
/** The advisor's own page: our call beside your real draft (the live draft companion). */
export const COMPANION_START = '/companion/new' as const;
/** Where a league on another host is attached. */
export const LEAGUE_START = '/league/new' as const;
/** The anchor of the account page's Your leagues, where every league the account follows is. */
export const LEAGUES_ANCHOR = 'your-leagues';
/** Every league the account follows: the account page at Your leagues. */
export const LEAGUES_LIST = `/account#${LEAGUES_ANCHOR}` as const;

/** The rail, top to bottom. The phone shows every item not marked wideOnly along the bottom.
 * A page lights the item whose `owns` holds its first path segment: the board's companions (ADP,
 * schedule strength) light Board, the players' (clubs, compare) light Players. The advisor's item
 * opens its own page, the live draft companion, beside your real draft. */
export const RAIL: readonly RailItem[] = [
	{
		section: 'board',
		label: 'Board',
		href: '/board',
		icon: 'board',
		wideOnly: false,
		owns: ['board', 'adp', 'schedule']
	},
	{
		section: 'players',
		label: 'Players',
		href: '/players',
		icon: 'players',
		wideOnly: false,
		owns: ['players', 'clubs', 'compare']
	},
	{
		section: 'mock',
		label: 'Mock draft',
		href: MOCK_SETUP,
		icon: 'mock',
		wideOnly: false,
		owns: ['mock', 'lobby']
	},
	{
		section: 'sheet',
		label: 'Cheat sheet',
		href: '/sheet',
		icon: 'sheet',
		wideOnly: false,
		owns: ['sheet']
	},
	leagueItem(null),
	{
		section: 'advisor',
		label: 'Advisor',
		href: COMPANION_START,
		icon: 'advisor',
		wideOnly: true,
		owns: ['advisor', 'companion']
	},
	{
		section: 'record',
		label: 'Our record',
		href: '/record',
		icon: 'record',
		wideOnly: true,
		owns: ['record']
	}
];

/** Your league, on the rail for everyone after the cheat sheet: the in-season half of the rail. It
 * opens the account's one league (account/rail-league.svelte.ts), the list of them when it follows
 * more than one, or, with none yet or signed out, the page that attaches one, which signed out leads
 * to sign in. The phone's bar holds five, so League has Our record's place there; Our record stays on
 * the desk's rail. */
export function leagueItem(account: RailAccount | null): RailItem {
	const leagueId = account?.leagueId ?? null;
	let href: string = LEAGUE_START;
	if (leagueId !== null) {
		href =
			(account?.leagueCount ?? 0) > 1 ? LEAGUES_LIST : `/league/${encodeURIComponent(leagueId)}`;
	}
	return {
		section: 'league',
		label: 'League',
		href,
		icon: 'league',
		wideOnly: false,
		owns: ['league']
	};
}

/** A signed-in account as the rail reads it: its newest attached league's id, or null with none,
 * and how many leagues it follows. */
export interface RailAccount {
	leagueId: string | null;
	leagueCount: number;
}

/** The rail, with League opening the account's league, or its leagues, once /me names them. */
export function railItems(account: RailAccount | null): readonly RailItem[] {
	if ((account?.leagueId ?? null) === null) return RAIL;
	return RAIL.map((item) => (item.section === 'league' ? leagueItem(account) : item));
}

/** Pinned to the foot of the rail. */
export const RAIL_FOOT: RailItem = {
	section: 'account',
	label: 'Account',
	href: '/account',
	icon: 'account',
	wideOnly: true,
	owns: ['account', 'pass', 'claim']
};

/** How many items the phone's bottom rail draws from a rail, every item not marked wideOnly. The
 * phone lays its columns from this number, so a tab keeps its place while the rest of the rail is
 * still arriving. */
export function phoneRailCount(items: readonly RailItem[]): number {
	return [...items, RAIL_FOOT].filter((item) => !item.wideOnly).length;
}

/** The section a path belongs to, by the one rule above, or null for a page outside the sections
 * (the front door, the system page). */
export function sectionOf(pathname: string): Section | null {
	const [first = ''] = pathname.split('/').filter((segment) => segment !== '');
	const item = [...RAIL, RAIL_FOOT].find((candidate) => candidate.owns.includes(first));
	return item?.section ?? null;
}

/** Every href the shell links to. The mock room's routes arrive with their lane, so until they
 * exist the prerender crawl tolerates a 404 on exactly these paths and fails on any other. */
export const SHELL_HREFS: readonly string[] = [
	HOME_HREF,
	...RAIL.map((item) => item.href),
	RAIL_FOOT.href
];

/** A section's page, the way a link from another page reaches it: the verb to a mock, the sheet. */
export function sectionHref(section: Section): string {
	const item = [...RAIL, RAIL_FOOT].find((candidate) => candidate.section === section);
	if (!item) throw new Error(`No rail item for the ${section} section.`);
	return item.href;
}
