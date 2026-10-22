// Screenshots of the pages that follow the season (Lane 59): the front door, the board, a player
// page and the account page, signed out, in both themes at 1440 and 390, and the front door with
// script blocked (the prerendered rail). Each asserts the page's words follow the rail its root
// names (site/season-words.ts), that the front door with no script names the build's rail and
// shows its items, that the front door's "All N on our board" lands on a page with its rail item
// lit, and that the front door under a league whose phase differs from the site's (a pre-draft
// league in season) holds the same words and the same hero shape before its script runs as after
// (Lane 60: the words are drawn for both phases and the root's rail shows one). Against the built site and the fixture API (scripts/inseason-fixture/serve.ts), which
// answers GET /season with week 6.
//
//   [ROS_FROM_WEEK=7] node scripts/season-pages-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL=http://localhost:8799 and the fixture API running there.
// ROS_FROM_WEEK names a run that ranks the rest of the season from that week, played in none of it:
// the contract fixture run (2026-10-21T12-ros) ranks from week 7.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { signedOutTitle } from '../src/lib/account/keeps.ts';
import { PAGE_VERBS, boardWords, frontWords } from '../src/lib/site/season-words.ts';
import { PHASE_COOKIE } from './inseason-fixture/phases.ts';
import { RAIL_KEYS, railInSeason, type RailKey } from '../src/lib/ui/nav.ts';
import { railShown } from '../src/lib/ui/rail-order.ts';
import { restFromWords } from '../src/lib/run/rest-from.ts';
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
	...(ROS_FROM_WEEK === undefined
		? {}
		: {
				rosFromWeek: Number(ROS_FROM_WEEK),
				restFrom: restFromWords(Number(ROS_FROM_WEEK), false)
			})
};
const PLAYER = 'puka-nacua';
/** The league whose phase differs from the site's season (the fixture's pre-draft league). */
const DIFFERING_PHASE = 'pre_draft';
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
/** The page's script, which a held load never fetches (the inline boot script still runs). */
const PAGE_SCRIPT = '**/_app/immutable/**';
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

/** Whether the root names a league selected: a season rail with none shows the rail without a league
 * (Lane 83, rail-order.ts railShown). */
async function namesLeague(page: Page): Promise<boolean> {
	return page.evaluate(() => document.documentElement.hasAttribute('data-league'));
}

/** The words as drawn: the first match not inside a set of words the root's rail hides (a page
 * holds both sets), its text without the sets inside it that are hidden. A match is read whether or
 * not its own box is shown, as the phone hides the bar's title. */
async function text(page: Page, selector: string): Promise<string> {
	await page.waitForSelector(selector, { state: 'attached', timeout: READY_TIMEOUT_MS });
	return page.evaluate((sel) => {
		const hidden = (node: Element | null): boolean => {
			const set = node?.closest('[data-words]') ?? null;
			return set !== null && getComputedStyle(set).display === 'none';
		};
		const match = [...document.querySelectorAll(sel)].find((node) => !hidden(node));
		if (!match) return '';
		const walker = document.createTreeWalker(match, NodeFilter.SHOW_TEXT);
		let out = '';
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!hidden(node.parentElement)) out += node.textContent ?? '';
		}
		return out.replace(/\s+/g, ' ');
	}, selector);
}

function expect(where: string, what: string, got: string, want: string): void {
	if (got.trim().toLowerCase() !== want.toLowerCase()) {
		failures.push(`${where}: the ${what} is "${got.trim()}", not "${want}"`);
	}
}

/** The words the page shows, checked against the rail its root names. */
async function checkWords(
	page: Page,
	name: string,
	where: string,
	following = false
): Promise<void> {
	const rail = await rootRail(page);
	if (rail === null) {
		failures.push(`${where}: the root names no rail`);
		return;
	}
	const bar = await text(page, 'header.top h1');
	if (name === 'home') {
		const words = frontWords(rail, COVER, following);
		expect(where, 'bar', bar, words.title);
		expect(where, 'heading', await text(page, 'main h2'), words.heading);
		expect(where, 'verb', await text(page, 'main a.action.verb'), PAGE_VERBS[words.verb]);
	}
	if (name === 'board') {
		const words = boardWords(rail, { ...COVER, label: 'PPR', position: null }, following);
		expect(where, 'bar', bar, words.bar);
		if (words.verb === null) {
			// No verb on the board once a league is selected (Lane 104, B60).
			const shown = await page.evaluate(
				() =>
					[...document.querySelectorAll('header.top .tail a.action')].filter((node) => {
						const set = node.closest('[data-words]');
						return set === null || getComputedStyle(set).display !== 'none';
					}).length
			);
			if (shown > 0) failures.push(`${where}: the board draws a verb with a league selected`);
		} else {
			expect(where, 'verb', await text(page, 'header.top .tail a.action'), PAGE_VERBS[words.verb]);
		}
	}
	if (name === 'account') {
		expect(where, 'heading', await text(page, 'main h2'), signedOutTitle(railInSeason(rail)));
	}
}

/** The hero as it is drawn: its words and its height. */
async function hero(page: Page): Promise<{ bar: string; heading: string; height: number }> {
	return {
		bar: (await text(page, 'header.top h1')).trim(),
		heading: (await text(page, 'main h2')).trim(),
		height: await page
			.locator('section.hero')
			.evaluate((el) => Math.round(el.getBoundingClientRect().height))
	};
}

/** A member whose league is in another phase than the site's: the front door holds that phase's
 * words before its script runs, and the hero keeps its words and its shape when it has. */
async function checkDifferingPhase(theme: string, width: number): Promise<void> {
	const where = `home ${DIFFERING_PHASE} league ${theme} ${String(width)}`;
	const ctx = await context(theme, width);
	await ctx.addCookies(
		[SIGNED_IN, { name: PHASE_COOKIE, value: DIFFERING_PHASE }].map((cookie) => ({
			...cookie,
			domain: 'localhost',
			path: '/'
		}))
	);
	const page = await ctx.newPage();
	// The first visit lets the page learn the league's phase, as a member's last visit did.
	await page.goto(`${web}/`, { waitUntil: 'networkidle' });
	await page.waitForFunction(
		(want) => document.documentElement.getAttribute('data-rail') === want,
		DIFFERING_PHASE,
		{ timeout: READY_TIMEOUT_MS }
	);
	// Then the page is drawn with its script held: the boot script has set the rail, nothing else ran.
	await ctx.route(PAGE_SCRIPT, (route) => route.abort());
	await page.goto(`${web}/`, { waitUntil: 'load' });
	const held = await hero(page);
	const want = frontWords(DIFFERING_PHASE, COVER, false);
	expect(where, 'held bar', held.bar, want.title);
	expect(where, 'held heading', held.heading, want.heading);
	await page.screenshot({ path: file(`home-${DIFFERING_PHASE}-held-${theme}-${String(width)}`) });
	await ctx.unroute(PAGE_SCRIPT);
	await page.goto(`${web}/`, { waitUntil: 'networkidle' });
	await page.evaluate(() => document.fonts.ready);
	const ready = await hero(page);
	if (ready.bar !== held.bar || ready.heading !== held.heading) {
		failures.push(`${where}: the words changed when the script ran`);
	}
	if (ready.height !== held.height) {
		failures.push(
			`${where}: the hero went from ${String(held.height)} to ${String(ready.height)}px`
		);
	}
	await checkWords(page, 'home', where, true);
	await page.screenshot({ path: file(`home-${DIFFERING_PHASE}-${theme}-${String(width)}`) });
	await ctx.close();
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
		const want = railShown(boardRail, await namesLeague(page))
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
			const items = railShown(rail, await namesLeague(still)).filter(
				(item) => width > PHONE_MAX || !item.wideOnly
			);
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
		await checkWords(still, 'home', where);
		await still.screenshot({ path: file(`home-nojs-${theme}-${String(width)}`) });
		await blocked.close();
		await checkDifferingPhase(theme, width);
	}
}

await browser.close();
if (failures.length > 0) {
	process.stderr.write(`${failures.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`Every season page follows its rail. Shots in ${out.pathname}\n`);
