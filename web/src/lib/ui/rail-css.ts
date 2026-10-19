/** The rail's place in every season phase as styles (spec 2026-10-16 §2): the shell draws every
 * item in one order every rail follows (nav.ts RAIL_ITEMS), and these rules show the root's rail
 * (`data-rail`, written by the build on a prerendered page and set by the boot script before the
 * first paint), the phone's five along the bottom; a page drawn at request time whose boot never
 * runs shows the default. Built from railFor on the server and put in every page's head
 * (server/page-chunk.ts), so the phase table never ships in a page's script and the rail is right
 * on the first frame. The same mechanism shows a page's words: a page that follows the season draws
 * both sets (Phased.svelte) and the root's rail turns one on, so the words change with the rail
 * and never after the page's script runs. */
import { LEAGUE_ATTR } from '#lib/context/boot.ts';
import { DEFAULT_RAIL, RAIL_KEYS, railInSeason, wordSetOf, type RailKey } from './nav.ts';
import { RAIL_WITHOUT_LEAGUE, railOfKey, type RailEntry } from './rail-order.ts';

/** The shell's phone width, where the rail becomes the bottom bar: Shell.svelte's media query. */
export const PHONE_MAX_PX = 760;

/** Every link of the rail's phase items is hidden until the root's rail shows it. */
const HIDDEN = '.rail .item[data-k]{display:none}';
/** Every set of page words is hidden until the root's rail shows it. */
const WORDS_HIDDEN = '[data-words]{display:none}';

function roots(key: string): string[] {
	const named = `:root[data-rail=${key}]`;
	return key === DEFAULT_RAIL ? [named, ':root:not([data-rail])'] : [named];
}

/** A root that names a league selected, and one that names none (the context's data-league). */
const WITH_LEAGUE = `[${LEAGUE_ATTR}]`;
const WITHOUT_LEAGUE = `:not([${LEAGUE_ATTR}])`;

/** Each rail a root can show and the items it shows: a season rail shows its league's pages only
 * with a league selected, and the rail without a league otherwise (Lane 83). */
function railsShown(key: RailKey): [string[], readonly RailEntry[]][] {
	if (!railInSeason(key)) return [[roots(key), railOfKey(key)]];
	const withLeague = roots(key).map((root) => `${root}${WITH_LEAGUE}`);
	const withoutLeague = roots(key).map((root) => `${root}${WITHOUT_LEAGUE}`);
	return [
		[withLeague, railOfKey(key)],
		[withoutLeague, RAIL_WITHOUT_LEAGUE]
	];
}

export function railCss(): string {
	const shown: string[] = [];
	const wideOnly: string[] = [];
	for (const key of RAIL_KEYS) {
		for (const [shownRoots, rail] of railsShown(key)) {
			for (const entry of rail) {
				for (const root of shownRoots) {
					const selector = `${root} .rail .item[data-k=${entry.key}]`;
					shown.push(selector);
					if (entry.wideOnly) wideOnly.push(selector);
				}
			}
		}
	}
	const phone = `@media (max-width:${String(PHONE_MAX_PX)}px){${wideOnly.join(',')}{display:none}}`;
	return `${HIDDEN}${shown.join(',')}{display:flex}${wordsCss()}${phone}`;
}

/** The words each rail shows: a wrapper that adds no box of its own (`contents`), so the words sit
 * where the unwrapped page would put them. */
function wordsCss(): string {
	const shown = RAIL_KEYS.flatMap((key) =>
		roots(key).map((root) => `${root} [data-words=${wordSetOf(key)}]`)
	);
	return `${WORDS_HIDDEN}${shown.join(',')}{display:contents}`;
}
