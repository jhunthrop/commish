// Draws the installable app's icons from the mark (src/lib/ui/mark.ts): the whistle in its dark
// colours on the dark page colour, as PNGs into static/icons/. The "any" icons give the whistle most
// of the square; the maskable one keeps it inside the centre 60 % a launcher's mask never cuts.
// Usage: node scripts/app-icons.ts   (rerun when the mark changes, and commit the PNGs)
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { APP_COLORS, APP_ICONS } from '../src/lib/site/app-manifest.ts';
import { MARK_COLORS, markSizeFor, markSvg } from '../src/lib/ui/mark.ts';

const STATIC = new URL('../static/', import.meta.url);
/** The share of the icon's side the whistle's length spans (the reference app icon's). */
const FULL_SCALE = 0.7;
/** The maskable icon's: the whistle and its outline inside the centre 60 %. */
const MASKABLE_SCALE = 0.57;

function iconSvg(size: number, scale: number): string {
	const side = markSizeFor(size * scale);
	const offset = (size - side) / 2;
	const mark = markSvg({ ...MARK_COLORS.dark, size: side });
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}"><rect width="100%" height="100%" fill="${APP_COLORS.dark.page}"/><g transform="translate(${String(offset)} ${String(offset)})">${mark}</g></svg>`;
}

const icons = [
	{ ...APP_ICONS.small, scale: FULL_SCALE },
	{ ...APP_ICONS.large, scale: FULL_SCALE },
	{ ...APP_ICONS.maskable, scale: MASKABLE_SCALE },
	{ ...APP_ICONS.appleTouch, scale: FULL_SCALE }
];
await mkdir(new URL('icons/', STATIC), { recursive: true });
const browser = await chromium.launch();
try {
	for (const icon of icons) {
		const size = Number(icon.sizes.split('x')[0]);
		const page = await browser.newPage({ viewport: { width: size, height: size } });
		await page.setContent(`<body style="margin:0">${iconSvg(size, icon.scale)}</body>`);
		const file = new URL(icon.src.slice(1), STATIC);
		await page.locator('svg').first().screenshot({ path: file.pathname, omitBackground: false });
		await page.close();
		process.stdout.write(`${file.pathname}\n`);
	}
} finally {
	await browser.close();
}
