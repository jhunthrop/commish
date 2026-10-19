// Screenshots of the shell's rail in every season phase (spec 2026-10-16 §2, §5), against the fixture
// API (scripts/inseason-fixture/serve.ts, phases.ts) and the built site, in both themes at 1440 and
// 390: the board with each phase's league selected, and signed out. Each asserts the root names the
// phase's rail, that the rail shows exactly that rail's items in order (the phone's five), that a
// second page shows it before its own script runs (the session copy, no flash), and that no page
// scrolls sideways. Then the switch's menu open with leagues in every phase, and with one league.
//
//   node scripts/rail-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL=http://localhost:8799 and the fixture API running there.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { RAIL_KEYS, railInSeason, type RailKey } from '../src/lib/ui/nav.ts';
import { RAIL_WITHOUT_LEAGUE, railFor } from '../src/lib/ui/rail-order.ts';
import {
	FIXTURE_PHASES,
	MANY_COOKIE,
	ONE_COOKIE,
	PHASE_COOKIE,
	type FixturePhase
} from './inseason-fixture/phases.ts';
import { pageFaults, pageLine, pageMeasures } from './page-measures.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390, 360] as const;
const PHONE_MAX = 760;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };

const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? '../screenshots/rails/', import.meta.url);

/** The rail each fixture phase's league selects. */
const KEY_OF: Readonly<Record<FixturePhase, RailKey>> = {
	pre_draft: 'pre_draft',
	draft_day: 'draft_day',
	in_season: 'in_season',
	playoffs: 'playoffs_waivers',
	playoffs_closed: 'playoffs',
	offseason: 'offseason'
};

/** A rail's labels; a season rail with no league selected is the rail without a league (Lane 83). */
function railLabels(key: RailKey, phone: boolean, league: boolean): string[] {
	const items =
		!league && railInSeason(key)
			? RAIL_WITHOUT_LEAGUE
			: key === 'playoffs_waivers'
				? railFor('playoffs', true)
				: railFor(key, false);
	const shown = phone ? items.filter((item) => !item.wideOnly) : items;
	return [...shown.map((item) => item.label), ...(phone ? [] : ['Account'])];
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const failures: string[] = [];

async function context(
	theme: string,
	width: number,
	cookies: { name: string; value: string }[]
): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light'
	});
	await ctx.addCookies(cookies.map((cookie) => ({ ...cookie, domain: 'localhost', path: '/' })));
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

/** The rail's labels as drawn, top to bottom (left to right on a phone). */
function shownLabels(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('nav.rail .item')]
			.filter((item) => item.offsetParent !== null || getComputedStyle(item).display !== 'none')
			.filter((item) => item.getBoundingClientRect().width > 0)
			.map((item) => item.innerText.trim())
	);
}

async function check(page: Page, where: string, key: RailKey, width: number): Promise<void> {
	const rail = await page.evaluate(() => document.documentElement.getAttribute('data-rail'));
	if (rail !== key) failures.push(`${where}: the root names ${String(rail)}, not ${key}`);
	const league = await page.evaluate(() => document.documentElement.hasAttribute('data-league'));
	const want = railLabels(key, width <= PHONE_MAX, league);
	const got = await shownLabels(page);
	if (JSON.stringify(got) !== JSON.stringify(want)) {
		failures.push(`${where}: the rail shows ${got.join(', ')}, not ${want.join(', ')}`);
	}
	const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
	if (wide) failures.push(`${where}: scrolls sideways`);
	// Every shown label sits whole in its item and inside the bar: nothing clipped.
	const clipped = await page.evaluate(() => {
		const rail = document.querySelector('nav.rail')?.getBoundingClientRect();
		return [...document.querySelectorAll<HTMLElement>('nav.rail .item')]
			.filter((item) => item.getBoundingClientRect().width > 0)
			.filter((item) => {
				const label = item.querySelector('span')?.getBoundingClientRect();
				return (
					item.scrollHeight > item.clientHeight + 1 ||
					(label !== undefined && rail !== undefined && label.bottom > rail.bottom + 0.5)
				);
			})
			.map((item) => item.innerText.trim());
	});
	if (clipped.length > 0) failures.push(`${where}: clipped labels ${clipped.join(', ')}`);
}

function file(name: string): string {
	return new URL(`${name}.png`, out).pathname;
}

async function settle(page: Page, key: RailKey): Promise<void> {
	await page.waitForFunction(
		(want) => document.documentElement.getAttribute('data-rail') === want,
		key,
		{ timeout: READY_TIMEOUT_MS }
	);
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

for (const phase of FIXTURE_PHASES) {
	const key = KEY_OF[phase];
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const where = `${phase} ${theme} ${String(width)}`;
			const ctx = await context(theme, width, [SIGNED_IN, { name: PHASE_COOKIE, value: phase }]);
			const page = await ctx.newPage();
			await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
			await settle(page, key);
			await check(page, where, key, width);
			await page.screenshot({ path: file(`rail-${phase}-${theme}-${String(width)}`) });
			// The next page reads the session copy before its own script: the rail is right at once.
			await page.goto(`${web}/players`, { waitUntil: 'commit' });
			await page.waitForSelector('nav.rail', { state: 'attached' });
			const first = await page.evaluate(() => document.documentElement.getAttribute('data-rail'));
			if (first !== key) failures.push(`${where}: the next page painted ${String(first)} first`);
			await ctx.close();
		}
	}
}

/** How long the first page's /me is held, so its first frames are measured before it answers. */
const ME_HELD_MS = 2_000;

/** The first page after a sign-in (Lane 83 review 1): a session and nothing kept. Before /me answers
 * the season rail draws League alone, its other slots blank; never the rail without a league and
 * then the league's. After it answers, the league's rail. */
for (const theme of THEMES) {
	for (const width of [1440, 390] as const) {
		const where = `first page after sign-in ${theme} ${String(width)}`;
		const ctx = await context(theme, width, [
			SIGNED_IN,
			{ name: PHASE_COOKIE, value: 'in_season' }
		]);
		await ctx.route('**/me', async (route) => {
			await new Promise((done) => setTimeout(done, ME_HELD_MS));
			await route.continue();
		});
		const page = await ctx.newPage();
		await page.goto(`${web}/board`, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('nav.rail', { state: 'attached' });
		const before = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('nav.rail .item')]
				.filter((item) => item.getBoundingClientRect().width > 0)
				.filter((item) => getComputedStyle(item).visibility !== 'hidden')
				.map((item) => item.innerText.trim())
		);
		const pending = await page.evaluate(() =>
			document.documentElement.hasAttribute('data-league-pending')
		);
		if (
			!pending ||
			JSON.stringify(before) !==
				JSON.stringify(width > PHONE_MAX ? ['League', 'Account'] : ['League'])
		)
			failures.push(
				`${where}: before /me the rail draws ${before.join(', ')} (pending ${String(pending)})`
			);
		await page.screenshot({ path: file(`rail-first-sign-in-pending-${theme}-${String(width)}`) });
		await settle(page, 'in_season');
		await page.waitForFunction(() => !document.documentElement.hasAttribute('data-league-pending'));
		await check(page, where, 'in_season', width);
		await page.screenshot({ path: file(`rail-first-sign-in-${theme}-${String(width)}`) });
		await ctx.close();
	}
}

/** Signed out in season: the rail without a league (Lane 83), League opening the follow page. */
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const where = `signed out ${theme} ${String(width)}`;
		const ctx = await context(theme, width, []);
		const page = await ctx.newPage();
		await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
		const site = await page.evaluate(() => document.documentElement.getAttribute('data-rail'));
		const key = RAIL_KEYS.find((candidate) => candidate === site) ?? 'pre_draft';
		await settle(page, key);
		await check(page, where, key, width);
		await page.screenshot({ path: file(`rail-signed-out-${theme}-${String(width)}`) });
		await ctx.close();
	}
}

/** The switch's menu: leagues in every phase say theirs, one league says none. Its last row follows
 * another league for an account that may follow more, and is what more leagues come with for one
 * that may not. */
for (const theme of THEMES) {
	for (const width of [1440, 390] as const) {
		for (const one of [false, true]) {
			for (const many of [false, true]) {
				const cookies = [SIGNED_IN, { name: PHASE_COOKIE, value: 'in_season' }];
				if (one) cookies.push({ name: ONE_COOKIE, value: '1' });
				if (many) cookies.push({ name: MANY_COOKIE, value: '1' });
				const ctx = await context(theme, width, cookies);
				const page = await ctx.newPage();
				await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
				await settle(page, 'in_season');
				await page.locator('.switch .face').click();
				await page.locator('#league-menu .foot').waitFor({ timeout: READY_TIMEOUT_MS });
				await page.waitForLoadState('networkidle');
				const last = await page.evaluate(() => {
					const foot = document.querySelector('#league-menu .foot');
					const end = foot?.lastElementChild;
					return {
						text: (end as HTMLElement | null)?.innerText.trim() ?? '',
						href: end?.getAttribute('href') ?? null
					};
				});
				const where = `menu ${many ? 'many' : 'free'} ${theme} ${String(width)}`;
				if (many && (last.text !== 'Follow another league' || last.href !== '/league/new')) {
					failures.push(`${where}: the last row is ${last.text} to ${String(last.href)}`);
				}
				if (
					!many &&
					(last.text.includes('Follow another league') || !last.text.includes('Draft Pass'))
				) {
					failures.push(`${where}: the last row is ${last.text}`);
				}
				const name = `menu-${one ? 'one' : 'phases'}${many ? '-many' : ''}`;
				await page.screenshot({ path: file(`${name}-${theme}-${String(width)}`) });
				await ctx.close();
			}
		}
	}
}

/** Signed out in season: the rail without a league draws no Lineup or Trades (Lane 83), and its
 * League opens the follow page, lit there. */
for (const theme of THEMES) {
	const ctx = await context(theme, 390, []);
	const page = await ctx.newPage();
	await page.goto(`${web}/board`, { waitUntil: 'networkidle' });
	const drawn = await shownLabels(page);
	for (const gone of ['Lineup', 'Matchup', 'Waivers', 'Trades'])
		if (drawn.includes(gone)) failures.push(`follow ${theme}: signed out the rail draws ${gone}`);
	await page.locator('nav.rail .item', { hasText: 'League' }).filter({ visible: true }).click();
	await page
		.waitForURL('**/league/new', { timeout: READY_TIMEOUT_MS })
		.catch(() => failures.push(`follow League ${theme}: League opens ${page.url()}`));
	await page.waitForLoadState('networkidle');
	const lit = await page.evaluate(
		() =>
			[...document.querySelectorAll<HTMLElement>('nav.rail .item[aria-current="page"]')]
				.filter((item) => item.getBoundingClientRect().width > 0)
				.map((item) => item.innerText.trim())[0] ?? ''
	);
	if (lit !== 'League') failures.push(`follow League ${theme}: ${lit || 'nothing'} is lit`);
	await page.screenshot({ path: file(`follow-tap-league-${theme}-390`) });
	await ctx.close();
}

/** The pages that pass the bar no parts (Lane 87): at 390 each draws the one 57 px row led by the
 * mark, with no band under it, signed out and signed in. */
const NO_PARTS = [
	{ name: 'mock-new', path: '/mock/new' },
	{ name: 'pass', path: '/pass' },
	{ name: 'account', path: '/account' },
	{ name: 'claim', path: '/claim/no-such-code' },
	{ name: 'companion-new', path: '/companion/new' },
	{ name: 'league-new', path: '/league/new' },
	{ name: 'notfound', path: '/no-such-page' },
	// A lobby link the API answers with an error takes no one (Lane 87 review M1).
	{ name: 'lobby-error', path: '/lobby/no-such-lobby' }
] as const;
const pageLines: string[] = [];
/** A beat for a page's first answer to draw before it is measured. */
const SETTLE_MS = 500;

for (const theme of THEMES) {
	for (const signedIn of [false, true]) {
		for (const { name, path } of NO_PARTS) {
			const who = signedIn ? 'in' : 'out';
			const where = `${name} ${who} ${theme} 390`;
			const cookies = signedIn ? [SIGNED_IN, { name: PHASE_COOKIE, value: 'in_season' }] : [];
			const ctx = await context(theme, 390, cookies);
			const page = await ctx.newPage();
			await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
			await page.evaluate(() => document.fonts.ready);
			await page.waitForTimeout(SETTLE_MS);
			const measured = await pageMeasures(page);
			if (theme === 'dark') pageLines.push(pageLine(where, measured));
			for (const fault of pageFaults(measured, true, 1)) failures.push(`${where}: ${fault}`);
			await page.screenshot({ path: file(`${name}-${who}-${theme}-390`) });
			await ctx.close();
		}
	}
}

/** Before /me answers (data-league-pending) the one-row bar is the height it is after. */
for (const theme of THEMES) {
	const where = `mock-new pending ${theme} 390`;
	const ctx = await context(theme, 390, [SIGNED_IN, { name: PHASE_COOKIE, value: 'in_season' }]);
	await ctx.route('**/me', async (route) => {
		await new Promise((done) => setTimeout(done, ME_HELD_MS));
		await route.continue();
	});
	const page = await ctx.newPage();
	await page.goto(`${web}/mock/new`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('header.top', { state: 'attached' });
	await page.evaluate(() => document.fonts.ready);
	const pending = await page.evaluate(() =>
		document.documentElement.hasAttribute('data-league-pending')
	);
	const before = await pageMeasures(page);
	await page.screenshot({ path: file(`mock-new-pending-${theme}-390`) });
	await page.waitForFunction(() => !document.documentElement.hasAttribute('data-league-pending'));
	await page.waitForLoadState('networkidle');
	const after = await pageMeasures(page);
	if (theme === 'dark') {
		pageLines.push(pageLine(`${where} (pending ${String(pending)})`, before));
		pageLines.push(pageLine(`${where} answered`, after));
	}
	if (!pending) failures.push(`${where}: the root is not pending before /me answers`);
	if (Math.abs(before.barHeight - after.barHeight) > 0.5)
		failures.push(
			`${where}: the bar is ${before.barHeight.toFixed(1)}px pending, ${after.barHeight.toFixed(1)}px after`
		);
	for (const fault of pageFaults(before, true, 1)) failures.push(`${where}: ${fault}`);
	await ctx.close();
}

await browser.close();
for (const line of pageLines) process.stdout.write(`${line}\n`);
process.stdout.write(`shots in ${out.pathname}\n`);
if (failures.length > 0) throw new Error(`Rails:\n${failures.join('\n')}`);
process.stdout.write(
	'Every rail shows its phase, the next page paints it first, and nothing scrolls sideways.\n'
);
