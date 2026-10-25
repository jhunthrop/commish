// Screenshots of the reference pages the apps draw (Lane 199): ADP, Compare with two players, Compare
// with one side a slug the run does not name, the clubs, a club and the strength of schedule, signed
// out, in both themes at 390, for the persona panel to read beside the apps' snapshots. Each asserts
// the page has no sideways scroll beyond its own grid.
//
//   node scripts/reference-shots.ts [web origin] [out dir]
// with the site built (npm run standin && npm run build) and served (npm run preview:static).
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTH = 390;
const VIEWPORT_HEIGHT = 844;
const SETTLE_MS = 1_500;
const PAGES = [
	{ name: 'adp', path: '/adp/ppr-12' },
	{ name: 'compare-two', path: '/compare?a=ja-marr-chase&b=rome-odunze' },
	{ name: 'compare-absent', path: '/compare?a=ja-marr-chase&b=nobody' },
	{ name: 'clubs', path: '/clubs' },
	{ name: 'club', path: '/clubs/cin' },
	{ name: 'schedule', path: '/schedule' }
] as const;

const web = process.argv[2] ?? 'http://localhost:4199';
const out = new URL(process.argv[3] ?? '../screenshots/reference/', import.meta.url);

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const failures: string[] = [];
for (const theme of THEMES) {
	const ctx = await browser.newContext({
		viewport: { width: WIDTH, height: VIEWPORT_HEIGHT },
		colorScheme: theme
	});
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	for (const page of PAGES) {
		const tab = await ctx.newPage();
		const response = await tab.goto(`${web}${page.path}`, { waitUntil: 'networkidle' });
		if (!response?.ok()) failures.push(`${page.path} answered ${String(response?.status())}`);
		await tab.waitForTimeout(SETTLE_MS);
		const wide = await tab.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
		if (wide) failures.push(`${page.path} scrolls sideways at ${String(WIDTH)} (${theme})`);
		await tab.screenshot({
			path: new URL(`${page.name}-${String(WIDTH)}-${theme}.png`, out).pathname
		});
		await tab.close();
	}
	await ctx.close();
}
await browser.close();
if (failures.length > 0) throw new Error(`Reference pages:\n${failures.join('\n')}`);
