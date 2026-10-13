import type { IconName } from './icons.ts';

export type Section = 'board' | 'players' | 'mock' | 'sheet' | 'advisor' | 'record' | 'account';

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

/** The rail, top to bottom. The phone shows every item not marked wideOnly along the bottom.
 * A page lights the item whose `owns` holds its first path segment: the board's companions (ADP,
 * schedule strength) light Board, the players' (clubs, compare) light Players. The advisor lives in
 * the mock room, so its item opens the room's setup until the advisor has a page of its own. */
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
		href: MOCK_SETUP,
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

/** Pinned to the foot of the rail. */
export const RAIL_FOOT: RailItem = {
	section: 'account',
	label: 'Account',
	href: '/account',
	icon: 'account',
	wideOnly: true,
	owns: ['account', 'pass', 'claim']
};

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
