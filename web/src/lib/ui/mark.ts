/**
 * The Commish mark, the whistle (founder's choice 2026-10-24, docs/design/mocks/2026-10-24-mark/):
 * one continuous outline, a round chamber whose barrel runs flat along the top to a slanted tip, and
 * one accent, the pea. The only place the drawing lives: the shell's Mark.svelte, the favicon
 * (scripts/favicon.ts), the app icons (scripts/app-icons.ts) and the share cards
 * (scripts/share-cards.ts) all draw from here.
 */

/** The box the trace was drawn in. */
export const MARK_BOX = 256;
/** The outline: the barrel's top, the tip, the barrel's underside, and the chamber's circle. */
export const MARK_PATH =
	'M80.7 52.7 L250.4 52.7 L244.7 92.0 L153.5 110.4 L155.8 128.2 A75.1 75.1 0 1 1 80.7 52.7 Z';
/** The pea, the mark's one accent, on the chamber's centre. */
export const MARK_DISC = { cx: 80.7, cy: 128.2, r: 26.6 } as const;
/** The outline's weight where the mark is drawn large. */
export const MARK_STROKE = 11.4;
/** The outline's weight at MARK_SMALL_MAX px and under, where the large weight thins to a hairline. */
export const MARK_SMALL_STROKE = 18.2;
/** The largest rendering, in px, that takes the small weight. */
export const MARK_SMALL_MAX = 40;

/** The chamber's left edge and the tip sit on the box's sides; the view is the box grown by half the
 * heavier weight on every side, so no weight's outline is cut. */
const PAD = MARK_SMALL_STROKE / 2;
/** The side of the square the mark is drawn in, in the trace's units. */
export const MARK_VIEW_SIDE = MARK_BOX + 2 * PAD;
export const MARK_VIEWBOX = `${String(-PAD)} ${String(-PAD)} ${String(MARK_VIEW_SIDE)} ${String(MARK_VIEW_SIDE)}`;

/** The side of the drawing whose trace box (the whistle's length) spans `span` px. */
export function markSizeFor(span: number): number {
	return (span * MARK_VIEW_SIDE) / MARK_BOX;
}

interface MarkColors {
	/** The outline, --ink. */
	ink: string;
	/** The pea, --accent. */
	accent: string;
}

/** The mark's colours: the tokens' (tokens.css, held equal by site/app-manifest.test.ts), for drawings that
 * cannot read a custom property. */
export const MARK_COLORS: Readonly<Record<'light' | 'dark', MarkColors>> = {
	light: { ink: '#15120f', accent: '#c2470a' },
	dark: { ink: '#f5f0ea', accent: '#ff7130' }
};

/** The weight for a rendering `size` px square. */
export function markStroke(size: number): number {
	if (!(size > 0)) throw new Error(`The mark needs a positive size, got ${String(size)}.`);
	return size <= MARK_SMALL_MAX ? MARK_SMALL_STROKE : MARK_STROKE;
}

/** The outline and the pea, each with its own colouring attributes. */
function shapes(outline: string, pea: string, stroke: number): string {
	const { cx, cy, r } = MARK_DISC;
	return (
		`<path${outline} d="${MARK_PATH}" fill="none" stroke-width="${String(stroke)}" stroke-linejoin="round"/>` +
		`<circle${pea} cx="${String(cx)}" cy="${String(cy)}" r="${String(r)}"/>`
	);
}

interface MarkSvgOptions extends MarkColors {
	/** The side of the drawing, in px. */
	size: number;
	/** The outline's weight; the size's own (markStroke) when left out. */
	stroke?: number;
}

/** The mark as a standalone SVG with literal colours, for the scripts that draw it to PNG. */
export function markSvg({ ink, accent, size, stroke = markStroke(size) }: MarkSvgOptions): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="${MARK_VIEWBOX}">${shapes(` stroke="${ink}"`, ` fill="${accent}"`, stroke)}</svg>`;
}

/** The favicon (src/lib/assets/favicon.svg, written by scripts/favicon.ts): the small weight, the
 * light colours, and the dark ones in a media block for a browser in the dark theme. */
export function faviconSvg(): string {
	const { light, dark } = MARK_COLORS;
	const style =
		`.ink{stroke:${light.ink}}.pea{fill:${light.accent}}` +
		`@media (prefers-color-scheme:dark){.ink{stroke:${dark.ink}}.pea{fill:${dark.accent}}}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}"><style>${style}</style>${shapes(' class="ink"', ' class="pea"', MARK_SMALL_STROKE)}</svg>\n`;
}
