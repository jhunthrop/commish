// The shots' one copy scan (Lane 66x, ruling R3): the page's copy against the site's one guard
// (src/lib/format/copy-guard.ts), with the data the page was handed skipped. The data is the API's
// and the run's own names (their name fields, copy-guard.ts NAME_FIELDS), read from every JSON
// answer the browser context received and from the prerendered page's own data file, never an
// allow-list of names. Every other string an answer carries is copy and is scanned.
//
//   const ctx = await browser.newContext(...); watchData(ctx);
//   ... const fault = await copyFault(page); // null when the copy is clean
import { unflatten } from 'devalue';
import type { BrowserContext, Page, Response } from 'playwright';
import { bannedInCopy, dataStrings } from '../src/lib/format/copy-guard.ts';

const JSON_TYPE = /\bjson\b/u;

/** Each watched context's JSON answers, as the strings they carry. */
const watched = new WeakMap<BrowserContext, Promise<Set<string>>[]>();

async function answerStrings(response: Response): Promise<Set<string>> {
	if (!JSON_TYPE.test(response.headers()['content-type'] ?? '')) return new Set();
	try {
		return dataStrings(await response.json());
	} catch {
		// A redirect or a read cut off by a navigation carries no body, so it hands the page no data.
		return new Set();
	}
}

/** Starts collecting the data a context's pages are handed: every JSON answer, from any origin.
 * Call it before the first page opens. */
export function watchData(ctx: BrowserContext): void {
	const answers: Promise<Set<string>>[] = [];
	watched.set(ctx, answers);
	ctx.on('response', (response) => {
		answers.push(answerStrings(response));
	});
}

/** SvelteKit's data file: each route node's load data, flattened by devalue (fields as indexes). */
interface DataFile {
	nodes?: ({ type: string; data?: unknown } | null)[];
}

/** The prerendered page's own data (SvelteKit's __data.json beside it): the run's rows it was built
 * from, unflattened so the name fields are fields again. A page with no server data has none. */
async function builtData(page: Page): Promise<Set<string>> {
	const url = new URL(page.url());
	const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
	const response = await page.request.get(`${url.origin}${path}__data.json`);
	if (!response.ok() || !JSON_TYPE.test(response.headers()['content-type'] ?? '')) return new Set();
	const file = (await response.json()) as DataFile;
	const loads = (file.nodes ?? []).flatMap((node) =>
		node?.type === 'data' && Array.isArray(node.data) ? [unflatten(node.data) as unknown] : []
	);
	return dataStrings(loads);
}

/** The first banned word or mark in the copy under a selector (main by default), the page's data
 * skipped; null when the copy is clean. A guard's own words are composed with the list. */
export async function copyFault(
	page: Page,
	own?: RegExp,
	selector = 'main'
): Promise<string | null> {
	const answers = watched.get(page.context());
	if (answers === undefined) throw new Error('copyFault reads a context watchData never watched.');
	const text = await page.evaluate(
		(sel) =>
			[...document.querySelectorAll(sel)].map((el) => (el as HTMLElement).innerText).join('\n'),
		selector
	);
	const handed = (await Promise.all(answers)).flatMap((set) => [...set]);
	return bannedInCopy(text, new Set([...handed, ...(await builtData(page))]), own);
}
