// The basis budget's one measure (Lane 66t), for every shots script that checks it: the distinct
// line boxes a screen's basis text draws, a link and the words beside it on one line counted once,
// held to five at a desk and eight on a phone. The sweep's measurements (sweep-2026-10-19.md) are the
// before each screen's count is printed beside.
import type { Page } from 'playwright';
import { BOX } from '../src/lib/league/box/box.ts';

/** The widths the budget is measured at, and the most lines it allows at each. */
export const BASIS_BUDGET: Readonly<Record<number, number>> = { 1440: 5, 390: 8 };

/** The sweep's rendered lines per screen, 1440 then 390: the before. */
export const SWEEP_BEFORE: Readonly<Record<string, readonly [number, number]>> = {
	trades: [11, 24],
	'trades opened': [11, 24],
	'trades builder': [11, 24],
	lineup: [8, 17],
	waivers: [8, 18],
	board: [5, 13],
	players: [5, 13],
	record: [4, 9]
};

/** Every screen's basis: its [data-basis] blocks, the builder's own line left out (said apart). */
export const PAGE_BASIS = 'main [data-basis]:not([data-basis="builder"])';
export const BUILDER_LINE = 'main [data-basis="builder"]';

/** The rendered lines the blocks under a selector draw, in the page. */
export async function basisLines(page: Page, selector: string = PAGE_BASIS): Promise<number> {
	return page.evaluate((within: string) => {
		let lines = 0;
		for (const block of document.querySelectorAll(within)) {
			const mids: number[] = [];
			const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
			for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
				const range = document.createRange();
				range.selectNodeContents(n);
				for (const r of range.getClientRects()) {
					if (r.width > 1 && r.height > 0) mids.push(r.top + r.height / 2);
				}
			}
			mids.sort((a, b) => a - b);
			let last = -Infinity;
			for (const m of mids) {
				if (m - last > 4) lines += 1;
				last = m;
			}
		}
		return lines;
	}, selector);
}

/** One screen's count against the budget at a width: its line for the report, and a fault when over
 * (or when nothing is drawn). Widths outside the budget's are not held. */
export function basisReport(
	screen: string,
	width: number,
	lines: number
): { line: string; fault: string | null } | null {
	const most = BASIS_BUDGET[width];
	if (most === undefined) return null;
	const before = SWEEP_BEFORE[screen];
	const was =
		before === undefined ? '' : ` (before ${String(width === 390 ? before[1] : before[0])})`;
	return {
		line: `basis ${screen} ${String(width)}: ${String(lines)} lines${was}`,
		fault:
			lines === 0 || lines > most
				? `${screen} ${String(width)} basis draws ${String(lines)} lines, at most ${String(most)}`
				: null
	};
}

/** The weather a Game cell draws: a forecast's degrees or wind, or a venue's words from the one
 * source a cell prints them from (box.ts BOX). */
export const WEATHER_FIGURE = new RegExp(
	[
		String.raw`\d+°`,
		String.raw`\d+ mph\b`,
		...[BOX.indoors, BOX.outdoors, BOX.roofOpen, BOX.abroad]
	].join('|')
);

/** A figure a row draws and the words of the sentence that says what it is (review H2). */
const FIGURE_SENTENCES: readonly { figure: RegExp; sentence: string; what: string }[] = [
	// Said alone ("Opp rank is points allowed to his position") or with Our rank on the Lineup
	// ("..., Opp rank the points allowed to it", Lane 99).
	{ figure: /\bOpp \d+(st|nd|rd|th)\b/, sentence: 'points allowed to', what: 'Opp rank' },
	{ figure: /\b\d+(\.5)? to \d+(\.5)?\b/, sentence: 'expected points', what: 'the expected score' },
	{ figure: /\bA game \d+\.\d\b/, sentence: 'A game is', what: 'A game' },
	{ figure: WEATHER_FIGURE, sentence: 'weather', what: 'the weather' }
];

/** Every figure the page's rows draw where it is shot has its sentence in the basis drawn there: a
 * phone basis may leave a sentence out only with its figure (review H2). */
export async function figureSentenceFaults(page: Page): Promise<string[]> {
	const { rows, basis } = await page.evaluate((selector: string) => {
		const shown = (el: Element): boolean => el.getClientRects().length > 0;
		const rows = [...document.querySelectorAll('main table tbody tr')]
			.filter(shown)
			.map((tr) => (tr as HTMLElement).innerText)
			.join('\n');
		const basis = [...document.querySelectorAll(selector)]
			.map((el) => (el as HTMLElement).innerText)
			.join(' ');
		return { rows, basis };
	}, PAGE_BASIS);
	return FIGURE_SENTENCES.filter((f) => f.figure.test(rows) && !basis.includes(f.sentence)).map(
		(f) => `draws ${f.what} with no sentence saying what it is`
	);
}
