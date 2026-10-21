// Screenshots of what Avg and Last count through week 6's weekend (Lane 111, B23, B33, B70), dark at
// 1280 and 390, on one of the fixture's clocks (inseason-fixture/clock.ts):
//   sunday     Sunday morning, every Sunday game to come: Avg and Last are our stats, nothing said;
//   monday     Monday night, Sunday final and the Monday game under way: a Sunday starter's Avg, Last
//              and GP count the platform's points, and the basis says so (merged with when Final
//              lands while the Monday game is in play); Waivers and Trades are turned to week 7;
//   tuesday    every week 6 game final, our stats not in: as Monday night, nothing in play;
//   wednesday  our week 6 stats in: no row counts the platform's points, nothing said;
//   thursday   week 7's projection read: the turned Trades page says its Proj is week 7's.
// Lineup, Matchup, Waivers, Trades and the league's Players view on the first four; Trades on
// Thursday. Every screen with Avg and Last names the rules our stats omit with no link to follow and
// says what Avg and Last count at both widths (fix round 1, HIGH-1), keeps its basis within five
// rendered lines at 1280 and eight at 390 (basis-lines.ts), and passes the copy guard (copy-scan.ts).
// Exits non-zero on any fault.
//
//   CLOCK=sunday|monday|tuesday|wednesday|thursday node scripts/platform-finals-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API (API_ORIGIN), started on the clock.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { STATS_BY_WEDNESDAY } from '../src/lib/league/box/basis.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { basisLines } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_STATS_CLOCK,
	FIXTURE_SUNDAY_MORNING_CLOCK,
	FIXTURE_TUESDAY_CLOCK,
	FIXTURE_WEEK7_READ_CLOCK,
	fixtureApiClock,
	installFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { LEAGUE_RULES_NOTE } from './inseason-fixture/week.ts';

const CLOCKS = {
	sunday: FIXTURE_SUNDAY_MORNING_CLOCK,
	monday: FIXTURE_MONDAY_NIGHT_CLOCK,
	tuesday: FIXTURE_TUESDAY_CLOCK,
	wednesday: FIXTURE_STATS_CLOCK,
	thursday: FIXTURE_WEEK7_READ_CLOCK
} as const;
type Day = keyof typeof CLOCKS;
const day = (process.env.CLOCK ?? 'monday') as Day;
const clock = CLOCKS[day];
const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? `../screenshots/platform-finals/${day}/`, import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
const WIDTHS = [1280, 390] as const;
/** The most rendered lines a basis may draw at each width (Lane 108: eight on a phone). */
const MOST_LINES: Readonly<Record<(typeof WIDTHS)[number], number>> = { 1280: 5, 390: 8 };
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const LEAGUE = `/league/${FIXTURE_IDS.league}`;
/** The league's Players view: the order signed in with the league selected (OrderScreen mode rest,
 * the API's league order); /players reads the order with no league. */
const PLAYERS = '/board/ppr-12/rb';
const PLAYERS_READY = 'Our rest-of-season order';
/** What the basis says while a row counts the platform's points (basis.ts finalsPartAt). */
/** What the basis says while a row counts the platform's points (basis.ts finalsPartAt, and on a
 * phone phoneFinalsPart, fix round 1). */
const PLATFORM_SAID =
	/count (this week's|week \d+'s) finals from Sleeper's points|then count Sleeper's points|count Sleeper's finals/;
/** Waivers' sentence: its rows are free agents, on our stats (fix round 1, MEDIUM-3). */
const FREE_AGENTS_SAID = /Free agents' Avg and Last are our stats, week \d+'s by Wednesday\./;
const WEEK7_PROJ = "Proj is week 7's published projection";

interface Screen {
	name: string;
	path: string;
	ready: string;
	/** Whether the basis says the platform's points count on this clock; null, not checked (Trades,
	 * whose closed basis draws no Avg or Last). */
	platform: boolean | null;
}

/** The four league screens with Avg and Last, and the league's Players, on a clock. */
function leagueScreens(platform: boolean): Screen[] {
	return [
		{ name: 'lineup', path: `${LEAGUE}/start`, ready: 'Week 6', platform },
		{ name: 'matchup', path: `${LEAGUE}/matchup`, ready: 'Week 6', platform },
		{ name: 'waivers', path: `${LEAGUE}/waivers`, ready: 'Open Sleeper waivers', platform },
		{ name: 'trades', path: `${LEAGUE}/trades`, ready: 'worth proposing', platform: null },
		{ name: 'players', path: PLAYERS, ready: PLAYERS_READY, platform }
	];
}

const SCREENS: Readonly<Record<Day, readonly Screen[]>> = {
	sunday: leagueScreens(false),
	monday: leagueScreens(true),
	tuesday: leagueScreens(true),
	wednesday: leagueScreens(false),
	thursday: [{ name: 'trades', path: `${LEAGUE}/trades`, ready: 'worth proposing', platform: null }]
};

const running = (await fixtureApiClock(API_ORIGIN)).clock;
if (running !== clock)
	throw new Error(
		`The fixture API at ${API_ORIGIN} runs on ${running ?? 'the real clock'}: start it with FIXTURE_CLOCK=${clock}.`
	);

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];
const measures: string[] = [];

async function context(width: number): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: 'dark'
	});
	watchData(ctx);
	await installFixtureClock(ctx, clock);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, 'dark'] as const
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

/** The basis as drawn at the width: its words (a desk-only part hidden on a phone left out) and the
 * links in it. */
async function drawnBasis(page: Page): Promise<{ text: string; links: string[] }> {
	return page.evaluate(() => {
		const blocks = [...document.querySelectorAll('main [data-basis]')];
		return {
			text: blocks.map((b) => (b as HTMLElement).innerText).join(' '),
			links: blocks.flatMap((b) => [...b.querySelectorAll('a')].map((a) => a.textContent))
		};
	});
}

function check(
	screen: Screen,
	width: number,
	basis: { text: string; links: string[] },
	at: string
): void {
	const said = PLATFORM_SAID.test(basis.text);
	// At a desk the basis says the platform's points count; a phone's eight lines hold when Final and
	// our stats land in its place (basis.ts finalsParts).
	// Every width says what Avg and Last count while a row counts the platform's points (HIGH-1):
	// Waivers, whose rows are free agents, says theirs are our stats.
	const waivers = screen.name === 'waivers';
	if (screen.platform && !waivers && !said)
		faults.push(`${at}: the basis does not say Avg and Last count the platform's points`);
	if (screen.platform && waivers && !FREE_AGENTS_SAID.test(basis.text))
		faults.push(`${at}: Waivers does not say the free agents' Avg and Last are our stats`);
	if (waivers && said) faults.push(`${at}: Waivers says the platform's points count`);
	if (screen.platform && !basis.text.includes(STATS_BY_WEDNESDAY))
		faults.push(`${at}: the basis does not say when our stats land`);
	if (screen.platform === false && said)
		faults.push(`${at}: the basis says the platform's points count`);
	if (!['trades', 'matchup'].includes(screen.name) && !basis.text.includes(LEAGUE_RULES_NOTE))
		faults.push(`${at}: the rules our stats lack are not named`);
	if (basis.links.some((words) => words.startsWith('Which')))
		faults.push(`${at}: a link to the rules: ${basis.links.join(', ')}`);
	if (day === 'thursday' && !basis.text.includes(WEEK7_PROJ))
		faults.push(`${at}: the turned Proj does not name week 7`);
}

for (const screen of SCREENS[day]) {
	for (const width of WIDTHS) {
		const ctx = await context(width);
		const page = await ctx.newPage();
		const at = `${day} ${screen.name} ${String(width)}`;
		try {
			await page.goto(`${web}${screen.path}`);
			await ready(page, screen.ready);
			const basis = await drawnBasis(page);
			check(screen, width, basis, at);
			const lines = await basisLines(page);
			measures.push(`${at}: basis ${String(lines)} lines`);
			if (lines === 0 || lines > MOST_LINES[width])
				faults.push(`${at}: basis draws ${String(lines)} lines`);
			const copy = await copyFault(page);
			if (copy !== null) faults.push(`${at}: ${copy}`);
			await page.screenshot({
				path: new URL(`${screen.name}-${day}-${String(width)}.png`, out).pathname,
				fullPage: true
			});
			process.stdout.write(`${at}: ${basis.text}\n`);
		} catch (error) {
			faults.push(`${at}: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			await ctx.close();
		}
	}
}
await browser.close();
process.stdout.write(`${measures.join('\n')}\n`);
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write('every surface holds\n');
