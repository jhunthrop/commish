// The whistle on every surface (Lane 170): the rail at 1280 and the phone bar at 390 in both themes,
// against the fixture API and the built site with the browser on the fixture API's clock, and the
// persona gate's mocks drawn from the committed files: the favicon in a tab strip beside three other
// sites' icons, the 192 icon on a dark and a light home screen, and the share unfurl at 600 wide.
// On the shell it asserts the mark's link keeps its name and address, the mark is drawn at its size
// inside its slot (the rail's 56 px, the phone bar's 44 px cell) and nothing scrolls sideways. Exits
// non-zero on any fault.
//
//   node scripts/mark-shots.ts [web origin] [api origin] [out dir]
// with the site built against PUBLIC_API_URL set to the fixture API's origin.
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { APP_COLORS } from '../src/lib/site/app-manifest.ts';
import { SHARE_CARDS, SITE_NAME } from '../src/lib/site/head.ts';
import { SITE_ORIGIN } from '../src/lib/site/origins.ts';
import { HOME_HREF } from '../src/lib/ui/nav.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { installFixtureApiClock } from './inseason-fixture/clock.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
const API_ORIGIN = process.argv[3] ?? 'http://localhost:8799';
const out = new URL(process.argv[4] ?? '../screenshots/mark/', import.meta.url);
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const SCALE = 2;
const VIEWPORT_HEIGHT = 900;
/** The shell's two places for the mark: the page, the link, its slot and the mark's side. */
const PLACES = [
	{ name: 'rail', width: 1280, path: '/board', link: 'nav.rail a.mark', slot: 56, side: 36 },
	{ name: 'bar', width: 390, path: '/terms', link: 'header.top a.home', slot: 44, side: 28 }
] as const;
type Place = (typeof PLACES)[number];

const failures: string[] = [];
const file = (name: string): string => new URL(`${name}.png`, out).pathname;
const STATIC = new URL('../static/', import.meta.url);
const dataUrl = async (url: URL, type: string): Promise<string> =>
	`data:${type};base64,${(await readFile(url)).toString('base64')}`;

async function checkPlace(page: Page, place: Place, where: string): Promise<void> {
	const link = page.locator(place.link);
	if ((await link.getAttribute('aria-label')) !== SITE_NAME) failures.push(`${where}: label`);
	if ((await link.getAttribute('href')) !== HOME_HREF) failures.push(`${where}: href`);
	const slot = await link.boundingBox();
	const mark = await link.locator('svg').boundingBox();
	if (!slot || !mark) {
		failures.push(`${where}: the mark is not drawn`);
		return;
	}
	if (Math.round(slot.height) !== place.slot)
		failures.push(`${where}: slot ${String(slot.height)}`);
	if (Math.round(mark.width) !== place.side) failures.push(`${where}: mark ${String(mark.width)}`);
	const inside =
		mark.x >= slot.x && mark.y >= slot.y && mark.y + mark.height <= slot.y + slot.height + 0.5;
	if (!inside) failures.push(`${where}: the mark leaves its slot`);
	const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
	if (wide) failures.push(`${where}: scrolls sideways`);
}

async function shootShell(browser: Browser): Promise<void> {
	for (const place of PLACES) {
		for (const theme of THEMES) {
			const where = `${place.name} ${theme} ${String(place.width)}`;
			const ctx = await browser.newContext({
				viewport: { width: place.width, height: VIEWPORT_HEIGHT },
				deviceScaleFactor: SCALE,
				colorScheme: theme
			});
			await installFixtureApiClock(ctx, API_ORIGIN);
			await ctx.addInitScript(
				([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
				[THEME_STORAGE_KEY, theme] as const
			);
			const page = await ctx.newPage();
			await page.goto(`${web}${place.path}`, { waitUntil: 'networkidle' });
			await page.evaluate(() => document.fonts.ready);
			await checkPlace(page, place, where);
			await page.screenshot({ path: file(`${place.name}-${theme}-${String(place.width)}`) });
			const crop = place.name === 'rail' ? 'nav.rail' : 'header.top';
			const box = await page.locator(crop).boundingBox();
			if (box) {
				const height = place.name === 'rail' ? Math.min(box.height, 360) : box.height;
				await page.screenshot({
					path: file(`${place.name}-${theme}-${String(place.width)}-close`),
					clip: { x: box.x, y: box.y, width: Math.min(box.width, 390), height }
				});
			}
			process.stdout.write(`${where}\n`);
			await ctx.close();
		}
	}
}

/** A browser tab: its icon at 16 px and its title. */
const tab = (icon: string, title: string, current: boolean): string =>
	`<div class="tab${current ? ' on' : ''}">${icon}<span>${title}</span></div>`;

/** Three other sites' icons, drawn plainly: a letter on a tile, a ring, a square of bars. */
const OTHER_ICONS = [
	'<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#1a73e8"/><text x="8" y="12" font-size="11" font-family="sans-serif" font-weight="700" fill="#fff" text-anchor="middle">N</text></svg>',
	'<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="#e5484d" stroke-width="3"/></svg>',
	'<svg width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#2f9e44"/><rect x="3" y="8" width="2.5" height="5" fill="#fff"/><rect x="6.75" y="5" width="2.5" height="8" fill="#fff"/><rect x="10.5" y="3" width="2.5" height="10" fill="#fff"/></svg>'
] as const;

function tabStrip(favicon: string, theme: Theme): string {
	const dark = theme === 'dark';
	const ours = `<img src="${favicon}" width="16" height="16">`;
	const tabs = [
		tab(OTHER_ICONS[0], 'News', false),
		tab(ours, `Board | ${SITE_NAME}`, true),
		tab(OTHER_ICONS[1], 'Scores', false),
		tab(OTHER_ICONS[2], 'Stats', false)
	].join('');
	return `<div class="strip" style="color-scheme:${theme};background:${dark ? '#202124' : '#dee1e6'};color:${dark ? '#e8eaed' : '#202124'}">${tabs}</div>`;
}

function homeScreen(icon: string, theme: Theme): string {
	const dark = theme === 'dark';
	const apps = ['#1a73e8', '#e5484d', '#2f9e44', '#f59f00', '#7048e8'].map(
		(fill) =>
			`<div class="app"><div class="tile" style="background:${fill}"></div><span>App</span></div>`
	);
	const ours = `<div class="app"><img class="tile" src="${icon}"><span>${SITE_NAME}</span></div>`;
	const tiles = [...apps.slice(0, 2), ours, ...apps.slice(2)].join('');
	return `<div class="home" style="background:${dark ? 'linear-gradient(#1b2a3a,#0b0f14)' : 'linear-gradient(#cfe3f5,#f4efe6)'};color:${dark ? '#fff' : '#111'}">${tiles}</div>`;
}

function unfurl(card: string, theme: Theme): string {
	const dark = theme === 'dark';
	return `<div class="unfurl" style="background:${dark ? '#1a1d21' : '#fff'};color:${dark ? '#d1d2d3' : '#1d1c1d'}"><div class="who">${new URL(SITE_ORIGIN).host}</div><div class="t">${SITE_NAME}: ${SHARE_CARDS.player.name}</div><img src="${card}" width="560"></div>`;
}

const MOCK_STYLE = `<style>
*{margin:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;padding:24px;display:grid;gap:24px;background:#888}
.strip{display:flex;gap:2px;padding:8px 8px 0;width:760px}
.tab{display:flex;align-items:center;gap:8px;padding:9px 12px;width:180px;font-size:12px;border-radius:8px 8px 0 0}
.tab.on{background:var(--on)}.tab span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.home{display:grid;grid-template-columns:repeat(4,72px);gap:22px 20px;padding:32px 24px;width:390px;border-radius:24px}
.app{display:grid;justify-items:center;gap:6px;font-size:11px}.tile{width:60px;height:60px;border-radius:14px;display:block}
.unfurl{width:600px;padding:14px 16px;border-left:4px solid #ccc;font-size:14px;display:grid;gap:6px}.who{font-weight:700}.t{color:#1264a3;font-weight:700}
.unfurl img{border-radius:8px}
</style>`;

async function shootMocks(browser: Browser): Promise<void> {
	const favicon = await dataUrl(
		new URL('../src/lib/assets/favicon.svg', import.meta.url),
		'image/svg+xml'
	);
	const icon = await dataUrl(new URL('icons/icon-192.png', STATIC), 'image/png');
	const card = await dataUrl(new URL(SHARE_CARDS.player.path.slice(1), STATIC), 'image/png');
	for (const theme of THEMES) {
		const page = await browser.newPage({ deviceScaleFactor: SCALE, colorScheme: theme });
		const on = theme === 'dark' ? '#35363a' : '#ffffff';
		const draw = async (name: string, body: string): Promise<void> => {
			await page.setContent(
				`<!doctype html><html><head>${MOCK_STYLE}</head><body style="--on:${on}">${body}</body></html>`
			);
			await page
				.locator('body > *')
				.first()
				.screenshot({ path: file(`${name}-${theme}`) });
		};
		await draw('tab-strip', tabStrip(favicon, theme));
		await draw('home-screen', homeScreen(icon, theme));
		await draw('unfurl', unfurl(card, theme));
		await page.close();
		process.stdout.write(`mocks ${theme}\n`);
	}
	// The favicon at its true sizes on the page colour, no browser chrome in the way.
	const page = await browser.newPage({ deviceScaleFactor: 1 });
	await page.setContent(
		`<div style="display:flex;gap:16px;align-items:center;padding:12px;background:${APP_COLORS.light.page}">${[
			16, 32
		]
			.map((n) => `<img src="${favicon}" width="${String(n)}" height="${String(n)}">`)
			.join('')}</div>`
	);
	await page
		.locator('div')
		.first()
		.screenshot({ path: file('favicon-1x') });
	await page.close();
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
	await shootShell(browser);
	await shootMocks(browser);
} finally {
	await browser.close();
}
for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
process.exit(failures.length > 0 ? 1 : 0);
