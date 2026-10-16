/** Each season phase's rail as a list (spec 2026-10-16 §2): the phone's five in order, then what the
 * wide rail adds. Apart from nav.ts, so the shell's script carries only the items: the server
 * builds the rail styles from this (rail-css.ts), and a league's pages read their tabs from it. */
import {
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

/** A rail key's items. */
export function railOfKey(key: RailKey): readonly RailEntry[] {
	return key === 'playoffs_waivers' ? railFor('playoffs', true) : railFor(key, false);
}
