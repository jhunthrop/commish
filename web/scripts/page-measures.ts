// Lane 87's page measures, for the shots scripts that hold them: the phone bar's rows and what leads
// it (the one rule in src/lib/ui/bar-rows.ts), the record table's open strip at its right edge, a
// fact strip's open space at a wrapped row's right, the lobby cards' counts, and sideways scroll.
// The bar's height and band are chrome-measures.ts's, measured the same way.
import type { Page } from 'playwright';
import type { BarRows } from '../src/lib/ui/bar-rows.ts';
import { chromeMeasures } from './chrome-measures.ts';

/** The phone bar's one row, in CSS px (Lane 87's mock). */
export const ONE_ROW_BAR_PX = 57;
/** How far a measured edge may sit from where it should, in CSS px. */
export const EDGE_SLACK_PX = 1;

export interface PageMeasures {
	barHeight: number;
	band: number;
	/** The bar's grid rows (0 at a desk, where the bar is one flex row). */
	barRows: number;
	/** The bar's first drawn part: the site mark, or the league switch. */
	leads: 'mark' | 'switch' | 'other';
	/** The widest open strip between a drawn record row's last cell and the table's inner right. */
	recordStrip: number | null;
	/** The widest open space at the right of a fact strip's row, any strip on the page. */
	factsGap: number | null;
	/** The lobby cards' counts and the lobby room's count, as drawn. */
	lobbyCounts: string[];
	sideways: boolean;
}

export async function pageMeasures(page: Page): Promise<PageMeasures> {
	const chrome = await chromeMeasures(page);
	const rest = await page.evaluate(() => {
		const drawn = (el: Element): boolean => {
			const r = el.getBoundingClientRect();
			return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
		};
		const rightEdge = (el: Element): number =>
			el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).borderRightWidth);
		const top = document.querySelector('header.top');
		const style = top ? getComputedStyle(top) : null;
		const barRows =
			style?.display === 'grid' ? style.gridTemplateRows.split(' ').filter(Boolean).length : 0;
		// The first part in reading order: the leftmost of the parts the top row's middle runs through
		// (a part's negative margins put its box's top above its row's).
		const parts = top ? [...top.children].filter(drawn) : [];
		const highest = Math.min(...parts.map((p) => p.getBoundingClientRect().top));
		const lead = parts.find((p) => p.getBoundingClientRect().top === highest);
		const middle = lead
			? (lead.getBoundingClientRect().top + lead.getBoundingClientRect().bottom) / 2
			: 0;
		const first = parts
			.filter((p) => {
				const r = p.getBoundingClientRect();
				return r.top <= middle && r.bottom >= middle;
			})
			.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
		const leads: 'mark' | 'switch' | 'other' = first?.classList.contains('home')
			? 'mark'
			: first?.classList.contains('league')
				? 'switch'
				: 'other';
		const table = document.querySelector('main table.weeks');
		let recordStrip: number | null = null;
		if (table && drawn(table)) {
			const right = rightEdge(table);
			const gaps = [...table.querySelectorAll('tr')].filter(drawn).map((row) => {
				const cells = [...row.children].filter(drawn);
				return right - Math.max(...cells.map((c) => c.getBoundingClientRect().right));
			});
			recordStrip = Math.max(0, ...gaps);
		}
		let factsGap: number | null = null;
		for (const facts of document.querySelectorAll('main dl.facts')) {
			if (!drawn(facts)) continue;
			const inner = rightEdge(facts);
			const rows = new Map<number, number>();
			for (const cell of facts.children) {
				const r = cell.getBoundingClientRect();
				const key = Math.round(r.top);
				rows.set(key, Math.max(rows.get(key) ?? 0, r.right));
			}
			factsGap = Math.max(factsGap ?? 0, ...[...rows.values()].map((r) => inner - r));
		}
		return {
			barRows,
			leads,
			recordStrip,
			factsGap,
			lobbyCounts: [
				...document.querySelectorAll<HTMLElement>('main .card .fill, main p.wait b')
			].map((f) => f.innerText.trim()),
			sideways: document.documentElement.scrollWidth > window.innerWidth
		};
	});
	return { barHeight: chrome.barHeight, band: chrome.band, ...rest };
}

/** What a page holds at a width (Lane 87): no band under the phone bar; at a phone the rows its parts
 * give, one row of 57 px led by the mark when it passes none (rows null: not asked); the record table
 * and every fact strip ending at their right edge; no lobby count said as "N of M"; no sideways
 * scroll. */
export function pageFaults(m: PageMeasures, phone: boolean, rows: BarRows | null): string[] {
	const faults: string[] = [];
	if (phone && m.band > EDGE_SLACK_PX) faults.push(`a ${m.band.toFixed(0)}px band under the bar`);
	if (phone && rows !== null && m.barRows !== rows)
		faults.push(`the bar draws ${String(m.barRows)} rows, not ${String(rows)}`);
	if (phone && rows === 1) {
		if (Math.abs(m.barHeight - ONE_ROW_BAR_PX) > EDGE_SLACK_PX)
			faults.push(`the one-row bar is ${m.barHeight.toFixed(1)}px`);
		if (m.leads !== 'mark') faults.push(`the one-row bar leads with the ${m.leads}`);
	}
	if (phone && rows !== null && rows > 1 && m.leads !== 'switch')
		faults.push(`the ${String(rows)}-row bar leads with the ${m.leads}`);
	if (m.recordStrip !== null && m.recordStrip > EDGE_SLACK_PX)
		faults.push(`the record table leaves a ${m.recordStrip.toFixed(1)}px strip at its right`);
	if (phone && m.factsGap !== null && m.factsGap > EDGE_SLACK_PX)
		faults.push(`a fact strip leaves ${m.factsGap.toFixed(1)}px open at a row's right`);
	for (const count of m.lobbyCounts)
		if (/\d+ of \d+/.test(count)) faults.push(`a lobby count reads "${count}"`);
	if (m.sideways) faults.push('the page scrolls sideways');
	return faults;
}

/** One page's line for the report. */
export function pageLine(where: string, m: PageMeasures): string {
	const strip = m.recordStrip === null ? '' : `, record strip ${m.recordStrip.toFixed(1)}px`;
	const facts = m.factsGap === null ? '' : `, facts gap ${m.factsGap.toFixed(1)}px`;
	const counts = m.lobbyCounts.length > 0 ? `, lobby counts ${m.lobbyCounts.join(' / ')}` : '';
	const side = m.sideways ? ', sideways' : '';
	return `page ${where}: bar ${m.barHeight.toFixed(0)}px, ${String(m.barRows)} rows, leads ${m.leads}, band ${m.band.toFixed(0)}px${strip}${facts}${counts}${side}`;
}
