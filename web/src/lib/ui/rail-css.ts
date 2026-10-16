/** The rail's place in every season phase as styles (spec 2026-10-16 §2): the shell draws every
 * item in one order every rail follows (nav.ts RAIL_ITEMS), and these rules show the root's rail
 * (`data-rail`, written by the build on a prerendered page and set by the boot script before the
 * first paint), the phone's five along the bottom; a page drawn at request time whose boot never
 * runs shows the default. Built from railFor on the server and put in every page's head
 * (server/page-chunk.ts), so the phase table never ships in a page's script and the rail is right
 * on the first frame. The same mechanism shows a page's words: a page that follows the season draws
 * both sets (Phased.svelte) and the root's rail turns one on, so the words change with the rail
 * and never after the page's script runs. */
import { DEFAULT_RAIL, RAIL_KEYS, wordSetOf } from './nav.ts';
import { railOfKey } from './rail-order.ts';

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

export function railCss(): string {
	const shown: string[] = [];
	const wideOnly: string[] = [];
	for (const key of RAIL_KEYS) {
		for (const entry of railOfKey(key)) {
			for (const root of roots(key)) {
				const selector = `${root} .rail .item[data-k=${entry.key}]`;
				shown.push(selector);
				if (entry.wideOnly) wideOnly.push(selector);
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
