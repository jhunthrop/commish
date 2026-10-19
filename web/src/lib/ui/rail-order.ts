/** Each season phase's rail as a list (spec 2026-10-16 §2): the phone's five in order, then what the
 * wide rail adds. Apart from nav.ts, so the shell's script carries only the items: the server
 * builds the rail styles from this (rail-css.ts), and a league's pages read their screens from it. */
import {
	NO_LEAGUE_RAIL,
	PHONE_RAIL_ITEMS,
	RAIL_ITEMS,
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

/** The season's rail with no league selected (nav.ts NO_LEAGUE_RAIL): League, the follow page's
 * one door, then the season's own pages and the mock room, all on the phone's five. */
const NO_LEAGUE_ORDER: readonly string[] = ['league', 'rest_first', 'players', 'mock', 'record'];

function itemNamed(key: string): RailItem {
	const item = RAIL_ITEMS.find((candidate) => candidate.key === key);
	if (!item) throw new Error(`No rail item ${key}.`);
	return item;
}

function entries(keys: readonly string[]): readonly RailEntry[] {
	return keys.map((key, i) => ({ ...itemNamed(key), wideOnly: i >= PHONE_RAIL_ITEMS }));
}

/** The rail for a selected league's phase: the phone's five first, the wide rail's own after them. */
export function railFor(phase: LeaguePhase, waiversOpen: boolean): readonly RailEntry[] {
	const closed = phase === 'playoffs' && !waiversOpen;
	return entries(RAIL_ORDER[phase].filter((key) => !(closed && key === 'waivers')));
}

/** A rail key's items. */
export function railOfKey(key: RailKey): readonly RailEntry[] {
	if (key === NO_LEAGUE_RAIL) return entries(NO_LEAGUE_ORDER);
	return key === 'playoffs_waivers' ? railFor('playoffs', true) : railFor(key, false);
}
