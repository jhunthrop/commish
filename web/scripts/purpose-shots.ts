// Screenshots of the league home and the two order pages in their own terms (Lane 104), light at
// 1280 and dark at 390, against the fixture API (scripts/inseason-fixture/serve.ts) and the built
// site. It asserts the league home's header says the place as "8th of 12", its basis names the
// tiebreak the settings give (else points for as the platform lists the teams) and how the waiver
// order moves with who picks first, and the in-season page carries no mock-draft plumbing and no
// word on a moves feed it does not draw (B48, B54, B55, B61); that Rest of season with a league
// selected draws no verb in the bar, says its purpose in the page's header with the league's
// scoring line inside that header, and its rail item names your league; that Players says its own
// purpose (B40, B60, B63); and, on the fixture API's clock, that a Questionable chip draws on the
// Matchup only while his game is still to come (B57). Exits non-zero on any fault.
//
//   node scripts/purpose-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API (API_ORIGIN, default
// http://localhost:8999), the fixture API running there on FIXTURE_WEEK_CLOCK or a clock after the
// Sunday games (FIXTURE_MONDAY_CLOCK, FIXTURE_TUESDAY_CLOCK).
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { PAGE_PURPOSE } from '../src/lib/order/words.ts';
import { REST_IN_YOUR_LEAGUE } from '../src/lib/ui/nav.ts';
import { PAGE_VERBS } from '../src/lib/site/season-words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import {
	FIXTURE_MONDAY_CLOCK,
	FIXTURE_TUESDAY_CLOCK,
	FIXTURE_WEEK_CLOCK,
	fixtureApiClock,
	installFixtureApiClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const web = process.argv[2] ?? 'http://localhost:4199';
const out = new URL(process.argv[3] ?? '../screenshots/purpose/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8999').origin;
const SHOTS: readonly (readonly ['dark' | 'light', number])[] = [
	['light', 1280],
	['dark', 390]
];
const PHONE_MAX = 760;
const HEIGHT = 900;
const PHONE_HEIGHT = 844;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
/** The fixture's Questionable starter (inseason-fixture/project.ts), whose game is Sunday's. */
const QUESTIONABLE = 'Rome Odunze';
const PLACE = /, \d+(st|nd|rd|th) of \d+\./;

const MOMENTS: Readonly<Record<string, 'before' | 'after'>> = {
	[FIXTURE_WEEK_CLOCK]: 'before',
	[FIXTURE_MONDAY_CLOCK]: 'after',
	[FIXTURE_TUESDAY_CLOCK]: 'after'
};
const clock = (await fixtureApiClock(API_ORIGIN)).clock ?? '';
const moment = MOMENTS[clock];
if (moment === undefined)
	throw new Error(`The fixture API at ${API_ORIGIN} runs on ${clock || 'the real clock'}.`);

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

function expect(ok: boolean, fault: string): void {
	if (!ok) faults.push(fault);
}

async function context(theme: string, width: number, signedIn: boolean): Promise<BrowserContext> {
	const phone = width <= PHONE_MAX;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? PHONE_HEIGHT : HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: phone ? 2 : 1
	});
	await installFixtureApiClock(ctx, API_ORIGIN);
	if (signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
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

async function leagueHome(page: Page, at: string, platform: string): Promise<void> {
	await page.locator('main table.standings').waitFor({ timeout: READY_TIMEOUT_MS });
	const sub = await page.locator('main .lead .sub').innerText();
	expect(PLACE.test(sub), `${at}: the header's place "${sub}" is not "8th of 12"`);
	const basis = (await page.locator('main .basis p').allInnerTexts()).join(' ');
	expect(
		basis.startsWith(`Standings follow ${platform}'s record, then `),
		`${at}: basis "${basis.slice(0, 70)}"`
	);
	if (platform === 'ESPN') {
		expect(
			basis.includes('then points for, as ESPN lists them') &&
				basis.includes("Waiver the place in ESPN's order (inverse standings, 1st picks first)"),
			`${at}: the ESPN basis does not name the tiebreak and the order: "${basis}"`
		);
	}
	const main = await page.locator('main').innerText();
	expect(!/mock draft/i.test(main), `${at}: the in-season page offers mock-draft plumbing`);
	expect(!main.includes('gives no move history'), `${at}: the basis apologises for the moves`);
}

/** The bar's verbs a viewer sees (the hidden word set aside). */
async function barVerbs(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll('header.top .tail a.action')]
			.filter((node) => {
				const set = node.closest('[data-words]');
				return set === null || getComputedStyle(set).display !== 'none';
			})
			.map((node) => node.textContent.trim())
	);
}

async function rest(page: Page, at: string, phone: boolean): Promise<void> {
	await page.locator('main table.order').waitFor({ timeout: READY_TIMEOUT_MS });
	const verbs = await barVerbs(page);
	expect(
		!verbs.includes(PAGE_VERBS.open_league),
		`${at}: "${PAGE_VERBS.open_league}" with the league open`
	);
	expect(
		verbs.length === 0,
		`${at}: the bar draws ${JSON.stringify(verbs)} with a league selected`
	);
	const lead = await page.locator('main .content .lead').innerText();
	expect(lead.includes(PAGE_PURPOSE.rest), `${at}: no purpose under the head`);
	const note = page.locator('main .content .lead .note.filled');
	expect((await note.count()) === 1, `${at}: the league's scoring line is not in the header`);
	expect(
		(await page.locator('main > .league-line').count()) === 0,
		`${at}: the scoring line floats outside the header`
	);
	if (!phone) {
		const items = await page.locator('nav.rail a.item').allInnerTexts();
		expect(
			items.some((t) => t.replace(/\s+/g, ' ').trim() === REST_IN_YOUR_LEAGUE),
			`${at}: no rail item "${REST_IN_YOUR_LEAGUE}" in ${JSON.stringify(items)}`
		);
	}
}

async function players(page: Page, at: string): Promise<void> {
	await page.locator('main table.order').waitFor({ timeout: READY_TIMEOUT_MS });
	const head = await page.locator('main .head').first().innerText();
	expect(head.includes(PAGE_PURPOSE.players), `${at}: no purpose under the head`);
}

/** The Questionable chip on the Matchup: drawn before his game, gone once it is final (B57). */
async function matchup(page: Page, at: string): Promise<void> {
	await page.locator('main table.box').first().waitFor({ timeout: READY_TIMEOUT_MS });
	const rows = await page.locator('main table.box tbody tr').allInnerTexts();
	const his = rows.find((r) => r.includes(QUESTIONABLE)) ?? '';
	expect(his !== '', `${at}: no row for ${QUESTIONABLE}`);
	const tagged = his.includes('Questionable');
	expect(
		moment === 'before' ? tagged : !tagged,
		`${at}: ${QUESTIONABLE}'s Questionable chip ${tagged ? 'drawn' : 'gone'} ${moment} his game`
	);
}

const PAGES = [
	{
		name: 'league-sleeper',
		path: `/league/${FIXTURE_IDS.league}`,
		signedIn: true,
		check: (p: Page, at: string) => leagueHome(p, at, 'Sleeper')
	},
	{
		name: 'league-espn',
		path: `/league/${FIXTURE_IDS.espnDone}`,
		signedIn: true,
		check: (p: Page, at: string) => leagueHome(p, at, 'ESPN')
	},
	{
		name: 'rest',
		path: '/board',
		signedIn: true,
		check: (p: Page, at: string, phone: boolean) => rest(p, at, phone)
	},
	{ name: 'players', path: '/players', signedIn: false, check: players },
	{
		name: `matchup-${moment}`,
		path: `/league/${FIXTURE_IDS.league}/matchup`,
		signedIn: true,
		check: matchup
	}
] as const;

for (const [theme, width] of SHOTS) {
	for (const shot of PAGES) {
		const ctx = await context(theme, width, shot.signedIn);
		const page = await ctx.newPage();
		const at = `${shot.name} ${theme} ${String(width)}`;
		await page.goto(`${web}${shot.path}`);
		try {
			await shot.check(page, at, width <= PHONE_MAX);
			await settle(page);
		} catch (error: unknown) {
			faults.push(`${at}: ${error instanceof Error ? error.message : String(error)}`);
		}
		await page.screenshot({
			path: new URL(`${shot.name}-${theme}-${String(width)}.png`, out).pathname,
			fullPage: true
		});
		await ctx.close();
	}
}
await browser.close();

if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(
	`${String(SHOTS.length * PAGES.length)} pages, no fault (${moment} the games)\n`
);
