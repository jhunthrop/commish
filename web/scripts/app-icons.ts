// Draws the installable app's icons from the mark (src/lib/assets/favicon.svg): the mark in its dark
// colours on the dark page colour, as PNGs into static/icons/. The "any" icons fill most of the
// square; the maskable one keeps the mark inside the centre 60 % a launcher's mask never cuts.
// Usage: node scripts/app-icons.ts   (rerun when the mark changes, and commit the PNGs)
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { APP_COLORS, APP_ICONS } from '../src/lib/site/app-manifest.ts';

const MARK = new URL('../src/lib/assets/favicon.svg', import.meta.url);
const STATIC = new URL('../static/', import.meta.url);
const MARK_BOX = 32;
/** The share of the icon's side the mark spans. */
const FULL_SCALE = 0.8;
const MASKABLE_SCALE = 0.6;

/** The mark's shapes with its dark-theme fills: the favicon's own media block, chosen once. */
function darkMark(svg: string): string {
	const shapes = /<\/style>([\s\S]*)<\/svg>/.exec(svg)?.[1];
	const dark =
		/prefers-color-scheme:dark\)\{\.ink\{fill:(#[0-9a-f]+)\}\.bar\{fill:(#[0-9a-f]+)\}/.exec(svg);
	if (!shapes || !dark)
		throw new Error('favicon.svg no longer has the shapes and dark fills this reads.');
	return `<style>.ink{fill:${dark[1] ?? ''}}.bar{fill:${dark[2] ?? ''}}</style>${shapes}`;
}

function iconSvg(mark: string, size: number, scale: number): string {
	const side = size * scale;
	const offset = (size - side) / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}"><rect width="100%" height="100%" fill="${APP_COLORS.dark.page}"/><svg x="${String(offset)}" y="${String(offset)}" width="${String(side)}" height="${String(side)}" viewBox="0 0 ${String(MARK_BOX)} ${String(MARK_BOX)}">${mark}</svg></svg>`;
}

const mark = darkMark(await readFile(MARK, 'utf8'));
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
		await page.setContent(`<body style="margin:0">${iconSvg(mark, size, icon.scale)}</body>`);
		const file = new URL(icon.src.slice(1), STATIC);
		await page.locator('svg').first().screenshot({ path: file.pathname, omitBackground: false });
		await page.close();
		process.stdout.write(`${file.pathname}\n`);
	}
} finally {
	await browser.close();
}
