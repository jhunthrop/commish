// The app's sign-in landing (Lane 172), screenshot in both themes at 1280 and 390, opened the way
// the API sends an app back to it: with a pairing code and the client in the query. Fails if the
// code reaches the page's text or HTML. The page is static, so no clock is read.
//
//   npm run build && PORT=<free port> npm run preview:static, then
//   node scripts/app-signed-in-shots.ts http://localhost:<port> [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { APP_SIGNED_IN_PATH, OPEN_APP } from '../src/lib/site/app-words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const VIEWPORT_HEIGHT = 844;
const CODE = 'acorn amber anchor apple arch atlas';

const [origin, outArg] = process.argv.slice(2);
if (!origin) throw new Error('Usage: node scripts/app-signed-in-shots.ts <origin> [out dir]');
const out = new URL(
	outArg ? `file://${outArg.replace(/\/?$/, '/')}` : '../screenshots/app-signed-in/',
	import.meta.url
);

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
			const query = new URLSearchParams({ code: CODE, client: 'ios' }).toString();
			await page.goto(`${origin}${APP_SIGNED_IN_PATH}?${query}`, { waitUntil: 'load' });
			const html = await page.content();
			const text = await page.locator('main').innerText();
			if (!text.includes(OPEN_APP)) failures.push(`${theme} ${String(width)}: no "${OPEN_APP}"`);
			for (const form of [CODE, encodeURIComponent(CODE), CODE.replaceAll(' ', '+')]) {
				if (html.includes(form))
					failures.push(`${theme} ${String(width)}: the code is on the page`);
			}
			const file = new URL(`app-signed-in-${theme}-${String(width)}.png`, out);
			await page.screenshot({ path: file.pathname, fullPage: true });
			process.stdout.write(`${file.pathname}\n`);
			await context.close();
		}
	}
} finally {
	await browser.close();
}
if (failures.length > 0) throw new Error(failures.join('\n'));
