/** The rail's place in every season phase as styles (spec 2026-10-16 §2): the shell draws every
 * item in one order every rail follows (nav.ts RAIL_ITEMS), and these rules show the root's rail
 * (`data-rail`, set by the boot script before the first paint), the phone's five along the bottom. Built from
 * railFor on the server and put in every page's head by hooks.server.ts, so the phase table never
 * ships in a page's script and the rail is right on the first frame. */
import { DEFAULT_RAIL, RAIL_KEYS, railOfKey } from './nav.ts';

/** The shell's phone width, where the rail becomes the bottom bar: Shell.svelte's media query. */
export const PHONE_MAX_PX = 760;

/** Every link of the rail's phase items is hidden until the root's rail shows it. */
const HIDDEN = '.rail .item[data-k]{display:none}';

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
	return `${HIDDEN}${shown.join(',')}{display:flex}${phone}`;
}
