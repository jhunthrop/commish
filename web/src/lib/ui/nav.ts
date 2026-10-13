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
		wideOnly: false,
		owns: ['record']
	}
];

/** Your league, shown to a signed-in account (account/rail-league.svelte.ts), after the cheat
 * sheet: the in-season half of the rail. It opens the account's newest league, or, with none yet,
 * the page that attaches one. */
export function leagueItem(leagueId: string | null): RailItem {
	return {
		section: 'league',
		label: 'League',
		href: leagueId === null ? LEAGUE_START : `/league/${encodeURIComponent(leagueId)}`,
		icon: 'league',
		wideOnly: false,
		owns: ['league']
	};
}

/** The rail with League in its place for a signed-in account, null signed out. The phone's bar holds
 * five, so League takes Our record's place there; Our record stays on the desk's rail. */
export function railItems(account: { leagueId: string | null } | null): readonly RailItem[] {
	if (account === null) return RAIL;
	const { leagueId } = account;
	const at = RAIL.findIndex((item) => item.section === 'sheet') + 1;
	const rest = RAIL.slice(at).map((item) =>
		item.section === 'record' ? { ...item, wideOnly: true } : item
	);
	return [...RAIL.slice(0, at), leagueItem(leagueId), ...rest];
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
 * still arriving. With League in the rail it takes Our record's place, so the count holds. */
export function phoneRailCount(items: readonly RailItem[]): number {
	return [...items, RAIL_FOOT].filter((item) => !item.wideOnly).length;
}

/** The section a path belongs to, by the one rule above, or null for a page outside the sections
 * (the front door, the system page). */
export function sectionOf(pathname: string): Section | null {
	const [first = ''] = pathname.split('/').filter((segment) => segment !== '');
	if (first === 'league') return 'league';
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
