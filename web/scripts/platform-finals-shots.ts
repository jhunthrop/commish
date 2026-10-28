// Screenshots of what Avg and Last count through week 6's weekend (Lane 111, B23, B33, B70), dark at
// 1280 and 390 (THEMES=both adds light), on one of the fixture's clocks (inseason-fixture/clock.ts):
//   saturday   the fixture week's Saturday, Thursday's game played: Avg and Last are our stats;
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
// Lane 115: the rules our stats omit are framed by the clock (B92: "Avg and Last are our stats, which
// omit ..." where no row counts the platform's points, "Our stats omit ..." where one does), the
// league's order's phone names rostered players' finals, the Lineup states its pick rule at both
// widths (B83), and on a phone every Lineup and Matchup name keeps one line (B83, B90).
// Lane 121 (B99): the Team row's small cell on the Lineup, the Matchup and the league home reads
// "Final" with the total once every starter is final, never "Proj final" on the clocks where every
// week 6 game is (Tuesday, Wednesday), and never "Final" before any Sunday game is (Saturday, Sunday);
// the league home is shot for it and its footer measured, its words not checked here.
// Exits non-zero on any fault.
//
//   CLOCK=saturday|sunday|monday|tuesday|wednesday|thursday [THEMES=both] node scripts/platform-finals-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API (API_ORIGIN), started on the clock.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { STATS_BY_WEDNESDAY, UNCOUNTED } from '../src/lib/league/box/basis.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { basisLines } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { STRIP } from '../src/lib/league/box/strip.ts';
import { BOX } from '../src/lib/league/box/box.ts';
import {
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_STATS_CLOCK,
	FIXTURE_SUNDAY_MORNING_CLOCK,
	FIXTURE_TUESDAY_CLOCK,
	FIXTURE_WEEK7_READ_CLOCK,
	FIXTURE_WEEK_CLOCK,
	fixtureApiClock,
	installFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { LEAGUE_RULES_NOTE } from './inseason-fixture/week.ts';

const CLOCKS = {
	saturday: FIXTURE_WEEK_CLOCK,
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
const THEMES: readonly ('dark' | 'light')[] =
	process.env.THEMES === 'both' ? ['dark', 'light'] : ['dark'];
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
	/count (this week's|week \d+'s) finals from Sleeper's points|then count Sleeper's points|count (rostered players' Sleeper|Sleeper's) finals/;
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
	/** The builder, whose phone rows draw Avg and Last (Lane 115 fix round 1, HIGH-1), waited for. */
	open?: 'builder';
	/** Shot for its Team row and its footer's lines (the league home, Lane 121): its words are not
	 * the box screens', so check() is not asked of them. */
	teamOnly?: boolean;
}

/** The builder's words once drawn. */
const BUILDER_READY = 'Pick one or two of your players and one or two of theirs.';

/** The four league screens with Avg and Last, and the league's Players, on a clock. */
function leagueScreens(platform: boolean): Screen[] {
	return [
		{ name: 'lineup', path: `${LEAGUE}/start`, ready: 'Week 6', platform },
		{ name: 'matchup', path: `${LEAGUE}/matchup`, ready: 'Week 6', platform },
		{ name: 'waivers', path: `${LEAGUE}/waivers`, ready: 'Open Sleeper waivers', platform },
		{
			name: 'trades',
			path: `${LEAGUE}/trades`,
			ready: 'Our ideas',
			platform,
			open: 'builder'
		},
		{ name: 'players', path: PLAYERS, ready: PLAYERS_READY, platform },
		{ name: 'home', path: LEAGUE, ready: BOX.totals, platform, teamOnly: true }
	];
}

/** The clocks where every week 6 game is final (clock.ts), and those before any Sunday game is. */
const ALL_FINAL: readonly Day[] = ['tuesday', 'wednesday'];
const NONE_FINAL_SUNDAY: readonly Day[] = ['saturday', 'sunday'];

/** The Team rows' small captions as drawn (TeamFigures, box.ts teamSmallFigure), and their faults on
 * the clock (Lane 121, B99). */
async function teamFaults(
	page: Page,
	screen: Screen
): Promise<{ captions: string[]; faults: string[] }> {
	const captions = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('main tr.totals td.proj small')]
			.filter((small) => small.getClientRects().length > 0)
			.map((small) => small.textContent.trim())
	);
	// The score bugs and the footer follow the Team row (coordinator's ruling on Lane 121): with every
	// week 6 game final, no "Proj final" anywhere on the Lineup, the Matchup or the league home.
	const anywhere = await page.evaluate(
		(word) => (document.querySelector('main')?.textContent ?? '').includes(word),
		BOX.projFinal
	);
	const said = (word: string): boolean =>
		captions.some((c) => c.toLowerCase() === word.toLowerCase());
	const faults = [
		...(ALL_FINAL.includes(day) && said(BOX.projFinal)
			? [`a Team row reads ${BOX.projFinal} with every week 6 game final`]
			: []),
		...(NONE_FINAL_SUNDAY.includes(day) && said(BOX.final)
			? [`a Team row reads ${BOX.final} before Sunday's games`]
			: []),
		...(ALL_FINAL.includes(day) && ['lineup', 'matchup', 'home'].includes(screen.name) && anywhere
			? [`the page says ${BOX.projFinal} with every week 6 game final`]
			: [])
	];
	return { captions, faults: [...faults, ...(await sideFaults(page, screen))] };
}

/** Each side's Final as a screen's score bugs draw it, by team name (Lane 121 fix round 1, HIGH-1):
 * the Matchup bug's small line, the home bugs' small cell or their column head. */
async function bugFinals(page: Page, screen: Screen): Promise<Map<string, boolean>> {
	const word = BOX.final.toLowerCase();
	const pairs = await page.evaluate(
		({ name, final }) => {
			const text = (el: Element | null): string => (el?.textContent ?? '').trim().toLowerCase();
			if (name === 'matchup')
				return [...document.querySelectorAll('main .bug .sd')].map((sd) => {
					const small = text(sd.querySelector('.sc small'));
					return [text(sd.querySelector('.nm b')), small.startsWith(`${final} `)] as const;
				});
			return [...document.querySelectorAll('main a.bug')].flatMap((bug) => {
				const head = text(bug.querySelector('.bh .n.sm')) === final;
				return [...bug.querySelectorAll('.bt')].map(
					(bt) =>
						[
							text(bt.querySelector('.nm')),
							head || text(bt.querySelector('.proj')).startsWith(`${final} `)
						] as const
				);
			});
		},
		{ name: screen.name, final: word }
	);
	return new Map(pairs);
}

/** The Matchup's bug agrees with its Team rows side by side, and across screens the Matchup and the
 * home call each side Final alike at the same width and theme (kept in `finalsSeen`). */
const finalsSeen = new Map<string, Map<string, boolean>>();
async function sideFaults(page: Page, screen: Screen): Promise<string[]> {
	if (!['matchup', 'home'].includes(screen.name)) return [];
	const finals = await bugFinals(page, screen);
	const out: string[] = [];
	if (screen.name === 'matchup') {
		const rows = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('main tr.totals td.proj small')]
				.filter((small) => small.getClientRects().length > 0)
				.map((small) => small.textContent.trim().toLowerCase())
		);
		const bugs = [...finals.values()];
		rows.forEach((row, i) => {
			const bug = bugs[i];
			if (bug !== undefined && bug !== (row === BOX.final.toLowerCase()))
				out.push(`the Matchup bug and Team row ${String(i + 1)} disagree on Final ("${row}")`);
		});
	}
	for (const [team, final] of finals) {
		const seen = finalsSeen.get(team) ?? new Map<string, boolean>();
		for (const [where, other] of seen)
			if (where !== screen.name && other !== final)
				out.push(`${team} reads ${final ? 'Final' : 'Proj final'} here, the other on the ${where}`);
		seen.set(screen.name, final);
		finalsSeen.set(team, seen);
	}
	return out;
}

const SCREENS: Readonly<Record<Day, readonly Screen[]>> = {
	saturday: leagueScreens(false),
	sunday: leagueScreens(false),
	monday: leagueScreens(true),
	tuesday: leagueScreens(true),
	wednesday: leagueScreens(false),
	thursday: [{ name: 'trades', path: `${LEAGUE}/trades`, ready: 'Our ideas', platform: null }]
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

async function context(width: number, theme: 'dark' | 'light'): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme
	});
	watchData(ctx);
	await installFixtureClock(ctx, clock);
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
	// The rules our stats omit, framed by the clock (Lane 115, B92): Waivers' free agents beside a
	// drop on the platform's points say the stats' sentence too.
	if (!['trades', 'matchup'].includes(screen.name)) {
		const counted = screen.platform === true;
		const frame = counted ? STATS_OMIT : OURS_OMIT;
		if (!frame.test(basis.text))
			faults.push(`${at}: the rules our stats omit are not said as "${frame.source}"`);
	}
	if (screen.name === 'players' && width === 390 && screen.platform === true)
		if (!basis.text.includes("rostered players' Sleeper finals"))
			faults.push(`${at}: the order's phone does not say rostered players' finals`);
	if (screen.name === 'lineup' && !PICK_SAID.test(basis.text))
		faults.push(`${at}: the Lineup does not say its pick rule`);
}

/** The rules our stats omit in the stats' words, and in Avg and Last's where no row counts the
 * platform's points (basis.ts UNCOUNTED). */
const STATS_OMIT = new RegExp(escaped(UNCOUNTED.stats(LEAGUE_RULES_NOTE)));
const OURS_OMIT = new RegExp(escaped(UNCOUNTED.ours(LEAGUE_RULES_NOTE)));

function escaped(words: string): string {
	return words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** The Lineup's pick rule: the desk's sentence or the phone's clause (basis.ts, Lane 115, B83). */
const PICK_SAID = /Our pick (starts the highest Proj at each slot|is each slot's highest Proj)/;

/** Every name in a Lineup or Matchup row drawn on one line and whole (Lane 115, B83, B90): the names
 * drawn taller than a line, and those whose whole form shows cut where the short one should stand. */
async function wrappedNames(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const shown = [...document.querySelectorAll<HTMLElement>('main table .pl .nm')].filter(
			(nm) => nm.getClientRects().length > 0
		);
		const tall = shown.filter((nm) => {
			const line = parseFloat(getComputedStyle(nm).lineHeight);
			return nm.getBoundingClientRect().height > line * 1.5;
		});
		const cut = shown.filter((nm) => {
			const fit = nm.querySelector('.fit');
			const full = nm.querySelector('.fit-full');
			const short = nm.querySelector('.fit-short');
			if (fit === null || full === null || short === null) return false;
			const box = fit.getBoundingClientRect();
			const drawn = full.getBoundingClientRect();
			const fullShown = drawn.top < box.bottom - 1;
			// The whole name past the line, or the short form cut with an ellipsis (fix round 1, LOW-2).
			return fullShown ? drawn.right > box.right + 1 : short.scrollWidth > short.clientWidth + 1;
		});
		return [...tall, ...cut].map((nm) => nm.innerText.trim());
	});
}

/** The strips' one rule (Lane 115, B87): the first of more than one card says Best. */
async function stripFaults(page: Page): Promise<string[]> {
	const firsts = await page.evaluate(() =>
		[...document.querySelectorAll('main [data-strip]')].map((strip) => {
			const cards = [...strip.querySelectorAll('li')];
			return {
				count: cards.length,
				mark: cards[0]?.querySelector('.mark')?.textContent.trim() ?? ''
			};
		})
	);
	return firsts
		.filter((f) => f.count > 1 && f.mark.toLowerCase() !== STRIP.best.toLowerCase())
		.map(() => 'the first card of the strip does not say Best');
}

for (const theme of THEMES)
	for (const screen of SCREENS[day]) {
		for (const width of WIDTHS) {
			const ctx = await context(width, theme);
			const page = await ctx.newPage();
			const at = `${day} ${screen.name} ${theme} ${String(width)}`;
			try {
				await page.goto(`${web}${screen.path}`);
				await ready(page, screen.ready);
				// The Trades screen is its builder, open as it loads (Lane 260).
				if (screen.open === 'builder') await ready(page, BUILDER_READY);
				const team = await teamFaults(page, screen);
				measures.push(
					`${at}: bug Final ${[...(await bugFinals(page, screen)).entries()].map(([n, f]) => `${n}=${String(f)}`).join(', ')}`
				);
				measures.push(
					`${at}: Team ${team.captions.length > 0 ? team.captions.join(', ') : 'none'}`
				);
				for (const fault of team.faults) faults.push(`${at}: ${fault}`);
				const basis = await drawnBasis(page);
				if (screen.teamOnly !== true) check(screen, width, basis, at);
				const lines = await basisLines(page);
				measures.push(`${at}: basis ${String(lines)} lines`);
				if (lines === 0 || lines > MOST_LINES[width])
					faults.push(`${at}: basis draws ${String(lines)} lines`);
				const copy = await copyFault(page);
				if (copy !== null) faults.push(`${at}: ${copy}`);
				if (width === 390 && ['lineup', 'matchup'].includes(screen.name))
					for (const name of await wrappedNames(page))
						faults.push(`${at}: "${name}" takes two lines or is cut`);
				for (const fault of await stripFaults(page)) faults.push(`${at}: ${fault}`);
				await page.screenshot({
					path: new URL(`${screen.name}-${day}-${theme}-${String(width)}.png`, out).pathname,
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
