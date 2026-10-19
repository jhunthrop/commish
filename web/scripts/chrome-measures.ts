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
	/** Whether the root names a league selected (the context's data-league). */
	league: boolean;
	/** The bottom bar's (or at a desk the rail's) drawn labels, in order. */
	railLabels: string[];
	/** The phone evidence lines a label is parted from its figure on (Lane 83 review 2): each label
	 * and figure pair drawn on more than one line, or a line ending on a label word or a lone "-". */
	evidenceSplits: string[];
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
			// The same words at the same width with no clamp: the lines they would run to.
			const uncut = title.cloneNode(true) as HTMLElement;
			Object.assign(uncut.style, {
				position: 'absolute',
				visibility: 'hidden',
				display: 'block',
				webkitLineClamp: 'none',
				lineClamp: 'none',
				// The drawn width, rounded up: a title sized to its words would wrap at a pixel less.
				width: `${String(Math.ceil(title.getBoundingClientRect().width))}px`
			});
			title.insertAdjacentElement('afterend', uncut);
			const natural = Math.round(uncut.clientHeight / lineHeight);
			uncut.remove();
			const lines = Math.round(title.clientHeight / lineHeight);
			name = { lines, natural, cut: natural > lines };
		}
		const textBox = (cell: Element | null): DOMRect | null => {
			if (!cell) return null;
			const range = document.createRange();
			range.selectNodeContents(cell);
			return range.getBoundingClientRect();
		};
		const proj = textBox(document.querySelector('main table.lineup tr.totals td.proj'));
		const pts = textBox(document.querySelector('main table.lineup tr.totals td.pts'));
		const splits: string[] = [];
		for (const line of document.querySelectorAll<HTMLElement>('main .phone-ev')) {
			if (!drawn(line)) continue;
			// Each text box's line, by its middle: the words that end each drawn line.
			const ends = new Map<number, string>();
			const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
			for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
				const text = n.textContent ?? '';
				for (let i = 0; i < text.length; i += 1) {
					const range = document.createRange();
					range.setStart(n, i);
					range.setEnd(n, i + 1);
					const r = range.getBoundingClientRect();
					if (r.width === 0) continue;
					const mid = Math.round((r.top + r.height / 2) / 4);
					ends.set(mid, (ends.get(mid) ?? '') + text.charAt(i));
				}
			}
			const lines = [...ends.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t.trim());
			const last = lines.slice(0, -1);
			for (const t of last) {
				if (/(Opp|Avg|Last|season)$/.test(t) || /(^|\s)-$/.test(t)) splits.push(lines.join(' / '));
			}
		}
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
			league: document.documentElement.hasAttribute('data-league'),
			railLabels: labels,
			evidenceSplits: splits
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
	return `chrome ${where}: bar ${m.barHeight.toFixed(0)}px, band ${m.band.toFixed(0)}px, ${name}${strips ? `, ${strips}` : ''}${gap}, rail ${String(m.rail)}${m.league ? ' with a league' : ' with no league'}`;
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
	for (const split of m.evidenceSplits) faults.push(`an evidence line parts a label: ${split}`);
	if (phone && m.totalsGap !== null && m.totalsGap < TOTALS_GAP_MIN_PX)
		faults.push(`the Team row's figures ${m.totalsGap.toFixed(1)}px apart`);
	return faults;
}
