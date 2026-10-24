// Draws the share cards (Lane 169, ruling 2): one 1200x630 PNG per page family, the mark and the
// family's name on the dark page colour, into static/share/, the files every page's og:image names
// (src/lib/site/head.ts SHARE_CARDS). Same drawing as the app icons (scripts/app-icons.ts): the
// whistle from ui/mark.ts in its dark colours, the UI face from the site's own font package.
// Usage: node scripts/share-cards.ts [extra out dir]   (rerun when the mark or a family's name
// changes, and commit the PNGs; the extra dir gets a copy, for a lane's mocks)
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { APP_COLORS } from '../src/lib/site/app-manifest.ts';
import { SHARE_CARDS, SHARE_CARD_SIZE, SITE_NAME, type ShareCard } from '../src/lib/site/head.ts';
import { SITE_ORIGIN } from '../src/lib/site/origins.ts';
import { MARK_COLORS, markSizeFor, markSvg } from '../src/lib/ui/mark.ts';

const FACE = new URL(
	'../node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2',
	import.meta.url
);
const STATIC = new URL('../static/', import.meta.url);
/** The dark theme's text (tokens.css): the name in the mark's ink, the rule in its accent. */
const INK = {
	strong: MARK_COLORS.dark.ink,
	soft: '#b9b0a7',
	faint: '#8f857c',
	accent: MARK_COLORS.dark.accent
} as const;
/** The whistle's length, in px. */
const MARK_SPAN = 260;

function cardHtml(mark: string, face: string, family: ShareCard): string {
	const { width, height } = SHARE_CARD_SIZE;
	const host = new URL(SITE_ORIGIN).host;
	return `<!doctype html><html><head><style>
@font-face{font-family:Outfit;src:url(data:font/woff2;base64,${face}) format('woff2');font-weight:100 900}
*{margin:0;box-sizing:border-box}
body{width:${String(width)}px;height:${String(height)}px;background:${APP_COLORS.dark.page};font-family:Outfit,sans-serif;color:${INK.strong}}
.card{position:relative;width:100%;height:100%;padding:88px 96px;display:flex;flex-direction:column;justify-content:space-between}
.top{display:flex;align-items:center;gap:56px}
.name{font-size:112px;font-weight:650;letter-spacing:-0.02em;line-height:1}
.family{margin-top:22px;font-size:46px;font-weight:450;color:${INK.soft};line-height:1.15;max-width:640px}
.host{font-size:30px;font-weight:500;color:${INK.faint};letter-spacing:0.01em}
.rule{position:absolute;left:0;right:0;bottom:0;height:14px;background:${INK.accent}}
</style></head><body><div class="card">
<div class="top">${mark}<div><div class="name">${SITE_NAME}</div><div class="family">${SHARE_CARDS[family].name}</div></div></div>
<div class="host">${host}</div><div class="rule"></div></div></body></html>`;
}

const extra = process.argv[2];
const mark = markSvg({ ...MARK_COLORS.dark, size: markSizeFor(MARK_SPAN) });
const face = (await readFile(FACE)).toString('base64');
const outDir = new URL('share/', STATIC);
await mkdir(outDir, { recursive: true });
if (extra) await mkdir(extra, { recursive: true });
const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: SHARE_CARD_SIZE });
	for (const family of Object.keys(SHARE_CARDS) as ShareCard[]) {
		await page.setContent(cardHtml(mark, face, family));
		await page.evaluate(() => document.fonts.ready);
		const file = new URL(SHARE_CARDS[family].path.slice(1), STATIC);
		await page.screenshot({ path: file.pathname });
		if (extra) await copyFile(file, `${extra}/share-${family}.png`);
		process.stdout.write(`${file.pathname}\n`);
	}
} finally {
	await browser.close();
}
