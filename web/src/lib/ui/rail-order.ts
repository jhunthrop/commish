/** Each season phase's rail as a list (spec 2026-10-16 §2): the phone's five in order, then what the
 * wide rail adds. Apart from nav.ts, so the shell's script carries only the items: the server
 * builds the rail styles from this (rail-css.ts), and a league's pages read their screens from it. */
import {
	PHONE_RAIL_ITEMS,
	RAIL_ITEMS,
	railInSeason,
	type LeaguePhase,
	type RailItem,
	type RailKey
} from './nav.ts';

/** An item in a phase's rail, and whether the phone's bottom rail leaves it to the wide rail. */
export interface RailEntry extends RailItem {
	wideOnly: boolean;
}

/** The league's pages, in season and in the playoffs: the rail is the one way between them, so the
 * phone's five are these (Lane 66r). */
const LEAGUE_PAGES = ['league', 'lineup', 'matchup', 'waivers', 'trades'];

/** Each phase's rail, top to bottom: the phone's five in order, then what the wide rail adds above
 * the Account foot (spec §2). In the playoffs Waivers stay only while the host runs them (railFor). */
const RAIL_ORDER: Readonly<Record<LeaguePhase, readonly string[]>> = {
	pre_draft: ['board', 'players', 'mock', 'sheet', 'advisor', 'record'],
	draft_day: ['advisor_first', 'board', 'players', 'sheet', 'mock_late', 'record'],
	in_season: [...LEAGUE_PAGES, 'players', 'rest', 'record'],
	playoffs: [...LEAGUE_PAGES, 'players', 'rest', 'record'],
	offseason: ['board', 'players', 'mock', 'sheet', 'advisor', 'record']
};

function itemNamed(key: string): RailItem {
	const item = RAIL_ITEMS.find((candidate) => candidate.key === key);
	if (!item) throw new Error(`No rail item ${key}.`);
	return item;
}

function entries(keys: readonly string[]): readonly RailEntry[] {
	return keys.map((key, i) => ({ ...itemNamed(key), wideOnly: i >= PHONE_RAIL_ITEMS }));
}

/** The rail for a phase: the phone's five first, the wide rail's own after them. */
export function railFor(phase: LeaguePhase, waiversOpen: boolean): readonly RailEntry[] {
	const closed = phase === 'playoffs' && !waiversOpen;
	return entries(RAIL_ORDER[phase].filter((key) => !(closed && key === 'waivers')));
}

/** The season's rail with no league selected (signed out, or none followed; Lane 83, amending spec
 * 2026-10-16 §2): League, the follow page's one door, then the season's own pages and the mock room,
 * all on the phone's five. Lineup, Matchup, Waivers and Trades could only lead to the follow page,
 * so they are not drawn. The rail styles show it on a season rail whose root names no league. */
export const RAIL_WITHOUT_LEAGUE: readonly RailEntry[] = entries([
	'league',
	'rest_first',
	'players',
	'mock',
	'record'
]);

/** A rail key's items. */
export function railOfKey(key: RailKey): readonly RailEntry[] {
	return key === 'playoffs_waivers' ? railFor('playoffs', true) : railFor(key, false);
}

/** The items a root shows (rail-css.ts): its rail key's, or on a season rail whose root names no
 * league the rail without a league (Lane 83). The shots read it to say what each page must show. */
export function railShown(key: RailKey, league: boolean): readonly RailEntry[] {
	return !league && railInSeason(key) ? RAIL_WITHOUT_LEAGUE : railOfKey(key);
}
