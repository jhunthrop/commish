// Before each Lighthouse run of /sheet: put our 400-row board into this browser as the drafter's
// sheet, in the storage shape src/lib/sheet/storage.ts reads, so the audit measures the page a
// returning drafter opens and not the empty one.
const SHEET_STORAGE_KEY = 'commish-sheet';
const STORAGE_VERSION = 3;
const SEED_ROWS = 400;

/** @param {import('puppeteer-core').Browser} browser @param {{ url: string }} context */
module.exports = async (browser, { url }) => {
	const page = await browser.newPage();
	// A file on the same origin, so the seed loads none of the page's own code into the cache.
	await page.goto(new URL('/robots.txt', url).href);
	await page.evaluate(
		async (key, version, size) => {
			const response = await fetch('/data/sheet-board/ppr.json', { cache: 'no-store' });
			/** @type {{ i: string, n: string, p: string, t: string | null, h: string | null }[]} */
			const board = await response.json();
			const rows = board.slice(0, size).map((p) => ({
				id: p.i,
				name: p.n,
				position: p.p,
				team: p.t,
				headshot: p.h,
				tier: null,
				tags: [],
				note: null
			}));
			const sheet = { name: 'My sheet', format: 'ppr', rows };
			localStorage.setItem(
				key,
				JSON.stringify({
					version,
					sheet,
					editedAt: new Date().toISOString(),
					dirty: false,
					sync: null,
					base: null,
					shelf: []
				})
			);
		},
		SHEET_STORAGE_KEY,
		STORAGE_VERSION,
		SEED_ROWS
	);
	// Storage is kept for the audit, so the HTTP cache is emptied here: the run loads every byte
	// cold, as the budget means it.
	const cdp = await page.createCDPSession();
	await cdp.send('Network.enable');
	await cdp.send('Network.clearBrowserCache');
	await page.close();
};
