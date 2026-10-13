import type { IconName } from './icons.ts';

export type Section = 'board' | 'players' | 'mock' | 'sheet' | 'advisor' | 'record' | 'account';

export interface RailItem {
	section: Section;
	label: string;
	href: string;
	icon: IconName;
	/** Kept off the phone's bottom rail, which holds four items. */
	wideOnly: boolean;
}

export const HOME_HREF = '/';

/** The rail, top to bottom. The phone shows the first four along the bottom. */
export const RAIL: readonly RailItem[] = [
	{ section: 'board', label: 'Board', href: '/board', icon: 'board', wideOnly: false },
	{ section: 'players', label: 'Players', href: '/players', icon: 'players', wideOnly: false },
	{ section: 'mock', label: 'Mock draft', href: '/mock', icon: 'mock', wideOnly: false },
	{ section: 'sheet', label: 'Cheat sheet', href: '/sheet', icon: 'sheet', wideOnly: false },
	{ section: 'advisor', label: 'Advisor', href: '/advisor', icon: 'advisor', wideOnly: true },
	{ section: 'record', label: 'Our record', href: '/record', icon: 'record', wideOnly: true }
];

/** Pinned to the foot of the rail. */
export const RAIL_FOOT: RailItem = {
	section: 'account',
	label: 'Account',
	href: '/account',
	icon: 'account',
	wideOnly: true
};

/** Every href the shell links to. Lanes 5 to 8 build these routes. Until each exists, the
 * prerender crawl tolerates a 404 on exactly these paths and fails on any other. */
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
