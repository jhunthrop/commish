// Screenshots of the pages that follow the season (Lane 59): the front door, the board, a player
// page and the account page, signed out, in both themes at 1440 and 390, and the front door with
// script blocked (the prerendered rail). Each asserts the page's words follow the rail its root
// names (site/season-words.ts), that the front door with no script names the build's rail and
// shows its items, and that the front door's "All on the board" lands on a page with its rail item
// lit. Against the built site and the fixture API (scripts/inseason-fixture/serve.ts), which
// answers GET /season with week 6.
//
//   [ROS_FROM_WEEK=6] node scripts/season-pages-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL=http://localhost:8799 and the fixture API running there.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { signedOutTitle } from '../src/lib/account/keeps.ts';
import { PAGE_VERBS, boardWords, frontWords } from '../src/lib/site/season-words.ts';
import { RAIL_KEYS, railInSeason, type RailKey } from '../src/lib/ui/nav.ts';
import { railOfKey } from '../src/lib/ui/rail-order.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const PHONE_MAX = 760;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SEASON = 2026;
/** What the built run's board covers: the stand-in ranks the full season; a run that ranks the rest
 * of it from a week is shot with ROS_FROM_WEEK set to that week. */
const ROS_FROM_WEEK = process.env.ROS_FROM_WEEK;
const COVER = {
	season: SEASON,
	...(ROS_FROM_WEEK === undefined ? {} : { rosFromWeek: Number(ROS_FROM_WEEK) })
};
const PLAYER = 'puka-nacua';
/** The read's figures fill one row (run/read-figures.ts). */
const READ_FIGURES = 3;
/** The API reads that answer 401 with no session. */
const SESSION_READS = ['/me', '/leagues/attached'];
const PAGES = [
	{ name: 'home', path: '/' },
	{ name: 'board', path: '/board' },
	{ name: 'player', path: `/players/${PLAYER}` },
	{ name: 'account', path: '/account' }
] as const;

const web = process.argv[2] ?? 'http://localhost:4597';
const out = new URL(process.argv[3] ?? '../screenshots/season-pages/', import.meta.url);
const failures: string[] = [];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number, script = true): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		javaScriptEnabled: script
	});
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

function file(name: string): string {
	return new URL(`${name}.png`, out).pathname;
}

async function rootRail(page: Page): Promise<RailKey | null> {
	const rail = await page.evaluate(() => document.documentElement.getAttribute('data-rail'));
	return RAIL_KEYS.find((key) => key === rail) ?? null;
}

const text = (page: Page, selector: string): Promise<string> =>
	page.locator(selector).first().innerText({ timeout: READY_TIMEOUT_MS });

function expect(where: string, what: string, got: string, want: string): void {
	if (got.trim().toLowerCase() !== want.toLowerCase()) {
		failures.push(`${where}: the ${what} is "${got.trim()}", not "${want}"`);
	}
}

/** The words the page shows, checked against the rail its root names. */
async function checkWords(page: Page, name: string, where: string): Promise<void> {
	const rail = await rootRail(page);
	if (rail === null) {
		failures.push(`${where}: the root names no rail`);
		return;
	}
	const bar = await text(page, 'header.top h1');
	if (name === 'home') {
		const words = frontWords(rail, COVER, false);
		expect(where, 'bar', bar, words.title);
		expect(where, 'heading', await text(page, 'main h2'), words.heading);
		expect(where, 'verb', await text(page, 'main a.action.verb'), PAGE_VERBS[words.verb]);
	}
	if (name === 'board') {
		const words = boardWords(rail, { ...COVER, label: 'PPR', position: null }, false);
		expect(where, 'bar', bar, words.bar);
		expect(where, 'verb', await text(page, 'header.top .tail a.action'), PAGE_VERBS[words.verb]);
	}
	if (name === 'account') {
		expect(where, 'heading', await text(page, 'main h2'), signedOutTitle(railInSeason(rail)));
	}
}

for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const ctx = await context(theme, width);
		const page = await ctx.newPage();
		// Signed out, no page asks the API for the account or its leagues: each would be a 401.
		page.on('request', (request) => {
			const path = new URL(request.url()).pathname;
			if (SESSION_READS.includes(path)) {
				failures.push(`${theme} ${String(width)}: signed out, ${page.url()} asked for ${path}`);
			}
		});
		for (const { name, path } of PAGES) {
			const where = `${name} ${theme} ${String(width)}`;
			await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
			await page.evaluate(() => document.fonts.ready);
			await checkWords(page, name, where);
			await page.screenshot({ path: file(`${name}-${theme}-${String(width)}`) });
			if (name === 'player' && (await page.locator('.pulls').count()) > 0) {
				// The read's figures: one row of at most three, every number on one baseline.
				const figures = page.locator('.pulls');
				await figures.scrollIntoViewIfNeeded();
				const tops = await figures
					.locator('b')
					.evaluateAll((all) => all.map((b) => Math.round(b.getBoundingClientRect().top)));
				if (tops.length > READ_FIGURES)
					failures.push(`${where}: the read has ${String(tops.length)} figures`);
				if (width > PHONE_MAX && new Set(tops).size > 1) {
					failures.push(
						`${where}: the read's figures sit on ${String(new Set(tops).size)} baselines`
					);
				}
				await figures.screenshot({ path: file(`player-figures-${theme}-${String(width)}`) });
			}
			if (name === 'player') {
				await page.screenshot({
					path: file(`${name}-full-${theme}-${String(width)}`),
					fullPage: true
				});
			}
		}
		// The front door's way to the whole board lands on a page with its rail item lit.
		await page.goto(`${web}/`, { waitUntil: 'networkidle' });
		await page.locator('main .more a').first().click();
		await page.waitForURL(/\/board\//, { timeout: READY_TIMEOUT_MS });
		await page.waitForLoadState('networkidle');
		const lit = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('nav.rail .item[aria-current="page"]')]
				.filter((item) => item.getBoundingClientRect().width > 0)
				.map((item) => item.innerText.trim())
		);
		// The board's item lights wherever this width's rail shows it (the phone's in-season five
		// leave Rest of season to the wide rail).
		const boardRail = (await rootRail(page)) ?? 'pre_draft';
		const want = railOfKey(boardRail)
			.filter((item) => item.section === 'board' && (width > PHONE_MAX || !item.wideOnly))
			.map((item) => item.label);
		if (JSON.stringify(lit) !== JSON.stringify(want)) {
			failures.push(
				`all-board ${theme} ${String(width)}: lit ${JSON.stringify(lit)}, not ${JSON.stringify(want)}`
			);
		}
		await page.screenshot({ path: file(`all-board-${theme}-${String(width)}`) });
		await ctx.close();

		// With no script the root names the build's rail and the rail shows its items.
		const blocked = await context(theme, width, false);
		const still = await blocked.newPage();
		await still.goto(`${web}/`, { waitUntil: 'networkidle' });
		const rail = await rootRail(still);
		const where = `home no script ${theme} ${String(width)}`;
		if (rail === null) failures.push(`${where}: the root names no rail`);
		else {
			const items = railOfKey(rail).filter((item) => width > PHONE_MAX || !item.wideOnly);
			const shown = await still.evaluate(() =>
				[...document.querySelectorAll<HTMLElement>('nav.rail .item[data-k]')]
					.filter((item) => item.getBoundingClientRect().width > 0)
					.map((item) => item.innerText.trim())
			);
			const want = items.map((item) => item.label);
			if (JSON.stringify(shown) !== JSON.stringify(want)) {
				failures.push(`${where}: the rail shows ${shown.join(', ')}, not ${want.join(', ')}`);
			}
		}
		// The rows' styles are in the HTML, not waiting on a script.
		const rowDisplay = await still.evaluate(
			() => getComputedStyle(document.querySelector('.row') ?? document.body).display
		);
		if (rowDisplay !== 'grid')
			failures.push(`${where}: the rows are drawn ${rowDisplay}, not grid`);
		await still.screenshot({ path: file(`home-nojs-${theme}-${String(width)}`) });
		await blocked.close();
	}
}

await browser.close();
if (failures.length > 0) {
	process.stderr.write(`${failures.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`Every season page follows its rail. Shots in ${out.pathname}\n`);
