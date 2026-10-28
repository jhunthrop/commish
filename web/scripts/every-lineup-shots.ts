// Screenshots of every league's Lineup on one page (Lane 257, B262): /league for a member with four
// leagues (two ESPN leagues with changes made from here, one of them refused by ESPN, the Sleeper
// league whose changes are the member's to set there, an ESPN league already set), at 1280 and 390,
// light and dark: the page as it lands, the one verb's confirmation and what the moves came to, each
// league saying it in place. Then one league attached opens that league's own Lineup, and none the
// follow page. Every state passes the one copy guard (copy-scan.ts) and nothing scrolls sideways.
// Exits non-zero on any fault.
//
//   node scripts/every-lineup-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API on the week clock
// (FIXTURE_CLOCK=2026-10-17T17:00:00.000Z), as `npm run shots -- every-lineup-shots` runs it.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { EVERY } from '../src/lib/league/inseason/every-lineup.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { FIXTURE_WEEK_CLOCK, requireFixtureClock } from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const web = process.argv[2] ?? 'http://localhost:4291';
const out = new URL(process.argv[3] ?? '../screenshots/every-lineup/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8891').origin;
const WIDTHS = [1280, 390] as const;
const THEMES = ['light', 'dark'] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
/** The veteran's four leagues, in the account's order (serve.ts fixture_attached). */
const FOUR = 'espnDone,espnRefused,league,espnSet';
/** What the moves came to: ESPN set the first league and refused the second. */
const REPORTED = 'Set in 1 league. 1 did not change. Its league says why below.';
const LANDED = 'Changes in 3 of your 4 leagues. 1 more to set on Sleeper yourself.';

await requireFixtureClock(API_ORIGIN, FIXTURE_WEEK_CLOCK);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];
const fault = (at: string, what: string): void => {
	faults.push(`${at}: ${what}`);
};

async function context(
	width: number,
	theme: (typeof THEMES)[number],
	attached: string
): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme,
		deviceScaleFactor: width < 500 ? 2 : 1
	});
	watchData(ctx);
	await ctx.clock.install({ time: new Date(FIXTURE_WEEK_CLOCK) });
	await ctx.addCookies([
		{ ...SIGNED_IN, domain: 'localhost', path: '/' },
		{ name: 'fixture_attached', value: attached, domain: 'localhost', path: '/' }
	]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function holds(page: Page, at: string): Promise<void> {
	await page.evaluate(() => document.fonts.ready);
	if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
		fault(at, 'scrolls sideways');
	const copy = await copyFault(page);
	if (copy !== null) fault(at, copy);
}

async function shoot(page: Page, name: string): Promise<void> {
	await page.screenshot({ path: new URL(`${name}.png`, out).pathname, fullPage: true });
}

/** The panel's line, once it says what is asked. */
async function says(page: Page, words: string, at: string): Promise<void> {
	const line = page.locator('main .call .line').filter({ hasText: words });
	await line.waitFor({ timeout: READY_TIMEOUT_MS }).catch(() => {
		fault(at, `the panel never says "${words}"`);
	});
}

async function walk(width: number, theme: (typeof THEMES)[number]): Promise<void> {
	const ctx = await context(width, theme, FOUR);
	const page = await ctx.newPage();
	const at = `${theme} ${String(width)}`;
	try {
		await page.goto(`${web}/league`);
		await says(page, LANDED, at);
		await page.waitForLoadState('networkidle');
		const blocks = await page.locator('main section.block').count();
		if (blocks !== 4) fault(at, `${String(blocks)} league blocks, not 4`);
		const set = page.locator('main section.block').filter({ hasText: EVERY.set });
		if ((await set.count()) !== 1) fault(at, 'the set league is not one line');
		await holds(page, `${at} landed`);
		await shoot(page, `every-${theme}-${String(width)}`);

		// Tap 2: the one verb plans every league's move and shows each in its league.
		await page.getByRole('button', { name: EVERY.verb }).click();
		await says(page, '2 leagues, each spelled out', at);
		const verbs = await page.getByRole('button', { name: 'Set it on ESPN' }).count();
		if (verbs !== 0) fault(at, `${String(verbs)} league panels carry their own verb while held`);
		await holds(page, `${at} confirm`);
		await shoot(page, `every-confirm-${theme}-${String(width)}`);

		// Tap 3: the confirmation makes each with its own token, and each league says what it came to.
		await page.getByRole('button', { name: 'Set them on ESPN' }).click();
		await says(page, REPORTED, at);
		const main = await page.locator('main').innerText();
		for (const sentence of [
			'Set on ESPN. Your lineup there now reads as ours.',
			'ESPN did not make the move, so nothing changed there.'
		])
			if (!main.includes(sentence)) fault(at, `no league says "${sentence}"`);
		await holds(page, `${at} reported`);
		await shoot(page, `every-reported-${theme}-${String(width)}`);
		process.stdout.write(`${at}: landed, confirmed, reported\n`);
	} catch (error) {
		fault(at, error instanceof Error ? error.message : String(error));
	} finally {
		await ctx.close();
	}
}

/** One league attached opens its own Lineup; none, the follow page. */
async function redirects(attached: string, path: RegExp, name: string): Promise<void> {
	const ctx = await context(390, 'dark', attached);
	const page = await ctx.newPage();
	try {
		await page.goto(`${web}/league`);
		await page.waitForURL(path, { timeout: READY_TIMEOUT_MS });
		await page.waitForLoadState('networkidle');
		await holds(page, name);
		await shoot(page, name);
		process.stdout.write(`${name}: ${new URL(page.url()).pathname}\n`);
	} catch (error) {
		fault(name, error instanceof Error ? error.message : String(error));
	} finally {
		await ctx.close();
	}
}

for (const theme of THEMES) for (const width of WIDTHS) await walk(width, theme);
await redirects('espnDone', new RegExp(`/league/${FIXTURE_IDS.espnDone}/start$`), 'one-league');
await redirects('none', /\/league\/new$/, 'no-league');
await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write('every league: every state holds\n');
