/** The rail's glyphs, in the icon set's style (icons.ts: a 24 grid, a 1.8 stroke in currentColor).
 * Only the shell draws them, so they are not in a page's script: the server writes them once into
 * every page as an inline SVG sprite (railSprite), and the rail's links point at their symbols
 * (RailIcon, by nav.ts railIconId). Only the server, the tests and the system page import this
 * module. Shapes as data, so markup is written from them and never pasted. */
import type { IconShape } from './icons.ts';
import { railIconId } from './nav.ts';

export const RAIL_ICONS = {
	board: [{ tag: 'path', d: 'M4 5h16M4 10h16M4 15h10M4 20h7' }],
	players: [
		{ tag: 'circle', cx: 12, cy: 8, r: 4 },
		{ tag: 'path', d: 'M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6' }
	],
	mock: [
		{ tag: 'rect', x: 3, y: 4, width: 18, height: 16, rx: 2 },
		{ tag: 'path', d: 'M3 10h18M9 4v16M15 4v16' }
	],
	sheet: [
		{ tag: 'path', d: 'M6 3h9l4 4v14H6z' },
		{ tag: 'path', d: 'M15 3v4h4M9 12h7M9 16h5' }
	],
	advisor: [
		{ tag: 'circle', cx: 12, cy: 12, r: 9 },
		{ tag: 'path', d: 'M12 7v5l3 2' }
	],
	record: [{ tag: 'path', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }],
	/** Your league's own page, its standings first: a trophy. Apart from the switch's flag (icons.ts
	 * league), which names the league chosen. */
	standings: [
		{ tag: 'path', d: 'M7 4h10v5a5 5 0 0 1-10 0z' },
		{ tag: 'path', d: 'M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v3M8 20h8M9.5 17h5' }
	],
	/** Your lineup for the week: a jersey. */
	lineup: [{ tag: 'path', d: 'M9 3.5 4 6l1.8 4 2.2-.9V20h8V9.1l2.2.9L20 6l-5-2.5a3 3 0 0 1-6 0z' }],
	/** This week's game: two teams face to face. */
	matchup: [
		{ tag: 'circle', cx: 7, cy: 9, r: 3 },
		{ tag: 'circle', cx: 17, cy: 9, r: 3 },
		{ tag: 'path', d: 'M3 20c0-3 1.8-5 4-5s4 2 4 5M13 20c0-3 1.8-5 4-5s4 2 4 5' }
	],
	/** Waiver adds: a player with a plus. */
	waivers: [
		{ tag: 'circle', cx: 9, cy: 8, r: 3.5 },
		{ tag: 'path', d: 'M3 20c1-3.5 3.3-5.5 6-5.5s5 2 6 5.5M18 7v6M15 10h6' }
	],
	/** Trades: two arrows passing. */
	trades: [{ tag: 'path', d: 'M4 8h15l-3.5-3.5M20 16H5l3.5 3.5' }],
	account: [
		{ tag: 'circle', cx: 12, cy: 12, r: 9 },
		{ tag: 'circle', cx: 12, cy: 10, r: 3 },
		{ tag: 'path', d: 'M6.5 18c1.5-2 3.4-3 5.5-3s4 1 5.5 3' }
	]
} as const satisfies Record<string, readonly IconShape[]>;

export type RailIconName = keyof typeof RAIL_ICONS;
/** Every rail glyph's name. A function, so a page that draws a glyph by name carries no shapes. */
export function railIconNames(): RailIconName[] {
	return Object.keys(RAIL_ICONS) as RailIconName[];
}

/** One shape as an SVG element. */
function shapeMarkup(shape: IconShape): string {
	const { tag, ...attrs } = shape;
	const pairs = Object.entries(attrs).map(([name, value]) => `${name}="${String(value)}"`);
	return `<${tag} ${pairs.join(' ')}/>`;
}

/** Every rail glyph as a symbol, in one hidden SVG at the top of the page's body. */
export function railSprite(): string {
	const symbols = railIconNames().map(
		(name) =>
			`<symbol id="${railIconId(name)}" viewBox="0 0 24 24">${RAIL_ICONS[name].map(shapeMarkup).join('')}</symbol>`
	);
	return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:none">${symbols.join('')}</svg>`;
}
