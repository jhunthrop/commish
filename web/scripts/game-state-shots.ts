// Screenshots of a game's three states through week 6's Sunday and after (Lane 80), dark and light at
// 1440 and dark at 390, on one of the fixture's clocks (inseason-fixture/clock.ts):
//   sunday   the noon games under way: Kicked off, no expected score or weather on those rows;
//   monday   every Sunday game final by the hourly status, its stats not in yet;
//   tuesday  every week 6 game final.
// The fixture API must run on the same clock (FIXTURE_CLOCK); it stamps every game with the API's state
// at it, the finals from the hourly status rows (inseason-fixture/game-state.ts).
// SET=contract (the site built from the contract run, 2026-10-21T12-ros): the board's RB tab signed in,
// /players, Josh Allen's card (his live week replaces the run's week still to play: still to play on
// Sunday, Final after), the schedule and the clubs (Rest of season strength, never the
// preseason's). SET=standin (the site built from the stand-in run): Jaxson Dart's card, whose live week
// replaces the run's week still to play, so his week 6 shows one state.
// SET=standin on Monday and Tuesday also shoots the fixture league's screens (Lane 85): the League
// page's score bugs never say "Next kickoff" for a game past its kickoff (Final or Kicked off, a time
// only for Monday night's still to come), the Lineup offers no move on a player whose game has kicked
// off and on Tuesday says the week is over with no verb, Waivers and Trades draw no "Proj
// this week" on Tuesday, the Matchup's bug says Final on Tuesday, and each basis says when the stats
// land.
// Every screen: the basis says when Final and the stats land while a row waits on either, never claims
// a week a Sunday player's GP does not reach, and stays within five rendered lines at 1440 and eight
// at 390 (basis-lines.ts); the copy passes the one guard (copy-scan.ts); nothing scrolls sideways.
// Exits non-zero on any fault.
//
//   CLOCK=sunday|monday|tuesday SET=contract|standin node scripts/game-state-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { KICKED_OFF_PART } from '../src/lib/league/box/basis.ts';
import { STRENGTH_HEADS } from '../src/lib/run/strength-words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { BASIS_BUDGET, basisLines, figureSentenceFaults } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { EMPTY_FIGURE } from '../src/lib/format/empty.ts';
import { seasonOrderWords } from '../src/lib/league/box/waivers.ts';
import {
	FIXTURE_MONDAY_CLOCK,
	FIXTURE_SUNDAY_CLOCK,
	FIXTURE_TUESDAY_CLOCK
} from './inseason-fixture/clock.ts';

const CLOCKS = {
	sunday: FIXTURE_SUNDAY_CLOCK,
	monday: FIXTURE_MONDAY_CLOCK,
	tuesday: FIXTURE_TUESDAY_CLOCK
} as const;
type Day = keyof typeof CLOCKS;
const day = (process.env.CLOCK ?? 'sunday') as Day;
const clock = CLOCKS[day];
const set = process.env.SET === 'standin' ? 'standin' : 'contract';
const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? `../screenshots/game-state/${day}/`, import.meta.url);
const SHOTS: readonly (readonly ['dark' | 'light', number])[] = [
	['dark', 1440],
	['light', 1440],
	['dark', 390]
];
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const KICKED_OFF = 'Kicked off';
const FINAL = 'Final';
/** Words a game past its kickoff never carries: its expected score and its weather. */
const AFTER_KICKOFF = /Roof TBD|\d+(\.5)? to \d+(\.5)?\b/;
/** The state a card's week 6 game shows on each clock, null while it is still to play: Jaxson Dart's
 * NYG at NO kicks off Sunday at noon Eastern, Josh Allen's BUF at LV at 3:25 pm. */
type CardWeek = Readonly<Record<Day, string | null>>;
const DART_WEEK: CardWeek = { sunday: KICKED_OFF, monday: FINAL, tuesday: FINAL };
const ALLEN_WEEK: CardWeek = { sunday: null, monday: FINAL, tuesday: FINAL };
const CARDS: Readonly<Record<string, CardWeek>> = {
	'jaxson-dart': DART_WEEK,
	'josh-allen': ALLEN_WEEK
};

interface Screen {
	name: string;
	path: string;
	set: 'contract' | 'standin';
	signedIn: boolean;
	ready: string;
	/** The API's rows: their Game cells read the state. */
	rows: string | null;
	/** The run's strength head the page prints, if it prints one. */
	strength: boolean;
}

const SCREENS: readonly Screen[] = [
	{
		name: 'board-rb',
		path: '/board/ppr-12/rb',
		set: 'contract',
		signedIn: true,
		ready: 'Our rest-of-season order',
		rows: 'table.order tbody tr',
		strength: false
	},
	{
		name: 'players',
		path: '/players',
		set: 'contract',
		signedIn: false,
		ready: 'Find a player',
		rows: 'table.order tbody tr',
		strength: false
	},
	{
		name: 'josh-allen',
		path: '/players/josh-allen',
		set: 'contract',
		signedIn: false,
		ready: 'Josh Allen',
		rows: null,
		strength: false
	},
	{
		name: 'schedule',
		path: '/schedule',
		set: 'contract',
		signedIn: false,
		ready: 'schedule strength',
		rows: null,
		strength: true
	},
	{
		name: 'clubs',
		path: '/clubs',
		set: 'contract',
		signedIn: false,
		ready: 'Clubs',
		rows: null,
		strength: true
	},
	{
		name: 'jaxson-dart',
		path: '/players/jaxson-dart',
		set: 'standin',
		signedIn: true,
		ready: 'Still to play',
		rows: null,
		strength: false
	}
];

const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
const fixture = await (
	await fetch(`${API_ORIGIN}/fixture/clock`)
).json<{
	data: { clock: string | null } | null;
}>();
if (fixture.data?.clock !== clock)
	throw new Error(
		`The fixture API at ${API_ORIGIN} runs on ${fixture.data?.clock ?? 'the real clock'}: start it with FIXTURE_CLOCK=${clock}.`
	);

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];
const fault = (at: string, what: string): void => {
	faults.push(`${at}: ${what}`);
};

async function context(theme: string, width: number, signedIn: boolean): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light'
	});
	watchData(ctx);
	await ctx.clock.install({ time: new Date(clock) });
	if (signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
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

/** The API's rows: Kicked off only while a game is under way (Sunday), none on Monday or Tuesday,
 * and no expected score or weather on a row whose game is past its kickoff. */
async function checkRows(page: Page, screen: Screen, at: string): Promise<void> {
	if (screen.rows === null) return;
	const rows = await page.locator(screen.rows).allInnerTexts();
	if (rows.length === 0) fault(at, 'no rows');
	const kicked = rows.filter((text) => text.includes(KICKED_OFF));
	const final = rows.filter((text) => text.includes(FINAL));
	if (day === 'sunday' && kicked.length === 0) fault(at, 'no row says Kicked off on Sunday');
	if (day !== 'sunday' && kicked.length > 0)
		fault(at, `${String(kicked.length)} rows say Kicked off on ${day}`);
	if (day !== 'sunday' && final.length === 0) fault(at, `no row says Final on ${day}`);
	for (const text of [...kicked, ...final]) {
		if (AFTER_KICKOFF.test(text))
			fault(at, `a played row carries its expected score or weather: ${text}`);
	}
}

/** A card: his live week in the accent row with the clock's state (the API's, which takes the run's
 * place), no expected score once played, and week 6 shown once. */
async function checkCard(page: Page, week: CardWeek, at: string): Promise<void> {
	const accent = await page.locator('tr.next').innerText();
	const state = week[day];
	if (state === null) {
		if (accent.includes(KICKED_OFF) || accent.includes(FINAL))
			fault(at, `his week 6 is still to play but reads "${accent}"`);
	} else {
		if (!accent.includes(state)) fault(at, `his week 6 reads "${accent}", not ${state}`);
		if (AFTER_KICKOFF.test(accent))
			fault(at, `his played week carries its expected score: ${accent}`);
	}
	const ahead = await page.locator('section.ahead li').allInnerTexts();
	if (ahead.some((text) => /^Wk 6\b/.test(text.trim())))
		fault(at, 'week 6 shows twice, in the accent row and still to play');
}

async function checkPage(page: Page, screen: Screen, width: number, at: string): Promise<void> {
	const text = await page.locator('main').innerText();
	await checkRows(page, screen, at);
	const card = CARDS[screen.name];
	if (card !== undefined) await checkCard(page, card, at);
	// Sunday's rows wait on their finals, Monday's on their stats: the basis says when each lands, at a
	// desk and on a phone (review finding 6).
	if (day !== 'tuesday' && screen.rows !== null && !text.includes(KICKED_OFF_PART))
		fault(at, 'the basis does not say when Final and the stats land');
	if (/through week 6(?! and)/.test(text) && day !== 'tuesday')
		fault(at, 'a basis claims week 6 over Sunday players');
	if (screen.strength) {
		if (!text.includes(STRENGTH_HEADS.rest)) fault(at, `no ${STRENGTH_HEADS.rest}`);
		if (text.includes(STRENGTH_HEADS.preseason)) fault(at, `${STRENGTH_HEADS.preseason} in season`);
	}
	const lines = await basisLines(page);
	const budget = BASIS_BUDGET[width];
	if (budget !== undefined && lines > budget)
		fault(at, `basis ${String(lines)} lines, over ${String(budget)}`);
	const sideways = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth
	);
	if (sideways) fault(at, 'scrolls sideways');
	const copy = await copyFault(page);
	if (copy !== null) fault(at, copy);
	process.stdout.write(`${at}: basis ${String(lines)} lines\n`);
}

/** The fixture league's screens after its Sunday (Lane 85). */
interface LeagueScreen {
	name: string;
	path: string;
	ready: string;
	check: (page: Page, at: string) => Promise<void>;
}
const LEAGUE = `/league/${FIXTURE_IDS.league}`;
/** The Lineup's players whose games are still to come on Monday: Monday night's. */
const MONDAY_NIGHT_MOVES = ['Kirk'];
const WEEK_DONE = "Every starter's game is final, so week 6 is over.";

async function checkBugs(page: Page, at: string): Promise<void> {
	const bugs = await page.locator('main .bug').evaluateAll((els) =>
		els.map((el) => ({
			head: el.querySelector('.st')?.textContent.trim() ?? '',
			words: el.querySelector('.sw')?.textContent.trim() ?? ''
		}))
	);
	if (bugs.length === 0) fault(at, 'no score bug');
	for (const bug of bugs) {
		const past = bug.head === KICKED_OFF || bug.head === FINAL;
		if (day === 'tuesday' && bug.head !== FINAL) fault(at, `a bug reads ${bug.head} on Tuesday`);
		// Only Monday night's kickoff is still to come on Monday.
		if (!past && !(day === 'monday' && bug.head.startsWith('Mon ')))
			fault(at, `a bug reads "${bug.head} ${bug.words}", a kickoff already past`);
	}
}

async function checkLineup(page: Page, at: string): Promise<void> {
	const chips = await page.locator('main .swaps li:not(.idle)').allInnerTexts();
	const moved = chips.filter((c) => !MONDAY_NIGHT_MOVES.some((name) => c.includes(name)));
	if (moved.length > 0)
		fault(at, `a move on a player whose game has kicked off: ${moved.join(', ')}`);
	const text = await page.locator('main').innerText();
	const verb = await page.getByText('Copy the lineup').filter({ visible: true }).count();
	if (day === 'tuesday') {
		if ((await page.locator('main .swaps li').count()) > 0)
			fault(at, 'a change or an empty spot named on a finished week');
		if (!text.includes(WEEK_DONE)) fault(at, 'the finished week is not said');
		if (verb > 0) fault(at, 'a verb on a finished week');
	} else if (text.includes(WEEK_DONE)) fault(at, 'the week is said over on Monday');
}

async function checkNoWeekFigure(page: Page, at: string, words: string): Promise<void> {
	const text = await page.locator('main').innerText();
	if (day === 'tuesday' && text.includes(words)) fault(at, `"${words}" on a finished week`);
}

/** Whether a visible row draws an expected score ("29 to 21.5") or weather. */
async function drawsFacts(page: Page): Promise<boolean> {
	const rows = await page
		.locator('main table tbody tr')
		.evaluateAll((trs) =>
			trs.filter((tr) => tr.getClientRects().length > 0).map((tr) => (tr as HTMLElement).innerText)
		);
	return rows.some((r) => /\b\d+(\.5)? to \d+(\.5)?\b|\d+°|Indoors|Roof TBD/.test(r));
}

/** Waivers after the Sunday (review H3): a row whose game is past its kickoff draws no week gain in
 * Beats, and the basis names the season Gain as the pickups' order. */
async function checkWaivers(page: Page, at: string): Promise<void> {
	await checkNoWeekFigure(page, at, 'Proj this week');
	const rows = await page.locator('main table tbody tr').evaluateAll((trs) =>
		trs
			.filter((tr) => tr.getClientRects().length > 0)
			.map((tr) => ({
				text: (tr as HTMLElement).innerText,
				gain: tr.querySelector('.beats .gain')?.textContent.trim() ?? null
			}))
	);
	const final = rows.filter((r) => /\b(Final|Kicked off)\b/.test(r.text) && r.gain !== null);
	if (final.length === 0) fault(at, 'no row past its kickoff with a Beats cell');
	for (const r of final)
		if (r.gain !== EMPTY_FIGURE) fault(at, `a row past its kickoff draws a week gain ${r.gain}`);
	const basis = (await page.locator('main [data-basis]').allInnerTexts()).join(' ');
	if (!basis.includes(seasonOrderWords(6)))
		fault(at, 'the basis does not name the season Gain order');
}

async function checkMatchup(page: Page, at: string): Promise<void> {
	const mid = ((await page.locator('main .bug .mid').textContent()) ?? '').replace(/\s+/g, ' ');
	if (day === 'tuesday' && !mid.includes(FINAL)) fault(at, `the Matchup's bug reads "${mid}"`);
	if (mid.includes('kickoff') && !(day === 'monday' && mid.includes('Mon ')))
		fault(at, `the Matchup's bug reads "${mid}", a kickoff already past`);
}

const LEAGUE_SCREENS: readonly LeagueScreen[] = [
	{ name: 'league', path: LEAGUE, ready: 'Every game this week, yours first.', check: checkBugs },
	{ name: 'lineup', path: `${LEAGUE}/start`, ready: 'Week 6', check: checkLineup },
	{ name: 'matchup', path: `${LEAGUE}/matchup`, ready: 'Week 6', check: checkMatchup },
	{
		name: 'waivers',
		path: `${LEAGUE}/waivers`,
		ready: 'Open Sleeper waivers',
		check: checkWaivers
	},
	{
		name: 'trades',
		path: `${LEAGUE}/trades`,
		ready: 'worth proposing',
		check: (page, at) => checkNoWeekFigure(page, at, 'Proj for you this week')
	}
];

for (const screen of set === 'standin' && day !== 'sunday' ? LEAGUE_SCREENS : []) {
	for (const [theme, width] of SHOTS) {
		const ctx = await context(theme, width, true);
		const page = await ctx.newPage();
		const at = `${day} ${screen.name} ${theme} ${String(width)}`;
		try {
			await page.goto(`${web}${screen.path}`);
			await ready(page, screen.ready);
			await screen.check(page, at);
			// Every row waits on its stats on Monday and Tuesday: each box screen's basis says when they
			// land (the League page's basis is its standings').
			if (
				screen.name !== 'league' &&
				!(await page.locator('main').innerText()).includes(KICKED_OFF_PART) &&
				// The Lineup phone keeps the fact cells while a row still draws them, the Final sentence
				// then the desk's alone (Lane 85 fix round 2 ruling); on Tuesday none does.
				!(screen.name === 'lineup' && width === 390 && (await drawsFacts(page)))
			)
				fault(at, 'the basis does not say when Final and the stats land');
			if (
				screen.name === 'lineup' &&
				width === 390 &&
				day === 'tuesday' &&
				(await drawsFacts(page))
			)
				fault(at, 'a Tuesday row draws an expected score or weather');
			const lines = await basisLines(page);
			const budget = BASIS_BUDGET[width];
			if (budget !== undefined && lines > budget)
				fault(at, `basis ${String(lines)} lines, over ${String(budget)}`);
			// Every figure drawn at this width keeps its sentence in the basis drawn here (review H2).
			if (screen.name !== 'league')
				for (const said of await figureSentenceFaults(page)) fault(at, said);
			if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
				fault(at, 'scrolls sideways');
			const copy = await copyFault(page);
			if (copy !== null) fault(at, copy);
			process.stdout.write(`${at}: basis ${String(lines)} lines\n`);
			const name = `${screen.name}-${theme}-${String(width)}`;
			await page.screenshot({ path: new URL(`${name}-top.png`, out).pathname });
			if (theme === 'dark')
				await page.screenshot({ path: new URL(`${name}.png`, out).pathname, fullPage: true });
		} catch (error) {
			fault(at, error instanceof Error ? error.message : String(error));
		} finally {
			await ctx.close();
		}
	}
}

for (const screen of SCREENS.filter((s) => s.set === set)) {
	for (const [theme, width] of SHOTS) {
		const ctx = await context(theme, width, screen.signedIn);
		const page = await ctx.newPage();
		const at = `${day} ${screen.name} ${theme} ${String(width)}`;
		try {
			await page.goto(`${web}${screen.path}`);
			await ready(page, screen.ready);
			if (CARDS[screen.name] !== undefined)
				await page.locator('tr.next').waitFor({ timeout: READY_TIMEOUT_MS });
			await checkPage(page, screen, width, at);
			const name = `${screen.name}-${theme}-${String(width)}`;
			await page.screenshot({ path: new URL(`${name}-top.png`, out).pathname });
			if (theme === 'dark')
				await page.screenshot({ path: new URL(`${name}.png`, out).pathname, fullPage: true });
		} catch (error) {
			fault(at, error instanceof Error ? error.message : String(error));
		} finally {
			await ctx.close();
		}
	}
}
await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`${day} ${set}: every screen holds\n`);
