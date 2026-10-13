/** The rail icon set, drawn on a 24 grid with a 1.8 stroke in currentColor. Shapes as data,
 * so the Icon component renders them as elements and never as raw markup. */

export type IconShape =
	| { tag: 'path'; d: string }
	| { tag: 'circle'; cx: number; cy: number; r: number }
	| { tag: 'rect'; x: number; y: number; width: number; height: number; rx: number };

export const ICONS = {
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
	account: [
		{ tag: 'circle', cx: 12, cy: 12, r: 9 },
		{ tag: 'circle', cx: 12, cy: 10, r: 3 },
		{ tag: 'path', d: 'M6.5 18c1.5-2 3.4-3 5.5-3s4 1 5.5 3' }
	],
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
	check: [{ tag: 'path', d: 'M5 12.5l4.5 4.5L19 7.5' }]
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
