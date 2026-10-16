// Screenshots of the shell's rail in every season phase (spec 2026-10-16 §2, §5), against the fixture
// API (scripts/inseason-fixture/serve.ts, phases.ts) and the built site, in both themes at 1440 and
// 390: the board with each phase's league selected, and signed out. Each asserts the root names the
// phase's rail, that the rail shows exactly that rail's items in order (the phone's five), that a
// second page shows it before its own script runs (the session copy, no flash), and that no page
// scrolls sideways. Then the switch's menu open with leagues in every phase, and with one league.
//
//   node scripts/rail-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL=http://localhost:8799 and the fixture API running there.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { RAIL_KEYS, type RailKey } from '../src/lib/ui/nav.ts';
import { railFor } from '../src/lib/ui/rail-order.ts';
import {
	FIXTURE_PHASES,
	ONE_COOKIE,
	PHASE_COOKIE,
	type FixturePhase
} from './inseason-fixture/phases.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const PHONE_MAX = 760;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };

const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? '../screenshots/rails/', import.meta.url);

/** The rail each fixture phase's league selects. */
const KEY_OF: Readonly<Record<FixturePhase, RailKey>> = {
	pre_draft: 'pre_draft',
	draft_day: 'draft_day',
	in_season: 'in_season',
	playoffs: 'playoffs_waivers',
	playoffs_closed: 'playoffs',
	offseason: 'offseason'
};

function railLabels(key: RailKey, phone: boolean): string[] {
	const items = key === 'playoffs_waivers' ? railFor('playoffs', true) : railFor(key, false);
	const shown = phone ? items.filter((item) => !item.wideOnly) : items;
	return [...shown.map((item) => item.label), ...(phone ? [] : ['Account'])];
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const failures: string[] = [];

async function context(
	theme: string,
	width: number,
	cookies: { name: string; value: string }[]
): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light'
	});
	await ctx.addCookies(cookies.map((cookie) => ({ ...cookie, domain: 'localhost', path: '/' })));
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

/** The rail's labels as drawn, top to bottom (left to right on a phone). */
function shownLabels(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('nav.rail .item')]
			.filter((item) => item.offsetParent !== null || getComputedStyle(item).display !== 'none')
			.filter((item) => item.getBoundingClientRect().width > 0)
			.map((item) => item.innerText.trim())
	);
}

async function check(page: Page, where: string, key: RailKey, width: number): Promise<void> {
	const rail = await page.evaluate(() => document.documentElement.getAttribute('data-rail'));
	if (rail !== key) failures.push(`${where}: the root names ${String(rail)}, not ${key}`);
	const want = railLabels(key, width <= PHONE_MAX);
	const got = await shownLabels(page);
	if (JSON.stringify(got) !== JSON.stringify(want)) {
		failures.push(`${where}: the rail shows ${got.join(', ')}, not ${want.join(', ')}`);
	}
	const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
	if (wide) failures.push(`${where}: scrolls sideways`);
}

function file(name: string): string {
	return new URL(`${name}.png`, out).pathname;
}

async function settle(page: Page, key: RailKey): Promise<void> {
	await page.waitForFunction(
		(want) => document.documentElement.getAttribute('data-rail') === want,
		key,
		{ timeout: READY_TIMEOUT_MS }
	);
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

for (const phase of FIXTURE_PHASES) {
	const key = KEY_OF[phase];
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const where = `${phase} ${theme} ${String(width)}`;
			const ctx = await context(theme, width, [SIGNED_IN, { name: PHASE_COOKIE, value: phase }]);
			const page = await ctx.newPage();
			await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
			await settle(page, key);
			await check(page, where, key, width);
			await page.screenshot({ path: file(`rail-${phase}-${theme}-${String(width)}`) });
			// The next page reads the session copy before its own script: the rail is right at once.
			await page.goto(`${web}/players`, { waitUntil: 'commit' });
			await page.waitForSelector('nav.rail', { state: 'attached' });
			const first = await page.evaluate(() => document.documentElement.getAttribute('data-rail'));
			if (first !== key) failures.push(`${where}: the next page painted ${String(first)} first`);
			await ctx.close();
		}
	}
}

/** Signed out in season: the in-season five, each opening the follow page. */
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const where = `signed out ${theme} ${String(width)}`;
		const ctx = await context(theme, width, []);
		const page = await ctx.newPage();
		await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
		const site = await page.evaluate(() => document.documentElement.getAttribute('data-rail'));
		const key = RAIL_KEYS.find((candidate) => candidate === site) ?? 'pre_draft';
		await settle(page, key);
		await check(page, where, key, width);
		await page.screenshot({ path: file(`rail-signed-out-${theme}-${String(width)}`) });
		await ctx.close();
	}
}

/** The switch's menu: leagues in every phase say theirs, one league says none. */
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		for (const one of [false, true]) {
			const cookies = [SIGNED_IN, { name: PHASE_COOKIE, value: 'in_season' }];
			if (one) cookies.push({ name: ONE_COOKIE, value: '1' });
			const ctx = await context(theme, width, cookies);
			const page = await ctx.newPage();
			await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
			await settle(page, 'in_season');
			await page.locator('.switch .face').click();
			await page.locator('#league-menu .foot').waitFor({ timeout: READY_TIMEOUT_MS });
			await page.waitForLoadState('networkidle');
			const name = one ? 'menu-one' : 'menu-phases';
			await page.screenshot({ path: file(`${name}-${theme}-${String(width)}`) });
			await ctx.close();
		}
	}
}

await browser.close();
process.stdout.write(`shots in ${out.pathname}\n`);
if (failures.length > 0) throw new Error(`Rails:\n${failures.join('\n')}`);
process.stdout.write(
	'Every rail shows its phase, the next page paints it first, and nothing scrolls sideways.\n'
);
