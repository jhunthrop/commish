// The phone chrome's measures on a league page and a room (Lane 83), for the shots scripts that
// hold them: the empty band in the top bar under its last filled row, the solid verbs and quiet
// actions each strip draws ([data-strip], the Waivers strip counted with the verb pinned for it),
// the league name's drawn and natural lines and whether it is cut, the Lineup Team row's gap from
// Proj's figure to Pts's, and the rail the root names with the bottom bar's labels.
import type { Page } from 'playwright';

/** The Lineup Team row's least gap between its two figures (the mock's rule). */
export const TOTALS_GAP_MIN_PX = 8;
/** The most lines a league's name draws. */
export const NAME_LINES_MAX = 2;
/** A strip's solid verbs: one, its lead. */
export const STRIP_VERBS = 1;

export interface StripCount {
	verbs: number;
	quiet: number;
}

export interface ChromeMeasures {
	/** The top bar's height, and the empty band under its last row with anything in it. */
	barHeight: number;
	band: number;
	strips: Record<string, StripCount>;
	/** The league name's lines as drawn, as its words would run uncut, and whether it is cut. */
	name: { lines: number; natural: number; cut: boolean } | null;
	/** Pts's figure's left edge less Proj's right edge in the Lineup's Team row. */
	totalsGap: number | null;
	rail: string | null;
	/** The bottom bar's (or at a desk the rail's) drawn labels, in order. */
	railLabels: string[];
}

export async function chromeMeasures(page: Page): Promise<ChromeMeasures> {
	return page.evaluate(() => {
		const drawn = (el: Element): boolean => {
			const r = el.getBoundingClientRect();
			return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden';
		};
		/** A box with something in it: words, a glyph or a control drawn inside it. */
		const filled = (el: Element): boolean =>
			drawn(el) &&
			((el as HTMLElement).innerText.trim() !== '' ||
				[...el.querySelectorAll('svg, img, input, button, a')].some(drawn));
		const top = document.querySelector('header.top');
		let barHeight = 0;
		let band = 0;
		if (top) {
			const box = top.getBoundingClientRect();
			const style = getComputedStyle(top);
			const inner =
				box.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
			const lowest = Math.max(
				box.top + parseFloat(style.paddingTop),
				...[...top.children].filter(filled).map((c) => c.getBoundingClientRect().bottom)
			);
			barHeight = box.height;
			band = Math.max(0, inner - lowest);
		}
		const count = (within: Element | null, cls: string): number =>
			within === null ? 0 : [...within.querySelectorAll(`.action.${cls}`)].filter(drawn).length;
		const strips: Record<string, { verbs: number; quiet: number }> = {};
		for (const strip of document.querySelectorAll<HTMLElement>('main [data-strip]')) {
			const key = strip.dataset.strip ?? '';
			// The Waivers strip's verb is pinned over the bar on a phone (Screen's .pin).
			const pins = [...document.querySelectorAll('.pin')].filter(drawn);
			const pinned = key === 'waivers' ? pins.reduce((n, pin) => n + count(pin, 'verb'), 0) : 0;
			strips[key] = { verbs: count(strip, 'verb') + pinned, quiet: count(strip, 'quiet') };
		}
		const title = document.querySelector<HTMLElement>('main h2.title.wrap');
		let name: { lines: number; natural: number; cut: boolean } | null = null;
		if (title) {
			const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
			name = {
				lines: Math.round(title.clientHeight / lineHeight),
				natural: Math.round(title.scrollHeight / lineHeight),
				cut: title.scrollHeight > title.clientHeight + 1
			};
		}
		const textBox = (cell: Element | null): DOMRect | null => {
			if (!cell) return null;
			const range = document.createRange();
			range.selectNodeContents(cell);
			return range.getBoundingClientRect();
		};
		const proj = textBox(document.querySelector('main table.lineup tr.totals td.proj'));
		const pts = textBox(document.querySelector('main table.lineup tr.totals td.pts'));
		const labels = [...document.querySelectorAll<HTMLElement>('nav.rail a.item')]
			.filter(drawn)
			.map((a) => a.innerText.trim());
		return {
			barHeight,
			band,
			strips,
			name,
			totalsGap: proj && pts ? pts.left - proj.right : null,
			rail: document.documentElement.getAttribute('data-rail'),
			railLabels: labels
		};
	});
}

/** One page's line for the report, as the mock's measures read. */
export function chromeLine(where: string, m: ChromeMeasures): string {
	const strips = Object.entries(m.strips)
		.map(([key, c]) => `${key} ${String(c.verbs)} verb ${String(c.quiet)} quiet`)
		.join(', ');
	const name = m.name
		? `name ${String(m.name.lines)} lines (${String(m.name.natural)} uncut)${m.name.cut ? ' cut' : ''}`
		: 'no name';
	const gap = m.totalsGap === null ? '' : `, totals gap ${m.totalsGap.toFixed(1)}px`;
	return `chrome ${where}: bar ${m.barHeight.toFixed(0)}px, band ${m.band.toFixed(0)}px, ${name}${strips ? `, ${strips}` : ''}${gap}, rail ${String(m.rail)}`;
}

/** What a league page's chrome must hold at a width: no band in the phone bar, one solid verb per
 * strip, the name whole within two lines (unless it runs past two, `long`), the Team row's figures
 * apart. */
export function chromeFaults(m: ChromeMeasures, phone: boolean, long = false): string[] {
	const faults: string[] = [];
	if (phone && m.band > 1) faults.push(`a ${m.band.toFixed(0)}px band under the bar's row`);
	for (const [key, c] of Object.entries(m.strips)) {
		if (c.verbs !== STRIP_VERBS) faults.push(`the ${key} strip draws ${String(c.verbs)} verbs`);
	}
	if (m.name) {
		if (m.name.lines > NAME_LINES_MAX) faults.push(`the name draws ${String(m.name.lines)} lines`);
		if (!long && m.name.cut) faults.push(`the name is cut at ${String(m.name.lines)} lines`);
		if (long && (m.name.lines !== NAME_LINES_MAX || m.name.natural <= NAME_LINES_MAX))
			faults.push(`the long name draws ${String(m.name.lines)} of ${String(m.name.natural)}`);
	}
	if (phone && m.totalsGap !== null && m.totalsGap < TOTALS_GAP_MIN_PX)
		faults.push(`the Team row's figures ${m.totalsGap.toFixed(1)}px apart`);
	return faults;
}
