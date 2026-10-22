// Screenshots of the free season's pages (Lane 150) against the fixture API
// (scripts/inseason-fixture/serve.ts) and the built site, in both themes at 1280 and 390, on the
// fixture week's clock: the free page signed out and signed in, the account page signed out and
// signed in, the companion's start page signed out, and a claim link. Each asserts what it shows: the
// free page's head, lead, one verb, list and footer, the account's free plan card and no Draft Pass
// row, the companion's sign-in, the claim link's not-found page, no Advisor on the season's rail, no
// paid product or figure anywhere, the one copy guard, and no page scrolling sideways. With
// FIXTURE_FREE_SEASON=1 the catalog names the free season (Lane 149's flag), and the script checks the
// page read it. Exits non-zero on any fault.
//
//   node scripts/pass-shots.ts [web origin] [out dir, from scripts/]
// with the site built against PUBLIC_API_URL set to the fixture API's origin (API_ORIGIN), the API
// started with FIXTURE_CLOCK=2026-10-17T17:00:00.000Z.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { FREE_SEE, FREE_SEASON_PLAN } from '../src/lib/account/words.ts';
import { freeLine } from '../src/lib/pass/words.ts';
import { SIGNED_OUT_WORDS } from '../src/lib/companion/new-words.ts';
import { ALWAYS_FREE, FREE_WORDS } from '../src/lib/pass/words.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { installFixtureApiClock, requireFixtureClock } from './inseason-fixture/clock.ts';
import { FREE_SEASON_VARIABLE } from './inseason-fixture/phases.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const PHONE_HEIGHT = 844;
const DESK_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const NOT_FOUND = 404;
const UNAUTHORIZED = 401;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
/** The free season's list: every league, its scoring, the season's screens, the week's rankings,
 * the companion, then the five prep tools. */
const SEASON_ROWS = 10;
/** Lane 138's footer budgets: five rendered lines at a desk, eight in a hand. */
const FOOT_LINES = { desk: 5, phone: 8 } as const;
/** A paid product by name, or one of the 2027 figures, anywhere on a page. */
const PAID = /\bDraft Pass\b|\bMembership\b|\$(?:39|99|14\.99|29)\b|checkout/iu;
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8866').origin;
/** The catalog's flag as the case sets it: true, false (the founder ended the season), or absent. */
const FLAGGED = process.env[FREE_SEASON_VARIABLE] === '1';
const ENDED = process.env[FREE_SEASON_VARIABLE] === '0';
/** The free page's words in the state the catalog puts it in: the flag wins, the clock without it. */
const STATE = ENDED ? FREE_WORDS.always : FREE_WORDS.season;
const ROWS = ENDED ? ALWAYS_FREE.length : SEASON_ROWS;
await requireFixtureClock(API_ORIGIN);

const web = process.argv[2] ?? 'http://localhost:4266';
const out = new URL(process.argv[3] ?? '../screenshots/pass/', import.meta.url);
const tag = FLAGGED ? '-flag' : ENDED ? '-ended' : '';

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

function fault(where: string, what: string): void {
	faults.push(`${where}: ${what}`);
}

async function context(theme: string, width: number, signedIn: boolean): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: width < 500 ? PHONE_HEIGHT : DESK_HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: width < 500 ? 2 : 1
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	if (signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function ready(page: Page, text: string): Promise<void> {
	await page
		.getByText(text, { exact: true })
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

/** Faults every page shares: a paid word, a banned word, a sideways scroll, an Advisor on the rail. */
async function common(page: Page, where: string): Promise<void> {
	const text = await page.evaluate(() => document.body.innerText);
	const paid = PAID.exec(text)?.[0];
	if (paid !== undefined) fault(where, `says ${paid}`);
	const banned = await copyFault(page);
	if (banned !== null) fault(where, `says ${banned}`);
	const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
	if (wide) fault(where, 'scrolls sideways');
	const rail = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('nav.rail .item')]
			.filter((item) => item.getBoundingClientRect().width > 0)
			.map((item) => item.innerText.trim())
	);
	if (rail.includes('Advisor'))
		fault(where, `the season's rail draws Advisor (${rail.join(', ')})`);
}

function file(name: string, theme: string, width: number): string {
	return new URL(`${name}${tag}-${theme}-${String(width)}.png`, out).pathname;
}

async function freePage(theme: string, width: number, signedIn: boolean): Promise<void> {
	const who = signedIn ? 'signed-in' : 'signed-out';
	const where = `pass ${who} ${theme} ${String(width)}`;
	const ctx = await context(theme, width, signedIn);
	const page = await ctx.newPage();
	const read = { plans: false };
	page.on('response', (response) => {
		if (new URL(response.url()).pathname === '/billing/plans') read.plans = response.ok();
	});
	await page.goto(`${web}/pass`);
	const verb = signedIn ? FREE_WORDS.follow : FREE_WORDS.signIn;
	await ready(page, verb);
	// The build paints the clock's state; the catalog's answer turns it.
	await page
		.locator('main .lead .line', { hasText: STATE.lead })
		.waitFor({ timeout: READY_TIMEOUT_MS });
	const seen = await page.evaluate(() => ({
		title: document.title,
		heading: document.querySelector('main .head .title')?.textContent.trim() ?? '',
		lead: document.querySelector('main .lead .line')?.textContent.trim() ?? '',
		verbs: [...document.querySelectorAll('main a, main button')]
			.filter((e) => e.className.includes('verb'))
			.map((e) => (e as HTMLElement).innerText.trim()),
		rows: document.querySelectorAll('main ul li').length,
		links: [...document.querySelectorAll('main ul li a')].length,
		foot: document.querySelector('main > p:last-child')?.textContent.trim() ?? '',
		footLines: (() => {
			const foot = document.querySelector('main > p:last-child');
			if (!foot) return 0;
			const lineHeight = parseFloat(getComputedStyle(foot).lineHeight);
			return Math.round(foot.getBoundingClientRect().height / lineHeight);
		})(),
		buttons: document.querySelectorAll('main button').length
	}));
	if (seen.title !== `${STATE.title} · Commish`) fault(where, `title ${seen.title}`);
	if (seen.heading !== STATE.title) fault(where, `heading ${seen.heading}`);
	if (seen.lead !== STATE.lead) fault(where, `lead ${seen.lead}`);
	if (seen.verbs.join() !== verb) fault(where, `verbs ${seen.verbs.join(', ')}`);
	if (seen.rows !== ROWS || seen.links !== ROWS)
		fault(where, `${String(seen.rows)} rows, ${String(seen.links)} links`);
	// Ended, no footer says what comes later: the page promises nothing.
	if (seen.foot !== (ENDED ? '' : FREE_WORDS.later)) fault(where, `foot ${seen.foot}`);
	const footBudget = width < 500 ? FOOT_LINES.phone : FOOT_LINES.desk;
	if (seen.footLines > footBudget) fault(where, `the footer draws ${String(seen.footLines)} lines`);
	process.stdout.write(
		`${where}: footer ${String(seen.footLines)} of ${String(footBudget)} lines\n`
	);
	if (seen.buttons !== 0) fault(where, `${String(seen.buttons)} buttons`);
	if ((FLAGGED || ENDED) && !read.plans) fault(where, 'the catalog was not read');
	await common(page, where);
	await page.screenshot({ path: file(`pass-${who}`, theme, width), fullPage: true });
	await ctx.close();
}

async function account(theme: string, width: number, signedIn: boolean): Promise<void> {
	const who = signedIn ? 'signed-in' : 'signed-out';
	const where = `account ${who} ${theme} ${String(width)}`;
	const ctx = await context(theme, width, signedIn);
	const page = await ctx.newPage();
	await page.goto(`${web}/account`);
	await ready(page, signedIn ? (ENDED ? 'Free' : FREE_SEASON_PLAN.title) : 'Sign in');
	if (signedIn && ENDED) {
		await page.waitForLoadState('networkidle');
		const plan = await page.evaluate(() => ({
			line: document.querySelector('[aria-label="Plan"] .kvr .st span')?.textContent.trim() ?? '',
			links: document.querySelectorAll('[aria-label="Plan"] .kvr a').length
		}));
		if (plan.line !== freeLine()) fault(where, `plan ${plan.line}`);
		if (plan.links !== 0) fault(where, `the ended plan card links ${String(plan.links)}`);
	} else if (signedIn) {
		const plan = await page.evaluate(() => ({
			line: document.querySelector('[aria-label="Plan"] .kvr .st span')?.textContent.trim() ?? '',
			link: document.querySelector('[aria-label="Plan"] .kvr a')?.textContent.trim() ?? '',
			href: document.querySelector('[aria-label="Plan"] .kvr a')?.getAttribute('href') ?? ''
		}));
		if (plan.line !== FREE_SEASON_PLAN.line) fault(where, `plan ${plan.line}`);
		if (plan.link !== FREE_SEE || plan.href !== '/pass') fault(where, `plan link ${plan.link}`);
	} else {
		const keeps = await page.evaluate(() =>
			[...document.querySelectorAll('[aria-label="What an account keeps"] li b')].map((b) =>
				b.textContent.trim()
			)
		);
		if (keeps.join() !== 'Your leagues,Your cheat sheets,Your mock drafts')
			fault(where, `keeps ${keeps.join(', ')}`);
	}
	await common(page, where);
	await page.screenshot({ path: file(`account-${who}`, theme, width), fullPage: true });
	await ctx.close();
}

async function companion(theme: string, width: number): Promise<void> {
	const where = `companion signed-out ${theme} ${String(width)}`;
	const ctx = await context(theme, width, false);
	// The fixture answers /me for anyone: signed out, the API's 401.
	await ctx.route(`${API_ORIGIN}/me`, (route) =>
		route.fulfill({
			status: UNAUTHORIZED,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': web, 'Access-Control-Allow-Credentials': 'true' },
			body: JSON.stringify({ data: null, error: { code: 'unauthorized', message: 'Sign in.' } })
		})
	);
	const page = await ctx.newPage();
	await page.goto(`${web}/companion/new`);
	await ready(page, SIGNED_OUT_WORDS.title);
	const verbs = await page.evaluate(() =>
		[...document.querySelectorAll('main a, main button')].map((e) =>
			(e as HTMLElement).innerText.trim()
		)
	);
	if (verbs.join() !== SIGNED_OUT_WORDS.verb) fault(where, `verbs ${verbs.join(', ')}`);
	await common(page, where);
	await page.screenshot({ path: file('companion-new-signed-out', theme, width), fullPage: true });
	await ctx.close();
}

async function claim(theme: string, width: number): Promise<void> {
	const where = `claim ${theme} ${String(width)}`;
	const ctx = await context(theme, width, true);
	const page = await ctx.newPage();
	const response = await page.goto(`${web}/claim/AAAAAAAAAAAAAAAAAAAAAA`);
	if (response?.status() !== NOT_FOUND) fault(where, `answers ${String(response?.status())}`);
	await ready(page, 'Nothing lives at this address.');
	await common(page, where);
	await page.screenshot({ path: file('claim', theme, width), fullPage: true });
	await ctx.close();
}

for (const theme of THEMES) {
	for (const width of WIDTHS) {
		await freePage(theme, width, false);
		await freePage(theme, width, true);
		if (FLAGGED) continue;
		await account(theme, width, false);
		await account(theme, width, true);
		if (ENDED) continue;
		await companion(theme, width);
		await claim(theme, width);
	}
}
await browser.close();

if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`the free season's pages${tag}: no faults\n`);
