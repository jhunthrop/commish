// Screenshots of a followed league's pages with the rail as their one navigation (Lane 66r): League,
// Lineup, Matchup, Waivers and Trades on the fixture league, dark and light at 1440 and 390, against
// the fixture API (scripts/inseason-fixture/serve.ts) and the built site. Each asserts no pill strip
// under the league's title, that the rail shows its phase's items in order (on the phone the five,
// League first, every league page among them), that the page's own item is the one lit, that each
// league item opens this league's page, and that nothing scrolls sideways. Then the playoffs, with
// waivers running and closed: the phone's five still reach every screen the phase has. Exits non-zero
// on any fault.
//
//   node scripts/league-rail-shots.ts [web origin] [out dir, from scripts/]
// with the site built against PUBLIC_API_URL=http://localhost:8799 and the fixture API running there.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { RAIL_FOOT, railHref, type RailKey } from '../src/lib/ui/nav.ts';
import { railOfKey } from '../src/lib/ui/rail-order.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { PHASE_COOKIE, type FixturePhase } from './inseason-fixture/phases.ts';
import { installFixtureApiClock, requireFixtureClock } from './inseason-fixture/clock.ts';

const THEMES = ['dark', 'light'] as const;
const WIDTHS = [1440, 390] as const;
const PHONE_MAX = 760;
const VIEWPORT_HEIGHT = 900;
const PHONE_HEIGHT = 844;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };

const web = process.argv[2] ?? 'http://localhost:4196';
/** The fixture API the site was built against, on the fixture week's clock (FIXTURE_CLOCK=
 * 2026-10-17T17:00:00.000Z): the browser runs at its instant, never the day the script runs. */
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);
const out = new URL(process.argv[3] ?? '../screenshots/league-rail/', import.meta.url);
const id = FIXTURE_IDS.league;

/** Each page of the league, the rail item it lights and a line it draws once read. */
const PAGES = [
	{ name: 'league', path: `/league/${id}`, lit: 'League', ready: 'Set your lineup' },
	{ name: 'lineup', path: `/league/${id}/start`, lit: 'Lineup', ready: 'Copy the lineup' },
	{ name: 'matchup', path: `/league/${id}/matchup`, lit: 'Matchup', ready: 'Week 6' },
	{ name: 'waivers', path: `/league/${id}/waivers`, lit: 'Waivers', ready: 'Open Sleeper waivers' },
	{ name: 'trades', path: `/league/${id}/trades`, lit: 'Trades', ready: 'Our ideas' }
] as const;

/** The playoffs, whose phone rail must still reach every screen: each fixture phase, the rail it
 * shows and its league. */
const PLAYOFFS: readonly (readonly [FixturePhase, RailKey, string])[] = [
	['playoffs', 'playoffs_waivers', FIXTURE_IDS.playoffs],
	['playoffs_closed', 'playoffs', FIXTURE_IDS.playoffsClosed]
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

async function context(theme: string, width: number, phase: FixturePhase): Promise<BrowserContext> {
	const phone = width <= PHONE_MAX;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? PHONE_HEIGHT : VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: phone ? 2 : 1
	});
	await installFixtureApiClock(ctx, API_ORIGIN);
	const cookies = [SIGNED_IN, { name: PHASE_COOKIE, value: phase }];
	await ctx.addCookies(cookies.map((cookie) => ({ ...cookie, domain: 'localhost', path: '/' })));
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	// No live provider: faces come from the headshot route, left unanswered here.
	await ctx.route('**/img/**', (route) => route.abort());
	return ctx;
}

async function settle(page: Page, key: RailKey, ready: string | null): Promise<void> {
	await page.waitForFunction(
		(want) => document.documentElement.getAttribute('data-rail') === want,
		key,
		{ timeout: READY_TIMEOUT_MS }
	);
	if (ready !== null) {
		await page
			.getByText(ready)
			.filter({ visible: true })
			.first()
			.waitFor({ timeout: READY_TIMEOUT_MS });
	}
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

interface Shown {
	label: string;
	href: string;
	current: boolean;
}

/** The rail's items as drawn, top to bottom (left to right on a phone). */
function shownItems(page: Page): Promise<Shown[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll<HTMLAnchorElement>('nav.rail a.item')]
			.filter((item) => item.getBoundingClientRect().width > 0)
			.map((item) => ({
				label: item.innerText.trim(),
				href: item.getAttribute('href') ?? '',
				current: item.getAttribute('aria-current') === 'page'
			}))
	);
}

/** The rail a key shows at a width, with each item's page for the selected league. */
function wanted(key: RailKey, phone: boolean, league: string): { label: string; href: string }[] {
	const items = railOfKey(key).filter((item) => !phone || !item.wideOnly);
	return [...items, ...(phone ? [] : [RAIL_FOOT])].map((item) => ({
		label: item.label,
		href: railHref(item, league)
	}));
}

/** What the rail and the page draw wrong: the strip, the rail's items, its lit item, a sideways
 * scroll. */
async function railFaults(
	page: Page,
	where: string,
	key: RailKey,
	width: number,
	league: string,
	lit: string | null
): Promise<void> {
	const phone = width <= PHONE_MAX;
	const strip = await page
		.locator('main nav.tabs, main [aria-label="Your league\'s pages"]')
		.count();
	if (strip > 0) faults.push(`${where}: the pill strip is still drawn`);
	const shown = await shownItems(page);
	const want = wanted(key, phone, league);
	const got = shown.map(({ label, href }) => ({ label, href }));
	if (JSON.stringify(got) !== JSON.stringify(want)) {
		faults.push(
			`${where}: the rail shows ${got.map((g) => `${g.label} ${g.href}`).join(', ')}, not ${want
				.map((w) => `${w.label} ${w.href}`)
				.join(', ')}`
		);
	}
	const current = shown.filter((item) => item.current).map((item) => item.label);
	if (lit !== null && JSON.stringify(current) !== JSON.stringify([lit])) {
		faults.push(`${where}: the rail lights ${current.join(', ') || 'nothing'}, not ${lit}`);
	}
	const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
	if (wide) faults.push(`${where}: scrolls sideways`);
}

function file(name: string): string {
	return new URL(`${name}.png`, out).pathname;
}

for (const { name, path, lit, ready } of PAGES) {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const where = `${name} ${theme} ${String(width)}`;
			const ctx = await context(theme, width, 'in_season');
			const page = await ctx.newPage();
			try {
				await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
				await settle(page, 'in_season', ready);
				await railFaults(page, where, 'in_season', width, id, lit);
				await page.screenshot({ path: file(`${name}-${theme}-${String(width)}`) });
			} catch (error: unknown) {
				faults.push(`${where}: ${String(error)}`);
			} finally {
				await ctx.close();
			}
		}
	}
}

for (const [phase, key, league] of PLAYOFFS) {
	const where = `${phase} dark 390`;
	const ctx = await context('dark', 390, phase);
	const page = await ctx.newPage();
	try {
		await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
		await settle(page, key, null);
		await railFaults(page, where, key, 390, league, null);
		await page.screenshot({ path: file(`rail-${phase}-dark-390`) });
	} catch (error: unknown) {
		faults.push(`${where}: ${String(error)}`);
	} finally {
		await ctx.close();
	}
}

await browser.close();
for (const fault of faults) process.stdout.write(`FAULT ${fault}\n`);
process.stdout.write(`${String(faults.length)} faults\n`);
process.exit(faults.length === 0 ? 0 : 1);
