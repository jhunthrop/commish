// Screenshots of the League page's figures (Lane 292) against the fixture API
// (scripts/inseason-fixture/serve.ts) and the built site, in both themes at 1440 and 390: the
// recorded Sleeper league (the Proj gap on the member's score bug, the power panel by position) and
// the ESPN stand-in (the member's start and sit row). It asserts each figure draws with its one
// sentence beside it, the power panel's columns and one row a team, and that the page never scrolls
// sideways. BEFORE=1 takes the same shots with no assertion, for the before set.
//
//   node scripts/league-figures-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API (API_ORIGIN, default
// http://localhost:8799) running on the fixture week's clock (FIXTURE_CLOCK=2026-10-17T17:00:00.000Z).
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import {
	FIXTURE_WEEK_CLOCK,
	installFixtureClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { FIGURE_WORDS } from '../src/lib/league/home/figures.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
/** The fixture's twelve teams, each a row of the power panel. */
const TEAMS = 12;

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/league-figures/', import.meta.url);
const before = process.env.BEFORE === '1';
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);
await mkdir(out, { recursive: true });

const LEAGUES = [
	{ name: 'sleeper', id: FIXTURE_IDS.league, gap: true, power: true, record: false },
	// The ESPN stand-in shows its Sunday afternoon: the member's game has kicked off, so no Proj gap.
	{ name: 'espn', id: FIXTURE_IDS.espnDone, gap: false, power: true, record: true }
] as const;

const browser = await chromium.launch();
const faults: string[] = [];

async function context(theme: string, width: number): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light'
	});
	await installFixtureClock(ctx, FIXTURE_WEEK_CLOCK);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function visibleText(page: Page, selector: string): Promise<string | null> {
	const node = page.locator(selector).filter({ visible: true }).first();
	return (await node.count()) === 0 ? null : (await node.innerText()).trim();
}

interface Expect {
	gap: boolean;
	power: boolean;
	record: boolean;
}

/** Each figure drawn, or not, as expected, with its sentence beside it; the power panel's shape; no
 * sideways scroll. Cells may be drawn in capitals, so words are matched without case. */
async function check(page: Page, where: string, expect: Expect): Promise<void> {
	const gap = await visibleText(page, '[data-figure="gap"]');
	const gapBasis = await visibleText(page, '[data-basis="gap"]');
	if (expect.gap && !gap?.startsWith(FIGURE_WORDS.gap)) faults.push(`${where}: no Proj gap cell`);
	if (!expect.gap && (gap !== null || gapBasis !== null))
		faults.push(`${where}: a Proj gap after the game kicked off`);
	if (gap !== null && !gapBasis?.startsWith(FIGURE_WORDS.gap))
		faults.push(`${where}: the Proj gap without its sentence`);
	const { power, record } = expect;
	if (power) {
		const rows = await page.locator('[data-figure="power"] tbody tr').count();
		if (rows !== TEAMS) faults.push(`${where}: ${String(rows)} power rows, want ${String(TEAMS)}`);
		const heads = await page.locator('[data-figure="power"] thead th').allInnerTexts();
		if (heads[1]?.trim().toUpperCase() !== FIGURE_WORDS.overall.toUpperCase())
			faults.push(`${where}: power heads ${heads.join(' ')}`);
		const basis = await visibleText(page, '[data-basis="power"]');
		if (!basis?.startsWith('Power ranks')) faults.push(`${where}: power without its sentence`);
	}
	if (record) {
		const row = await visibleText(page, '[data-figure="start-sit"]');
		if (!row?.toLowerCase().includes(FIGURE_WORDS.matched.toLowerCase()))
			faults.push(`${where}: no start and sit row`);
		const basis = await visibleText(page, '[data-basis="start-sit"]');
		if (!basis?.startsWith('Your start and sit'))
			faults.push(`${where}: the record without its sentence`);
	}
	const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	if (wide > 0) faults.push(`${where}: scrolls ${String(wide)} px sideways`);
}

for (const league of LEAGUES) {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await context(theme, width);
			const page = await ctx.newPage();
			await page.goto(`${web}/league/${league.id}`);
			const name = `${league.name}-${theme}-${String(width)}`;
			try {
				await page.locator('section.stand').first().waitFor({ timeout: READY_TIMEOUT_MS });
			} catch {
				faults.push(`${name}: the standings never drew`);
				await page.screenshot({ path: new URL(`${name}-unready.png`, out).pathname });
				await ctx.close();
				continue;
			}
			await page.evaluate(() => document.fonts.ready);
			await page.waitForLoadState('networkidle');
			if (!before) await check(page, name, league);
			await page.screenshot({ path: new URL(`${name}.png`, out).pathname, fullPage: true });
			await ctx.close();
		}
	}
}
await browser.close();

if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(
	`League figures: ${before ? 'before set taken' : 'every figure drawn with its sentence'}.\n`
);
