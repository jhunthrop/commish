// Draws the iOS app icon from the mark (web/src/lib/ui/mark.ts, its one home): the whistle in its dark
// colours on the dark page colour, as the web's installable app draws it (web/scripts/app-icons.ts),
// one 1024 px square for the asset catalog's single-size icon. The App Store refuses an icon with an
// alpha channel, so it is drawn opaque and written through sips as a PNG without one.
// Usage: node apps/ios/scripts/app-icon.ts   (rerun when the mark changes, and commit the PNG)
// Needs the web's dependencies (npm ci in web/) for Playwright's Chromium. macOS only (sips).
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_COLORS } from '../../../web/src/lib/site/app-manifest.ts';
import { MARK_COLORS, markSizeFor, markSvg } from '../../../web/src/lib/ui/mark.ts';

const SIDE = 1024;
/** The share of the icon's side the whistle's length spans, the web's "any" icons' share. */
const SCALE = 0.7;
const OUT = new URL('../Commish/Assets.xcassets/AppIcon.appiconset/AppIcon.png', import.meta.url);

export function iconSvg(): string {
	const side = markSizeFor(SIDE * SCALE);
	const offset = (SIDE - side) / 2;
	const mark = markSvg({ ...MARK_COLORS.dark, size: side });
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(SIDE)}" height="${String(SIDE)}" viewBox="0 0 ${String(SIDE)} ${String(SIDE)}"><rect width="100%" height="100%" fill="${APP_COLORS.dark.page}"/><g transform="translate(${String(offset)} ${String(offset)})">${mark}</g></svg>`;
}

async function main(): Promise<void> {
	// Playwright lives in the web's node_modules.
	const web = createRequire(new URL('../../../web/package.json', import.meta.url));
	const { chromium } = web('playwright') as typeof import('playwright');
	const work = await mkdtemp(join(tmpdir(), 'commish-app-icon-'));
	const jpeg = join(work, 'icon.jpg');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: SIDE, height: SIDE } });
		await page.setContent(`<body style="margin:0">${iconSvg()}</body>`);
		await page.locator('svg').first().screenshot({ path: jpeg, type: 'jpeg', quality: 100 });
	} finally {
		await browser.close();
	}
	execFileSync('sips', ['-s', 'format', 'png', jpeg, '--out', OUT.pathname], { stdio: 'ignore' });
	await rm(work, { recursive: true, force: true });
	process.stdout.write(`${OUT.pathname}\n`);
}

if (import.meta.main) await main();
