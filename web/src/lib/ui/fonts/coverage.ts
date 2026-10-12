/** The characters the core subsets of the UI faces hold: the one list scripts/subset-fonts.ts cuts
 * the fonts from and scripts/check-glyphs.ts holds every rendered player name to. */

type CodePointRange = readonly [first: number, last: number];

/** Basic Latin, Latin-1 Supplement and Latin Extended-A (spec §2.1). The C1 controls at
 * U+0080 to U+009F have no glyphs, so Latin-1 starts at the no-break space. */
const BLOCKS: readonly CodePointRange[] = [
	[0x0020, 0x007e],
	[0x00a0, 0x017f]
];

/** Beyond the blocks: curly quotes, the ellipsis, the true minus and the arrows in the keys legend. */
const EXTRAS = '‘’“”…−←↑→↓';

function codePoints(characters: string): number[] {
	return Array.from(characters, (c) => c.codePointAt(0)).filter(
		(point): point is number => point !== undefined
	);
}

const COVERED: ReadonlySet<number> = new Set([
	...BLOCKS.flatMap(([first, last]) =>
		Array.from({ length: last - first + 1 }, (_, i) => first + i)
	),
	...codePoints(EXTRAS)
]);

export const CORE_CHARACTERS: string = String.fromCodePoint(...COVERED);

export interface UncoveredGlyph {
	glyph: string;
	codePoint: string;
	text: string;
}

function hex(point: number): string {
	return point.toString(16).toUpperCase().padStart(4, '0');
}

/** The covered set as a CSS unicode-range: "U+0020-007E, U+00A0-017F, ...". */
export function coreUnicodeRange(): string {
	const ranges: [number, number][] = [];
	for (const point of [...COVERED].sort((a, b) => a - b)) {
		const last = ranges.at(-1);
		if (last && point === last[1] + 1) last[1] = point;
		else ranges.push([point, point]);
	}
	return ranges
		.map(([from, to]) => (from === to ? `U+${hex(from)}` : `U+${hex(from)}-${hex(to)}`))
		.join(', ');
}

/** The first character in these texts that the core subsets cannot draw, or null when all are covered. */
export function firstUncoveredGlyph(texts: Iterable<string>): UncoveredGlyph | null {
	for (const text of texts) {
		for (const point of codePoints(text)) {
			if (!COVERED.has(point)) {
				return { glyph: String.fromCodePoint(point), codePoint: `U+${hex(point)}`, text };
			}
		}
	}
	return null;
}
