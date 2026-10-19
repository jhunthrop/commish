// Screenshots of Lane 40's polish, in both themes at 1440 and 390: the shell's league switch with a
// long league name (cut at a word, the full name in its accessible name) and a player page whose
// written read is not ready. Prints the switch's text and accessible name.
//
//   node scripts/polish-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL=http://localhost:8799, the in-season fixture API running
// there (scripts/inseason-fixture/serve.ts), and a run whose player UNWRITTEN has no capsule.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { installFixtureApiClock, requireFixtureClock } from './inseason-fixture/clock.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const UNWRITTEN = 'puka-nacua';
const SWITCH = 'button[aria-controls="league-menu"]';
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };

const web = process.argv[2] ?? 'http://localhost:4197';
/** The fixture API the site was built against, on the fixture week's clock (FIXTURE_CLOCK=
 * 2026-10-17T17:00:00.000Z): the browser runs at its instant, never the day the script runs. */
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);
const out = new URL(process.argv[3] ?? '../screenshots/polish/', import.meta.url);

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await browser.newContext({
				viewport: { width, height: VIEWPORT_HEIGHT },
				colorScheme: theme
			});
			await installFixtureApiClock(ctx, API_ORIGIN);
			await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
			await ctx.addInitScript(
				([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
				[THEME_STORAGE_KEY, theme] as const
			);
			const page = await ctx.newPage();
			await page.goto(`${web}/league/${FIXTURE_IDS.league}`, { waitUntil: 'networkidle' });
			const button = page.locator(SWITCH);
			await page.waitForFunction(
				(selector) =>
					(document.querySelector(selector)?.getAttribute('aria-label') ?? '').length > 30,
				SWITCH
			);
			const shown = await button.locator('.words').innerText();
			const name = await button.getAttribute('aria-label');
			process.stdout.write(`${theme} ${String(width)} switch shows "${shown}", name "${name}"\n`);
			await page.screenshot({
				path: new URL(`switch-${theme}-${String(width)}.png`, out).pathname,
				clip: { x: 0, y: 0, width, height: 120 }
			});
			await page.goto(`${web}/players/${UNWRITTEN}`, { waitUntil: 'networkidle' });
			await page.evaluate(() => document.fonts.ready);
			await page.screenshot({
				path: new URL(`unwritten-${theme}-${String(width)}.png`, out).pathname,
				fullPage: true
			});
			const wide = await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth
			);
			if (wide > 0)
				throw new Error(`${theme} ${String(width)} scrolls sideways by ${String(wide)}`);
			await ctx.close();
		}
	}
} finally {
	await browser.close();
}
