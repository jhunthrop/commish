// Screenshots a page in both themes at the desktop, tablet and phone widths, into screenshots/
// (git-ignored), and asserts at each that the page never scrolls sideways (the document's scroll
// width within the viewport). Exits non-zero when any width scrolls.
// Usage: npm run screenshots -- <url> [name]. Run against `npm run preview`.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
/** The desk, a small laptop or an iPad in landscape, two iPad portrait widths and the phone. */
const WIDTHS = [1440, 1024, 800, 768, 390] as const;
const VIEWPORT_HEIGHT = 900;
const OUT_DIR = new URL('../screenshots/', import.meta.url);

const [url, name = 'page'] = process.argv.slice(2);

if (!url) {
	throw new Error('Usage: npm run screenshots -- <url> [name]');
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const scrolls: string[] = [];
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
			const wide = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth
			}));
			if (wide.scrollWidth > wide.innerWidth) {
				scrolls.push(
					`${theme} ${String(width)}: scrollWidth ${String(wide.scrollWidth)} > ${String(wide.innerWidth)}`
				);
			}
			const file = new URL(`${name}-${theme}-${String(width)}.png`, OUT_DIR);
			await page.screenshot({ path: file.pathname, fullPage: true });
			await context.close();
			process.stdout.write(`${file.pathname} scrollWidth ${String(wide.scrollWidth)}\n`);
		}
	}
} finally {
	await browser.close();
}
if (scrolls.length > 0) {
	throw new Error(`${url} scrolls sideways:\n${scrolls.join('\n')}`);
}
