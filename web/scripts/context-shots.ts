// Screenshots and measurements of the league as the site's context (Lane 15), against a local api
// with COMPANION_REPLAY on and FFPC_BASE_URL at the stand-in (api/tools/ffpcfake), in both themes at
// 1440 and 390: the shell's switch closed and open, signed out, with one league and with three, on
// the board; then the player page, the league page and the rail's Leagues on the phone with three.
// It prints the layout shift a league switch makes on the board (every entry, input or not) and the
// taps a switch takes.
//
//   node scripts/context-shots.ts [web origin] [out dir]
//
// ONE and THREE are session:csrf pairs from `go run ./tools/roommeasure session -handle <name>` in
// api/. ONE follows the recorded Sleeper league; THREE (a Membership) follows it, the recorded
// MyFantasyLeague league and the stand-in's FFPC league.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 60_000;
/** The switch's button and its menu (LeagueSwitch). */
const SWITCH = 'button[aria-controls="league-menu"]';
const MENU = '#league-menu';
/** A player the recorded leagues hold, for the player page's mark. */
const HELD_PLAYER = '/players/puka-nacua';
/** Layout shift entries arrive after the frame that made them: wait this long before reading. */
const SHIFT_SETTLE_MS = 1_000;

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/context/', import.meta.url);

interface Drafter {
	session: string;
	csrf: string;
}

function drafter(name: string): Drafter {
	const [session = '', csrf = ''] = (process.env[name] ?? '').split(':');
	if (!session || !csrf) throw new Error(`${name} is required as session:csrf`);
	return { session, csrf };
}

const who: Record<'out' | 'one' | 'three', Drafter | null> = {
	out: null,
	one: drafter('ONE'),
	three: drafter('THREE')
};

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number, as: Drafter | null): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light'
	});
	if (as) {
		await ctx.addCookies([
			{ name: 'commish_session', value: as.session, domain: 'localhost', path: '/' },
			{ name: 'commish_csrf', value: as.csrf, domain: 'localhost', path: '/' }
		]);
	}
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

/** Opens the switch once the page is live: a tap before hydration does nothing, so it taps until
 * the menu says it is open. Counts as the one tap a reader makes. */
async function openSwitch(page: Page): Promise<void> {
	const button = page.locator(SWITCH);
	for (let tries = 0; tries < 20; tries += 1) {
		if ((await button.getAttribute('aria-expanded')) === 'true') break;
		await button.click();
		await page.waitForTimeout(250);
	}
	await page.locator(MENU).locator('.menu').waitFor({ timeout: READY_TIMEOUT_MS });
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready);
}

async function save(page: Page, name: string, full: boolean): Promise<void> {
	const file = new URL(`${name}.png`, out);
	await page.screenshot({ path: file.pathname, fullPage: full });
	process.stdout.write(`${file.pathname}\n`);
}

/** The switch closed (the whole page) and open (the first screen), for one account. */
async function shootSwitch(state: keyof typeof who, ready: string): Promise<void> {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await context(theme, width, who[state]);
			const page = await ctx.newPage();
			await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
			await page.locator(SWITCH).getByText(ready).waitFor({ timeout: READY_TIMEOUT_MS });
			await settle(page);
			await save(page, `board-${state}-closed-${theme}-${String(width)}`, false);
			await openSwitch(page);
			await settle(page);
			await save(page, `board-${state}-open-${theme}-${String(width)}`, false);
			await ctx.close();
		}
	}
}

/** One page for the three-league account, in both themes at both widths. */
async function shootPage(
	name: string,
	path: string,
	ready: string,
	act?: (page: Page) => Promise<void>
): Promise<void> {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await context(theme, width, who.three);
			const page = await ctx.newPage();
			await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
			await page
				.getByText(ready)
				.filter({ visible: true })
				.first()
				.waitFor({ timeout: READY_TIMEOUT_MS });
			if (act) await act(page);
			await settle(page);
			await save(page, `${name}-${theme}-${String(width)}`, act === undefined);
			await ctx.close();
		}
	}
}

/** Every layout shift on the board while the three-league account switches league, then to a
 * format: the sum, and the sum of the entries not excused by a recent tap (what CLS counts). */
async function measureSwitch(): Promise<void> {
	for (const width of WIDTHS) {
		const ctx = await context('light', width, who.three);
		const page = await ctx.newPage();
		await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
		await page
			.locator(SWITCH)
			.getByText('Big Gorilla', { exact: false })
			.waitFor({ timeout: READY_TIMEOUT_MS });
		await settle(page);
		await page.waitForTimeout(SHIFT_SETTLE_MS);
		// Every shift since the load began (the observer's buffer), then only what comes after.
		await page.evaluate(() => {
			const store = window as unknown as { shifts: { value: number; input: boolean }[] };
			store.shifts = [];
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries() as unknown as {
					value: number;
					hadRecentInput: boolean;
				}[]) {
					store.shifts.push({ value: entry.value, input: entry.hadRecentInput });
				}
			}).observe({ type: 'layout-shift', buffered: true });
		});
		const read = async (): Promise<{ all: number; counted: number }> => {
			await page.waitForTimeout(SHIFT_SETTLE_MS);
			return page.evaluate(() => {
				const { shifts } = window as unknown as { shifts: { value: number; input: boolean }[] };
				const sum = (list: { value: number }[]): number => list.reduce((s, e) => s + e.value, 0);
				const result = { all: sum(shifts), counted: sum(shifts.filter((e) => !e.input)) };
				shifts.length = 0;
				return result;
			});
		};
		const load = await read();
		let taps = 0;
		await openSwitch(page);
		taps += 1;
		await page.locator(MENU).getByText('S.U.C.K.', { exact: false }).click();
		taps += 1;
		await page.locator(SWITCH).getByText('S.U.C.K.', { exact: false }).waitFor();
		await settle(page);
		const league = await read();
		await openSwitch(page);
		// The menu offers the boards the run carries: the stand-in carries PPR alone.
		await page.locator(MENU).getByRole('button', { name: 'PPR', exact: true }).click();
		await page.locator(SWITCH).getByText('PPR', { exact: true }).waitFor();
		await settle(page);
		const format = await read();
		process.stdout.write(
			`at ${String(width)}: load shift ${load.all.toFixed(4)}; switch ${String(taps)} taps; league to league shift ${league.all.toFixed(4)} (counted ${league.counted.toFixed(4)}); league to a format ${format.all.toFixed(4)} (counted ${format.counted.toFixed(4)})\n`
		);
		// Put the account back on its newest league for the next run.
		await openSwitch(page);
		await page.locator(MENU).getByText('Big Gorilla', { exact: false }).click();
		await settle(page);
		await ctx.close();
	}
}

await shootSwitch('out', 'PPR');
await shootSwitch('one', 'S.U.C.K.');
await shootSwitch('three', 'Big Gorilla');
await shootPage('player-three', HELD_PLAYER, 'Your league scores');
await shootPage('league-three', '/board', 'Big Gorilla', async (page) => {
	await openSwitch(page);
	await page.locator(MENU).getByText('page', { exact: false }).first().click();
	await page
		.getByText('Waiver pool')
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
});
await measureSwitch();
await browser.close();
