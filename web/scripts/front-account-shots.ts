// Screenshots of the front door in season for a member with leagues and of the Account room (Lane
// 66k), against the fixture API (scripts/inseason-fixture/serve.ts) and the built site, in both themes
// at 1440 and 390 (the phone's first screen too). At 1440, 1024, 800, 768 and 390 it asserts neither
// page scrolls sideways. On the front door it asserts the one read (GET /me/week, no other in-season
// read), the lead score bug with both teams, the strip's count, gain and verb, the three roster chips
// each with the screen it opens, the other leagues' bugs and the failed league's sentence, the
// basis in at most five rendered lines at a desk and eight in a hand, and on a phone the pinned verb
// clear of the bug. On the Account room it asserts the five platform rows with their states, the
// signed-out platform's solid verb, the leagues table with a last read on each read league, the
// theme and time zone under Display, and that neither page says "host". Exits non-zero on any
// fault. Prints the stand-ins each shot carries.
//
//   node scripts/front-account-shots.ts [web origin] [out dir, from scripts/]
// with the site built against PUBLIC_API_URL set to the fixture API's origin.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['dark', 'light'] as const;
const WIDTHS = [1440, 1024, 800, 768, 390] as const;
const SHOT_WIDTHS = new Set([1440, 390]);
const PHONE = { width: 390, height: 844 } as const;
const DESK_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const MOST_LINES_DESK = 5;
const MOST_LINES_PHONE = 8;
const CHIPS = 3;
const PLATFORM_ROWS = 5;
/** A phone's whole-page shot draws the pinned verb in its place in the strip. */
const PIN_IN_PLACE = '.nudge .n-act{position:static!important;box-shadow:none!important}';
const IN_SEASON_READS =
	/\/leagues\/attached\/[^/]+\/(lineup|matchup|scoreboard|waivers|trades|sync)$/;

/** What each shot carries that is not the record's, named so no one reads it as real. */
const STAND_INS: Readonly<Record<string, string>> = {
	front:
		'Stand-ins: the ESPN league is the recorded Sleeper league answered as ESPN with its Sunday points made up; the FFPC league and Last Year Keepers are made up; every Proj is the fixture snapshot.',
	account:
		'Stand-ins: every connection on Platforms (ESPN connected with lineups on, FFPC signed out) and every league but the Sleeper one.'
};

const web = process.argv[2] ?? 'http://localhost:4266';
const out = new URL(process.argv[3] ?? '../screenshots/front-account/', import.meta.url);

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

async function context(theme: string, width: number, height: number): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height },
		colorScheme: theme as 'light',
		deviceScaleFactor: width < 500 ? 2 : 1
	});
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function ready(page: Page, text: string): Promise<void> {
	await page
		.getByText(text)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

function shot(name: string): string {
	return new URL(`${name}.png`, out).pathname;
}

function fault(where: string, what: string): void {
	faults.push(`${where}: ${what}`);
}

async function sideways(page: Page): Promise<number> {
	return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** The basis's rendered lines: each paragraph's height over its line height. */
async function basisLines(page: Page): Promise<number> {
	return page.evaluate(() => {
		const box = document.querySelector('.front-week .basis');
		if (!box) return 0;
		return [...box.querySelectorAll('p')].reduce((n, p) => {
			const lh = parseFloat(getComputedStyle(p).lineHeight);
			return n + Math.round(p.getBoundingClientRect().height / lh);
		}, 0);
	});
}

async function saysHost(page: Page): Promise<boolean> {
	return page.evaluate(() => /\bhosts?\b/i.test(document.querySelector('main')?.innerText ?? ''));
}

async function front(theme: string, width: number): Promise<void> {
	const where = `front ${theme} ${String(width)}`;
	const ctx = await context(theme, width, width < 500 ? PHONE.height : DESK_HEIGHT);
	const page = await ctx.newPage();
	const reads: string[] = [];
	page.on('request', (req) => {
		const path = new URL(req.url()).pathname;
		if (path === '/me/week' || IN_SEASON_READS.test(path)) reads.push(path);
	});
	await page.goto(`${web}/`);
	await ready(page, 'Your roster');
	if ((await sideways(page)) > 0) fault(where, 'scrolls sideways');
	const weekReads = reads.filter((r) => r === '/me/week').length;
	if (weekReads !== 1 || reads.length !== 1) fault(where, `reads ${reads.join(', ')}`);
	const seen = await page.evaluate(() => {
		const band = document.querySelector('.front-week');
		const text = (sel: string) =>
			[...(band?.querySelectorAll(sel) ?? [])].map((e) => e.textContent.trim());
		return {
			lead: text('.band a.bug .nm'),
			strip: text('.nudge .n-head b'),
			gain: text('.nudge .n-sum b'),
			verb: text('.nudge .n-act a'),
			chips: text('.chips .chip .go'),
			others: text('.others a.bug .lb'),
			said: text('.others .said')
		};
	});
	if (seen.lead.length !== 2) fault(where, `lead bug teams ${seen.lead.join(' | ')}`);
	if (seen.strip[0] !== 'Three changes' || seen.gain[0] !== '+26.9')
		fault(where, `strip ${seen.strip.join()} ${seen.gain.join()}`);
	if (seen.verb[0] !== 'Set your lineup') fault(where, `verb ${seen.verb.join()}`);
	if (seen.chips.join() !== 'Lineup,Waivers,Waivers') fault(where, `chips ${seen.chips.join()}`);
	if (seen.chips.length !== CHIPS) fault(where, `${String(seen.chips.length)} chips`);
	if (!seen.others.some((l) => l.includes('ESPN')))
		fault(where, `other bugs ${seen.others.join()}`);
	if (!seen.said.some((s) => s.startsWith('FFPC signed you out'))) fault(where, 'no failed read');
	if (await saysHost(page)) fault(where, 'says host');
	const lines = await basisLines(page);
	const most = width < 500 ? MOST_LINES_PHONE : MOST_LINES_DESK;
	if (lines === 0 || lines > most)
		fault(where, `basis ${String(lines)} lines, at most ${String(most)}`);
	if (width < 500) {
		const clear = await page.evaluate(() => {
			const bug = document.querySelector('.band a.bug')?.getBoundingClientRect();
			const pin = document.querySelector('.nudge .n-act')?.getBoundingClientRect();
			return bug && pin ? pin.top - bug.bottom : -1;
		});
		if (clear < 0) fault(where, `the pinned verb covers the bug by ${String(-clear)} px`);
		if (theme === 'dark') await page.screenshot({ path: shot(`front-${theme}-390-first-screen`) });
	}
	if (SHOT_WIDTHS.has(width) && (width > 500 || theme === 'dark')) {
		// The whole page in one shot: the pinned verb sits in its place in the strip, not mid-page.
		if (width < 500) await page.addStyleTag({ content: PIN_IN_PLACE });
		await page.screenshot({ path: shot(`front-${theme}-${String(width)}`), fullPage: true });
	}
	process.stdout.write(`${where}: basis ${String(lines)} lines, reads ${reads.join(', ')}\n`);
	await ctx.close();
}

async function account(theme: string, width: number): Promise<void> {
	const where = `account ${theme} ${String(width)}`;
	const ctx = await context(theme, width, width < 500 ? PHONE.height : DESK_HEIGHT);
	const page = await ctx.newPage();
	await page.goto(`${web}/account`);
	await ready(page, 'Leagues attached');
	await page.getByText('Sign in to FFPC again').first().waitFor({ timeout: READY_TIMEOUT_MS });
	if ((await sideways(page)) > 0) fault(where, 'scrolls sideways');
	const seen = await page.evaluate(() => {
		const rows = [...document.querySelectorAll('.platforms tbody tr')];
		return {
			platforms: rows.map((r) => r.querySelector('th')?.textContent.trim() ?? ''),
			states: rows.map((r) => r.querySelector('.st b')?.textContent.trim() ?? ''),
			solid: [...document.querySelectorAll('.platforms .act a, .platforms .act button')]
				.filter((e) => e.className.includes('verb'))
				.map((e) => e.textContent.trim()),
			leagues: document.querySelectorAll('#your-leagues tbody tr').length,
			reads: [...document.querySelectorAll('#your-leagues tbody .read')].map((e) =>
				e.textContent.trim()
			),
			display: document.querySelector('[aria-label="Display"]')?.textContent ?? ''
		};
	});
	if (seen.platforms.length !== PLATFORM_ROWS)
		fault(where, `platforms ${seen.platforms.join(', ')}`);
	if (seen.platforms.join() !== 'ESPN,Sleeper,Yahoo,MyFantasyLeague,FFPC')
		fault(where, `platform order ${seen.platforms.join()}`);
	if (!seen.states.includes('Signed out by FFPC'))
		fault(where, `states ${seen.states.join(' | ')}`);
	if (seen.solid.join() !== 'Sign in to FFPC again')
		fault(where, `solid verbs ${seen.solid.join()}`);
	if (seen.leagues === 0) fault(where, 'no leagues');
	if (!seen.reads.some((r) => r.endsWith('ago'))) fault(where, `reads ${seen.reads.join()}`);
	if (!seen.display.includes('Time zone') || !seen.display.includes('Theme'))
		fault(where, 'display');
	if (await saysHost(page)) fault(where, 'says host');
	if (width < 500 && theme === 'dark')
		await page.screenshot({ path: shot(`account-${theme}-390-first-screen`) });
	if (SHOT_WIDTHS.has(width) && (width > 500 || theme === 'dark')) {
		await page.screenshot({ path: shot(`account-${theme}-${String(width)}`), fullPage: true });
	}
	process.stdout.write(
		`${where}: ${String(seen.leagues)} leagues, states ${seen.states.join(' | ')}\n`
	);
	await ctx.close();
}

for (const theme of THEMES) {
	for (const width of WIDTHS) {
		await front(theme, width);
		await account(theme, width);
	}
}
await browser.close();
for (const [name, said] of Object.entries(STAND_INS)) process.stdout.write(`${name}: ${said}\n`);
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write('front and account: no faults\n');
