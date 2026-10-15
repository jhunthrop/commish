// The offline shell, proved in a browser and screenshot in both themes at 1440 and 390: open the
// board online (the service worker installs and keeps the offline page), cut the network, open two
// pages this browser never loaded (the record, the account) and screenshot what answers. Fails
// unless the offline page answers both with the board's rows, and unless the worker's cache holds
// the offline page alone. (A page the browser did load is the browser's own HTTP cache's to answer.)
//
//   npm run build && PORT=<free port> npm run preview:static, then
//   node scripts/offline-shots.ts http://localhost:<port> [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { OFFLINE_PATH, SHELL_CACHE_PREFIX } from '../src/lib/site/offline.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 20_000;
const OFFLINE_SENTENCE = "You're offline";

const [origin, outArg] = process.argv.slice(2);
if (!origin) throw new Error('Usage: node scripts/offline-shots.ts <origin> [out dir]');
const out = new URL(
	outArg ? `file://${outArg.replace(/\/?$/, '/')}` : '../screenshots/offline/',
	import.meta.url
);

/** Every URL the worker's caches hold. */
function cachedUrls(): Promise<string[]> {
	return caches.keys().then(async (names) => {
		const urls: string[] = [];
		for (const name of names) {
			const cache = await caches.open(name);
			for (const request of await cache.keys()) urls.push(`${name} ${request.url}`);
		}
		return urls;
	});
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const failures: string[] = [];
try {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const context = await browser.newContext({
				viewport: { width, height: VIEWPORT_HEIGHT },
				colorScheme: theme
			});
			await context.addInitScript(
				([key, value]: readonly [string, string]) => {
					localStorage.setItem(key, value);
				},
				[THEME_STORAGE_KEY, theme] as const
			);
			const page = await context.newPage();
			await page.goto(`${origin}/board`, { waitUntil: 'load' });
			await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
			await page.waitForFunction(
				(prefix) => caches.keys().then((names) => names.some((name) => name.startsWith(prefix))),
				SHELL_CACHE_PREFIX,
				{ timeout: READY_TIMEOUT_MS }
			);
			const held = await page.evaluate(cachedUrls);
			if (held.length !== 1 || !held[0]?.endsWith(OFFLINE_PATH)) {
				failures.push(`${theme} ${String(width)}: the cache holds ${held.join(', ')}`);
			}
			await context.setOffline(true);
			for (const path of ['/record', '/account']) {
				await page.goto(`${origin}${path}`, { waitUntil: 'load' });
				const text = await page.locator('main').innerText();
				const rows = await page.locator('tbody tr').count();
				if (!text.includes(OFFLINE_SENTENCE) || rows === 0) {
					failures.push(`${theme} ${String(width)} ${path}: offline answered without the board`);
				}
				const name = path.slice(1);
				const file = new URL(`offline-${name}-${theme}-${String(width)}.png`, out);
				await page.screenshot({
					path: file.pathname,
					fullPage: width === WIDTHS[0]
				});
				process.stdout.write(`${file.pathname} rows ${String(rows)}\n`);
			}
			await context.close();
		}
	}
} finally {
	await browser.close();
}
if (failures.length > 0) throw new Error(failures.join('\n'));
process.stdout.write(
	`The offline shell answered every page in both themes; the cache held ${OFFLINE_PATH} alone.\n`
);
