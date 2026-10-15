// Cuts the two UI faces down to Basic Latin, Latin-1 Supplement and Latin Extended-A (the list in
// src/lib/ui/fonts/coverage.ts, which the build's glyph guard also reads), and writes the subset files
// and the @font-face rules that name them from that one list, so the two never drift. Characters
// outside the list fall through to the full Latin and Latin Extended faces in ui.css, which load only
// when a page needs them, and the build guard fails before a player name ever does that.
// It also writes a metric-matched fallback for each web face (Outfit, Big Shoulders Display,
// Newsreader): a local system face with size-adjust and ascent, descent and line-gap overrides
// computed from the font files, so the swap from the fallback to the web face moves nothing.
// It also writes steady.css: the core Outfit file again as 'Outfit Steady' with font-display
// optional, a face that never swaps after the first paint, for long text in a page's first screen
// (the /data page's credits). Only a route that needs it imports it, so no other page carries it.
// Usage: npm run fonts. Commit the output.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { entireMetricsCollection } from '@capsizecss/metrics/entireMetricsCollection';
import { fromBuffer, type Font } from '@capsizecss/unpack';
import subsetFont from 'subset-font';
import { CORE_CHARACTERS, coreUnicodeRange } from '../src/lib/ui/fonts/coverage.ts';

interface WeightRange {
	min: number;
	max: number;
}

interface UiFace {
	family: string;
	package: string;
	source: string;
	file: string;
	weight: WeightRange;
	clamp: boolean;
}

const SOURCE = new URL('../node_modules/@fontsource-variable/', import.meta.url);
const OUT_DIR = new URL('../src/lib/ui/fonts/core/', import.meta.url);
const CSS_OUT = new URL('../src/lib/ui/fonts/ui.css', import.meta.url);
const STEADY_OUT = new URL('../src/lib/ui/fonts/steady.css', import.meta.url);
/** The face that never swaps: its family name is the one tokens.css's --font-ui-steady names. */
const STEADY = { family: 'Outfit Steady', face: 'Outfit' } as const;
/** Fontsource's Latin and Latin Extended ranges, for the characters the core subset does not hold. */
const LATIN_RANGE =
	'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT_RANGE =
	'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

/** The weight axis is kept to the weights the design system sets (the mock's Google Fonts request:
 * Outfit 400 to 700, Big Shoulders Display 500 to 800) where clamping makes the file smaller.
 * Clamping Outfit's axis grows the file, so it keeps its full axis. */
const FACES: readonly UiFace[] = [
	{
		family: 'Outfit',
		package: 'outfit',
		source: 'outfit/files/outfit-latin-wght-normal.woff2',
		file: 'outfit-core.woff2',
		weight: { min: 100, max: 900 },
		clamp: false
	},
	{
		family: 'Big Shoulders Display',
		package: 'big-shoulders-display',
		source: 'big-shoulders-display/files/big-shoulders-display-latin-wght-normal.woff2',
		file: 'big-shoulders-display-core.woff2',
		weight: { min: 500, max: 800 },
		clamp: true
	}
];

/** A web face and the local face that stands in for it until it loads. */
interface Fallback {
	family: string;
	/** The web face's Latin file, the one its metrics are read from. */
	source: string;
	/** The local faces with the stand-in's metrics, first found wins. */
	local: readonly string[];
	/** The stand-in's metrics, by capsize's name for it. */
	metrics: 'arial' | 'georgia';
}

const FALLBACKS: readonly Fallback[] = [
	{
		family: 'Outfit',
		source: 'outfit/files/outfit-latin-wght-normal.woff2',
		local: ['Arial', 'ArialMT', 'Liberation Sans'],
		metrics: 'arial'
	},
	{
		family: 'Big Shoulders Display',
		source: 'big-shoulders-display/files/big-shoulders-display-latin-wght-normal.woff2',
		local: ['Arial', 'ArialMT', 'Liberation Sans'],
		metrics: 'arial'
	},
	{
		family: 'Newsreader',
		source: 'newsreader/files/newsreader-latin-opsz-normal.woff2',
		local: ['Georgia', 'Gelasio'],
		metrics: 'georgia'
	}
];

function percent(value: number): string {
	return `${(value * 100).toFixed(2)}%`;
}

/** The overrides that make the stand-in set text in the web face's widths and line box: the
 * average character width sets size-adjust, then the vertical metrics are scaled by it. */
function fallbackFace(fallback: Fallback, web: Font): string {
	const stand = entireMetricsCollection[fallback.metrics];
	const sizeAdjust = web.xWidthAvg / web.unitsPerEm / (stand.xWidthAvg / stand.unitsPerEm);
	const em = web.unitsPerEm * sizeAdjust;
	return [
		'@font-face {',
		`	font-family: '${fallback.family} Fallback';`,
		`	src: ${fallback.local.map((name) => `local('${name}')`).join(', ')};`,
		`	size-adjust: ${percent(sizeAdjust)};`,
		`	ascent-override: ${percent(web.ascent / em)};`,
		`	descent-override: ${percent(Math.abs(web.descent) / em)};`,
		`	line-gap-override: ${percent(web.lineGap / em)};`,
		'}'
	].join('\n');
}

type Display = 'swap' | 'optional';

function fontFace(
	family: string,
	weight: WeightRange,
	src: string,
	range: string,
	display: Display = 'swap'
): string {
	return [
		'@font-face {',
		`\tfont-family: '${family}';`,
		'\tfont-style: normal;',
		`\tfont-display: ${display};`,
		`\tfont-weight: ${weight.min} ${weight.max};`,
		`\tsrc: url('${src}') format('woff2-variations');`,
		`\tunicode-range: ${range};`,
		'}'
	].join('\n');
}

/** Full Latin, then Latin Extended, then the core subset last so it wins for the characters it holds.
 * Every face of a family carries the same weight range, so they match as one family. */
function familyFaces(face: UiFace): string[] {
	const files = `@fontsource-variable/${face.package}/files/${face.package}`;
	return [
		fontFace(face.family, face.weight, `${files}-latin-wght-normal.woff2`, LATIN_RANGE),
		fontFace(face.family, face.weight, `${files}-latin-ext-wght-normal.woff2`, LATIN_EXT_RANGE),
		fontFace(face.family, face.weight, `./core/${face.file}`, coreUnicodeRange())
	];
}

await mkdir(OUT_DIR, { recursive: true });
for (const face of FACES) {
	const source = await readFile(new URL(face.source, SOURCE));
	const subset = await subsetFont(source, CORE_CHARACTERS, {
		targetFormat: 'woff2',
		...(face.clamp ? { variationAxes: { wght: face.weight } } : {})
	});
	await writeFile(new URL(face.file, OUT_DIR), subset);
	process.stdout.write(`${face.file}: ${source.length} to ${subset.length} bytes\n`);
}

const header = `/* Generated by scripts/subset-fonts.ts from Fontsource's packages of the Google Fonts files.
   Do not edit, run npm run fonts. The UI faces for every page, self-hosted so the first paint never
   waits on a cross-origin stylesheet. The family names are the ones tokens.css names. The CSS Fonts
   spec checks overlapping unicode ranges last rule first, so the core subset serves nearly every
   page and the full Latin files load only when a page sets a character outside it. */`;
const fallbacks = await Promise.all(
	FALLBACKS.map(async (fallback) =>
		fallbackFace(fallback, await fromBuffer(await readFile(new URL(fallback.source, SOURCE))))
	)
);
const fallbackNote = `/* The stand-ins: a local face per web face, sized and spaced to its metrics, named second in each
   tokens.css font stack, so text set before the web face lands keeps its size when it swaps. */`;
await writeFile(
	CSS_OUT,
	`${header}\n\n${FACES.flatMap(familyFaces).join('\n\n')}\n\n${fallbackNote}\n\n${fallbacks.join('\n\n')}\n`
);

const steadyFace = FACES.find((face) => face.family === STEADY.face);
if (!steadyFace) throw new Error(`No UI face named ${STEADY.face} to make the steady face from.`);
const steadyHeader = `/* Generated by scripts/subset-fonts.ts. Do not edit, run npm run fonts. The core Outfit file as
   '${STEADY.family}' with font-display optional: text set in it keeps the face it first painted in,
   Outfit once the file is cached, else its metric-matched fallback, and never swaps, so long text in
   a page's first screen never moves when the font lands. Imported only by the routes that use it. */`;
await writeFile(
	STEADY_OUT,
	`${steadyHeader}\n\n${fontFace(STEADY.family, steadyFace.weight, `./core/${steadyFace.file}`, coreUnicodeRange(), 'optional')}\n`
);
