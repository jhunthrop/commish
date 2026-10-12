// Screenshots a page in both themes at the desktop and phone widths, into screenshots/ (git-ignored).
// Usage: npm run screenshots -- <url> [name]. Run against `npm run preview`.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const OUT_DIR = new URL('../screenshots/', import.meta.url);

const [url, name = 'page'] = process.argv.slice(2);

if (!url) {
	throw new Error('Usage: npm run screenshots -- <url> [name]');
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
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
			await page.goto(url, { waitUntil: 'networkidle' });
			await page.evaluate(() => document.fonts.ready);
			const file = new URL(`${name}-${theme}-${width}.png`, OUT_DIR);
			await page.screenshot({ path: file.pathname, fullPage: true });
			await context.close();
			process.stdout.write(`${file.pathname}\n`);
		}
	}
} finally {
	await browser.close();
}
