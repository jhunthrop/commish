// Screenshots of every score bug opening its own game (Lane 204): the League home's scoreboard, a tap
// on another team's bug, that game's Matchup, back to the home, and the member's own game, at 1280
// with the rail and 390 in a hand, both themes, on the fixture's Sunday afternoon. It asserts the
// member's bug keeps the Matchup's plain address and every other bug names its first side's roster;
// the tapped bug lands on that roster's game, headed Their game with both its teams and a Your game
// link, with no You mark and no Lineup verb; back and forward between the two games never show the
// other game's box. Exits non-zero on any fault.
//
//   node scripts/any-game-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API (API_ORIGIN, default
// http://localhost:8204), the fixture API on FIXTURE_CLOCK=2026-10-18T18:56:00.000Z.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { MATCHUP } from '../src/lib/league/box/matchup.ts';
import { GAME_PARAM } from '../src/lib/league/box/game.ts';
import { BOX } from '../src/lib/league/box/box.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import {
	FIXTURE_SUNDAY_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const web = process.argv[2] ?? 'http://localhost:4204';
const out = new URL(process.argv[3] ?? '../screenshots/any-game/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8204').origin;
const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const PHONE_MAX = 760;
const HEIGHT = 900;
const PHONE_HEIGHT = 844;
const READY_TIMEOUT_MS = 30_000;
const COOKIES = [
	{ name: 'commish_csrf', value: 'fixture' },
	// The Sunday afternoon's stand-in: the noon games under way, the points so far drawn.
	{ name: 'fixture_week', value: 'sunday' }
];
const league = FIXTURE_IDS.league;
const home = `/league/${league}`;
const matchup = `${home}/matchup`;

await requireFixtureClock(API_ORIGIN, FIXTURE_SUNDAY_CLOCK);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

function expect(ok: boolean, fault: string): void {
	if (!ok) faults.push(fault);
}

async function context(theme: string, width: number): Promise<BrowserContext> {
	const phone = width <= PHONE_MAX;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? PHONE_HEIGHT : HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: phone ? 2 : 1
	});
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies(COOKIES.map((c) => ({ ...c, domain: 'localhost', path: '/' })));
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle', { timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
}

async function shoot(page: Page, name: string): Promise<void> {
	await page.screenshot({ path: new URL(name, out).pathname, fullPage: true });
}

/** A text as compared here: its case set aside (the heads are drawn in capitals), its spaces one. */
const plain = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The Matchup's title: the week and the two teams' names as it heads the boxes. */
async function title(page: Page): Promise<string> {
	return plain(await page.locator('.matchup .title').innerText());
}

/** How many of the boxes' team heads carry the You mark. */
async function youMarks(page: Page): Promise<number> {
	return page.locator('table.box thead .you').count();
}

/** Every bug's link and its first side's name, in the board's order. */
async function bugLinks(page: Page): Promise<{ href: string; first: string; mine: boolean }[]> {
	return page.$$eval('.board a.bug', (bugs) =>
		bugs.map((a) => ({
			href: a.getAttribute('href') ?? '',
			first: a.querySelector('.bt .nm')?.textContent.trim() ?? '',
			mine: a.classList.contains('mine')
		}))
	);
}

for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const at = `${theme} ${String(width)}`;
		const tag = `${String(width)}-${theme}`;
		const ctx = await context(theme, width);
		const page = await ctx.newPage();
		await page.goto(`${web}${home}`);
		await settle(page);
		await shoot(page, `1-home-${tag}.png`);
		const links = await bugLinks(page);
		const [mine, ...others] = links;
		expect(links.length > 1, `${at}: ${String(links.length)} bugs`);
		expect(mine?.mine === true && mine.href === matchup, `${at}: the member's bug ${mine?.href}`);
		for (const bug of others)
			expect(
				!bug.mine && new URL(bug.href, web).searchParams.has(GAME_PARAM),
				`${at}: another bug's link ${bug.href} names no roster`
			);
		expect(new Set(links.map((l) => l.href)).size === links.length, `${at}: two bugs, one link`);
		// Tap another team's bug: the second game on the board.
		const tapped = others[0];
		if (tapped === undefined) continue;
		await page.locator('.board a.bug').nth(1).click();
		await page.waitForURL((url) => url.searchParams.has(GAME_PARAM));
		await settle(page);
		await shoot(page, `2-their-game-${tag}.png`);
		const roster = new URL(page.url()).searchParams.get(GAME_PARAM);
		expect(tapped.href.endsWith(`${GAME_PARAM}=${roster ?? ''}`), `${at}: landed on ${page.url()}`);
		const theirs = await title(page);
		expect(theirs.includes(plain(tapped.first)), `${at}: their game's title "${theirs}"`);
		const whose = plain(await page.locator('.matchup .whose').innerText());
		expect(whose.includes(plain(MATCHUP.theirGame)), `${at}: no "${MATCHUP.theirGame}" head`);
		const yours = page.locator('.matchup .whose a');
		expect(
			plain(await yours.innerText()) === plain(MATCHUP.yourGame) &&
				(await yours.getAttribute('href')) === matchup,
			`${at}: no Your game link to the plain Matchup`
		);
		const marks = await youMarks(page);
		expect(marks === 0, `${at}: ${String(marks)} ${BOX.you} marks on their game`);
		const labels = await page.locator('.bug .nm small').count();
		expect(labels === 0, `${at}: their game's bug labels a side You or Opponent`);
		// Back: the home again, its board as before.
		await page.goBack();
		await settle(page);
		expect(new URL(page.url()).pathname === home, `${at}: back landed on ${page.url()}`);
		await shoot(page, `3-back-home-${tag}.png`);
		// The member's own bug: their game, never the last one drawn.
		await page.locator('.board a.bug.mine').click();
		await page.waitForURL((url) => url.pathname === matchup && !url.searchParams.has(GAME_PARAM));
		await settle(page);
		await shoot(page, `4-your-game-${tag}.png`);
		const own = await title(page);
		expect(own !== theirs, `${at}: your game shows their box "${own}"`);
		expect((await page.locator('.matchup .whose').count()) === 0, `${at}: Their game on yours`);
		const ownMarks = await youMarks(page);
		expect(ownMarks === 1, `${at}: ${String(ownMarks)} ${BOX.you} marks on your game`);
		// Their game again by its link, then back and forward between the two: each its own box.
		await page.goto(`${web}${tapped.href}`);
		await settle(page);
		expect((await title(page)) === theirs, `${at}: their game read again "${await title(page)}"`);
		await page.locator('.matchup .whose a').click();
		await page.waitForURL((url) => !url.searchParams.has(GAME_PARAM));
		await settle(page);
		expect((await title(page)) === own, `${at}: Your game drew "${await title(page)}"`);
		await page.goBack();
		await settle(page);
		expect((await title(page)) === theirs, `${at}: back drew "${await title(page)}"`);
		await page.goForward();
		await settle(page);
		expect((await title(page)) === own, `${at}: forward drew "${await title(page)}"`);
		await ctx.close();
	}
}

await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`Every bug opens its own game; shots in ${out.pathname}\n`);
