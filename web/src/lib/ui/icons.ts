/** The icon set, drawn on a 24 grid with a 1.8 stroke in currentColor. Shapes as data, so the
 * Icon component renders them as elements and never as raw markup. The rail's own glyphs are
 * rail-icons.ts, written into the page by the server so no page's script carries them. */

export type IconShape =
	| { tag: 'path'; d: string }
	| { tag: 'circle'; cx: number; cy: number; r: number }
	| { tag: 'rect'; x: number; y: number; width: number; height: number; rx: number };

export const ICONS = {
	/** The league switch's mark. */
	league: [{ tag: 'path', d: 'M5 21V4M5 4h13l-3 4.5L18 13H5' }],
	search: [
		{ tag: 'circle', cx: 11, cy: 11, r: 7 },
		{ tag: 'path', d: 'M20 20l-4-4' }
	],
	/** The handle a row or a tier strip is dragged by. */
	grip: [
		{ tag: 'circle', cx: 9, cy: 6, r: 1.2 },
		{ tag: 'circle', cx: 15, cy: 6, r: 1.2 },
		{ tag: 'circle', cx: 9, cy: 12, r: 1.2 },
		{ tag: 'circle', cx: 15, cy: 12, r: 1.2 },
		{ tag: 'circle', cx: 9, cy: 18, r: 1.2 },
		{ tag: 'circle', cx: 15, cy: 18, r: 1.2 }
	],
	close: [{ tag: 'path', d: 'M6 6l12 12M18 6L6 18' }],
	/** Add him: the board row's sheet control before he is on your sheet. */
	plus: [{ tag: 'path', d: 'M12 5v14M5 12h14' }],
	/** He is on your sheet. */
	check: [{ tag: 'path', d: 'M5 12.5l4.5 4.5L19 7.5' }],
	/** A row that opens: points down, turned up by the row when it is open. */
	chevron: [{ tag: 'path', d: 'M6 9l6 6 6-6' }],
	/** A row holds a note. */
	note: [
		{ tag: 'path', d: 'M5 4h14v12l-4 4H5z' },
		{ tag: 'path', d: 'M15 20v-4h4M8 9h8M8 13h5' }
	],
	/** Tags: a phone row's count of your tags. */
	tag: [
		{ tag: 'path', d: 'M3 12V4h8l10 10-8 8z' },
		{ tag: 'circle', cx: 7.5, cy: 8.5, r: 1.3 }
	],
	/** More actions, folded into a menu. */
	more: [
		{ tag: 'circle', cx: 5, cy: 12, r: 1.4 },
		{ tag: 'circle', cx: 12, cy: 12, r: 1.4 },
		{ tag: 'circle', cx: 19, cy: 12, r: 1.4 }
	]
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
