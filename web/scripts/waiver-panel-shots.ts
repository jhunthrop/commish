// Screenshots of the Waivers screen's position panel (Lane 291) against the fixture API on the
// fixture week's clock and the built site, light and dark at 1280 by 800 and 390 by 844, light at 1024 by 768: the first
// screen, then a card open on its ranked list (the member's players, then the free agents with the
// table's Beats and Add), then the This week figures. Checks: nothing scrolls sideways, the copy
// passes the one guard (copy-scan.ts), at 1280 by 800 the panel beside the strip leaves the five
// table rows the page showed before it (coordinator's ruling 2026-10-29), on a phone the panel
// closed is one row of cards, every card says its rank out of the league's teams, an open card lists
// free agents each with the table's Add, and the toggle changes the cards' figures. PANEL=off shoots
// the page before the panel (the lane's before shots) and checks only the first two.
//
//   node scripts/waiver-panel-shots.ts [web origin] [out dir, from scripts/]
// with the site built against PUBLIC_API_URL at the fixture API (API_ORIGIN, default 8799), started
// with FIXTURE_CLOCK on the fixture week's clock.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { PANEL } from '../src/lib/league/box/positions.ts';
import { LINES } from '../src/lib/league/inseason/words.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import {
	FIXTURE_WEEK_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';

type Theme = 'light' | 'dark';
type Width = 1280 | 1024 | 390;
const web = process.argv[2] ?? 'http://localhost:4196';
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8799';
const panelOn = process.env.PANEL !== 'off';
const out = new URL(process.argv[3] ?? '../screenshots/waiver-panel/', import.meta.url);
const SHOTS: readonly (readonly [Theme, Width])[] = [
	['light', 1280],
	['dark', 1280],
	['light', 1024],
	['light', 390],
	['dark', 390]
];
const HEIGHTS = { 1280: 800, 1024: 768, 390: 844 } as const;
/** The table rows the first screen at a desk showed before the panel, and must still show whole with
 * the panel beside the strip (the six once asked for was never true: five before the panel). */
const DESK_ROWS = 5;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const LEAGUE = `/league/${FIXTURE_IDS.league}`;

await requireFixtureClock(API_ORIGIN, FIXTURE_WEEK_CLOCK);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

function fault(where: string, what: string): void {
	faults.push(`${where}: ${what}`);
}

async function context(theme: Theme, width: Width): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: HEIGHTS[width] },
		colorScheme: theme,
		deviceScaleFactor: width < 500 ? 2 : 1
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function check(page: Page, where: string): Promise<void> {
	const sideways = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	if (sideways > 0) fault(where, `scrolls sideways by ${String(sideways)} px`);
	const copy = await copyFault(page);
	if (copy !== null) fault(where, copy);
}

/** The table's player rows whole above the fold. */
function rowsInView(page: Page): Promise<number> {
	return page.evaluate(() => {
		const rows = [...document.querySelectorAll('table.pool > tbody:not(.panel) > tr:first-child')];
		return rows.filter((r) => {
			const box = r.getBoundingClientRect();
			return (
				r.querySelectorAll('td').length > 3 && box.top >= 0 && box.bottom <= window.innerHeight
			);
		}).length;
	});
}

/** The panel's cards, each with its words and its top. */
function cardsSeen(page: Page): Promise<{ text: string; top: number }[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll('[data-panel="positions"] [data-card]')].map((c) => ({
			text: (c as HTMLElement).innerText,
			top: Math.round(c.getBoundingClientRect().top)
		}))
	);
}

async function shootPanel(page: Page, theme: Theme, width: Width, where: string): Promise<void> {
	const cards = await cardsSeen(page);
	if (cards.length === 0) {
		fault(where, 'no position cards');
		return;
	}
	if (width === 390 && new Set(cards.map((c) => c.top)).size > 1) {
		fault(where, 'the closed panel is more than one row of cards');
	}
	for (const c of cards) {
		if (!/rank \d+ of \d+|--/i.test(c.text)) fault(where, `a card without its rank: ${c.text}`);
	}
	const seasonText = cards.map((c) => c.text).join('|');
	// The weakest card with a free agent opens: the walk's "where am I weak, and who is free there".
	const opener = page.locator('[data-panel="positions"] [data-card] button.card-head');
	const list = page.locator('[data-panel="positions"] [data-list]');
	const free = list.locator('[data-free]');
	let listed = false;
	for (const at of weakestFirst(cards)) {
		await opener.nth(at).click();
		await list.waitFor({ timeout: READY_TIMEOUT_MS });
		if ((await free.count()) > 0) {
			listed = true;
			break;
		}
	}
	if (!listed) fault(where, 'no card lists a free agent');
	else if ((await free.first().getByRole('button', { name: LINES.add }).count()) === 0) {
		fault(where, 'a free agent on the open card has no Add');
	}
	await check(page, `${where} open`);
	// The tap scrolled the phone's row to the card; the shot shows it from its start, as a member lands.
	await page.evaluate(() =>
		document.querySelector('[data-panel="positions"] .row')?.scrollTo(0, 0)
	);
	await page.screenshot({
		path: new URL(`after-${theme}-${String(width)}-open.png`, out).pathname
	});
	await page
		.locator('[data-panel="positions"]')
		.getByRole('button', { name: PANEL.week, exact: true })
		.click();
	const weekText = (await cardsSeen(page)).map((c) => c.text).join('|');
	if (weekText === seasonText) fault(where, 'This week leaves the cards as they were');
	await page.screenshot({
		path: new URL(`after-${theme}-${String(width)}-week.png`, out).pathname
	});
}

/** The cards' indexes, the one ranked lowest first, by "rank n" in its words. */
function weakestFirst(cards: readonly { text: string }[]): number[] {
	const rank = (text: string): number => Number(/rank (\d+)/i.exec(text)?.[1] ?? 0);
	return cards
		.map((_, i) => i)
		.sort((a, b) => rank(cards[b]?.text ?? '') - rank(cards[a]?.text ?? ''));
}

for (const [theme, width] of SHOTS) {
	const ctx = await context(theme, width);
	const page = await ctx.newPage();
	const where = `waivers ${theme} ${String(width)}`;
	await page.goto(`${web}${LEAGUE}/waivers`, { waitUntil: 'networkidle' });
	await page.locator('table.pool').first().waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await check(page, where);
	const stage = panelOn ? 'after' : 'before';
	await page.screenshot({ path: new URL(`${stage}-${theme}-${String(width)}.png`, out).pathname });
	const seen = await rowsInView(page);
	process.stdout.write(`${where}: ${String(seen)} table rows whole on the first screen\n`);
	if (panelOn && width === 1280 && seen < DESK_ROWS) {
		fault(where, `${String(seen)} table rows whole above the fold, under ${String(DESK_ROWS)}`);
	}
	if (panelOn) await shootPanel(page, theme, width, where);
	await ctx.close();
}
await browser.close();
for (const f of faults) process.stderr.write(`FAULT ${f}\n`);
process.exit(faults.length > 0 ? 1 : 0);
