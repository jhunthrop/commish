// Screenshots of a game's three states through week 6's Sunday and after (Lane 80), dark and light at
// 1440 and dark at 390, on one of the fixture's clocks (inseason-fixture/clock.ts):
//   sunday   the noon games under way: Kicked off, no expected score or weather on those rows;
//   monday   every Sunday game final by the hourly status, its stats not in yet;
//   tuesday  every week 6 game final.
// The fixture API must run on the same clock (FIXTURE_CLOCK); it stamps every game with the API's state
// at it, the finals from the hourly status rows (inseason-fixture/game-state.ts).
// SET=contract (the site built from the Saturday run, inseason-fixture/saturday-run.ts: the contract run,
// 2026-10-21T12-ros, moved back to the fixture week's Saturday, Lane 86; the fixture API started with
// FIXTURE_RUN_ID=2026-10-17T17-ros, `npm run shots` does both): the board's RB tab signed in,
// /players, Josh Allen's card (his live week replaces the run's week still to play: still to play on
// Sunday, Final after), the schedule and the clubs (Rest of season strength, never the
// preseason's). SET=standin (the site built from the stand-in run): Jaxson Dart's card, whose live week
// replaces the run's week still to play, so his week 6 shows one state.
// SET=standin on Monday and Tuesday also shoots the fixture league's screens (Lane 85): the League
// page's score bugs never say "Next kickoff" for a game past its kickoff (Final or Kicked off, a time
// only for Monday night's still to come), the Lineup offers no move on a player whose game has kicked
// off and on Tuesday says every starter has played with no verb, Waivers and Trades draw no "Proj
// this week" on Tuesday, the Matchup's bug says Final on Tuesday, and each basis says when the stats
// land.
// Every screen: the basis says when Final and the stats land while a row waits on either, never claims
// a week a Sunday player's GP does not reach, and stays within five rendered lines at 1440 and eight
// at 390 (basis-lines.ts); the copy passes the one guard (copy-scan.ts); nothing scrolls sideways.
// Exits non-zero on any fault.
//
//   CLOCK=sunday|monday|tuesday SET=contract|standin node scripts/game-state-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API.
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { STATS_BY_WEDNESDAY } from '../src/lib/league/box/basis.ts';
import { CARD } from '../src/lib/player/card.ts';
import { STRENGTH_HEADS } from '../src/lib/run/strength-words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { BASIS_BUDGET, WEATHER_FIGURE, basisLines, figureSentenceFaults } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { seasonOrderWords } from './inseason-fixture/waivers-at.ts';
import { WEEK_DONE } from './inseason-fixture/sunday.ts';
import { lineupSpent, TURNED_WEEK } from './inseason-fixture/turn.ts';
import type { LineupAdvice } from '../src/lib/league/inseason/api.ts';
import { SEASON } from '../src/lib/league/box/season.ts';
import { BOX } from '../src/lib/league/box/box.ts';
import { TRADES } from '../src/lib/league/box/trades.ts';
import { beatsPlace, shortName } from '../src/lib/league/box/waivers.ts';
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
/** MarShawn Lloyd's GB vs DAL is Sunday night's (Lane 86, re-review N5): a back whose tier box lists
 * the run's three backs, each on his own club's clock. */
const LLOYD_WEEK: CardWeek = { sunday: null, monday: FINAL, tuesday: FINAL };
const CARDS: Readonly<Record<string, CardWeek>> = {
	'jaxson-dart': DART_WEEK,
	'josh-allen': ALLEN_WEEK,
	'marshawn-lloyd': LLOYD_WEEK
};
/** The front's heading in the run's words (review H2): the Saturday run's partly played week 6. */
const FRONT_HEADING = "Our board for the rest of the 2026 season from week 6's games left";

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
		name: 'marshawn-lloyd',
		path: '/players/marshawn-lloyd',
		set: 'contract',
		signedIn: false,
		ready: 'MarShawn Lloyd',
		rows: null,
		strength: false
	},
	{
		name: 'front',
		path: '/',
		set: 'contract',
		signedIn: false,
		ready: 'Our board for the rest of',
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
	await checkOneRest(page, at);
}

/** Lane 86 (review H3): his rest of season is one figure on the page, at every clock: the card's tile,
 * the read's lead figure, the every-format table's PPR row and his line in the tier box. */
async function checkOneRest(page: Page, at: string): Promise<void> {
	const text = async (selector: string): Promise<string> =>
		(await page.locator(selector).first().innerText()).trim();
	// The one rule for whether the page has a rest of season to hold to one figure: the card's tile
	// head. A run of the full season (the stand-in) heads it Projected and draws no rest-of-season
	// figure anywhere; any other head is held to the check.
	const heads = (await page.locator('.tiles .tile .lb').allTextContents()).map((head) =>
		head.trim()
	);
	if (heads.includes(CARD.projected) && !heads.includes(CARD.rest)) {
		process.stdout.write(
			`${at}: four-figure check skipped: the run ranks the full season (the card's tile reads "${CARD.projected}"), so the page draws no rest-of-season figure\n`
		);
		return;
	}
	// A page whose read is not written yet has no lead figure beside it.
	const read = (await page.locator('.pulls b').count()) > 0 ? { read: await text('.pulls b') } : {};
	const figures = {
		tile: await text(`.tiles .tile:has(.lb:text-is("${CARD.rest}")) .fig`),
		...read,
		table: await text('section[aria-label="Every format"] tbody tr:first-child td:nth-child(3)'),
		tier: await text('.mates .line.current .end')
	};
	if (new Set(Object.values(figures)).size !== 1)
		fault(at, `his rest of season is more than one figure: ${JSON.stringify(figures)}`);
}

async function checkPage(page: Page, screen: Screen, width: number, at: string): Promise<void> {
	const text = await page.locator('main').innerText();
	await checkRows(page, screen, at);
	const card = CARDS[screen.name];
	if (card !== undefined) await checkCard(page, card, at);
	if (screen.name === 'front' && !text.includes(FRONT_HEADING))
		fault(at, `the front's heading is not "${FRONT_HEADING}"`);
	if (screen.name === 'marshawn-lloyd' && (await page.locator('.mates li').count()) < 3)
		fault(at, 'his tier box lists fewer than three players');
	// Sunday's rows wait on their finals, Monday's on their stats: the basis says when each lands, at a
	// desk and on a phone (review finding 6).
	if (day !== 'tuesday' && screen.rows !== null && !text.includes(STATS_BY_WEDNESDAY))
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
		if (!text.includes(WEEK_DONE)) fault(at, 'every starter played is not said');
		if (verb > 0) fault(at, 'a verb on a finished week');
	} else if (text.includes(WEEK_DONE)) fault(at, 'every starter is said played on Monday');
}

async function checkNoWeekFigure(page: Page, at: string, words: string): Promise<void> {
	const text = await page.locator('main').innerText();
	if (day === 'tuesday' && text.includes(words)) fault(at, `"${words}" on a finished week`);
}

/** The fixture's Lineup, whose starters' games decide the week turn. */
const FIXTURE_LINEUP = JSON.parse(
	readFileSync(new URL('./inseason-fixture/data/lineup.json', import.meta.url), 'utf8')
) as LineupAdvice;
/** The screens that turn to the next week once every starter of the member's has played (Lane 95). */
const TURNING_SCREENS = new Set(['waivers', 'trades']);
/** Whether Waivers and Trades address the next week at the clock, by the fixture API's own rule over
 * its Lineup (turn.ts lineupSpent): the expectation comes from the clock, never from the screen
 * (Lane 115, B90). Their rows are then all still to play and wait on nothing. */
const TURNED = lineupSpent(FIXTURE_LINEUP, Date.parse(clock));

function addressesNextWeek(screen: string): boolean {
	return TURNED && TURNING_SCREENS.has(screen);
}

/** The strip names the week the clock says it addresses: the next week's once turned. */
async function checkStripWeek(page: Page, at: string, screen: string): Promise<void> {
	if (!TURNING_SCREENS.has(screen)) return;
	const head = (await page.locator('main [data-strip] .wk').allTextContents()).join(' ');
	const want = addressesNextWeek(screen) ? TURNED_WEEK : FIXTURE_LINEUP.week;
	if (!new RegExp(String.raw`\b${String(want)}\b`).test(head))
		fault(at, `the strip says "${head}", not week ${String(want)}`);
}

/** Whether a visible row draws an expected score ("29 to 21.5") or weather. */
async function drawsFacts(page: Page): Promise<boolean> {
	const rows = await page
		.locator('main table tbody tr')
		.evaluateAll((trs) =>
			trs.filter((tr) => tr.getClientRects().length > 0).map((tr) => (tr as HTMLElement).innerText)
		);
	return rows.some((r) => /\b\d+(\.5)? to \d+(\.5)?\b/.test(r) || WEATHER_FIGURE.test(r));
}

/** Waivers after the Sunday (Lane 85 fix rounds 4 and 5): once any row is past its kickoff (every row
 * on Tuesday) the page is in the API's season Gain order: every row's Beats draws its season Gain, the
 * key the order sorts by, never a week figure, and ends left of the Add button; the strip's pick is the
 * table's top row, and the basis names the order. */
async function checkWaivers(page: Page, at: string): Promise<void> {
	await checkNoWeekFigure(page, at, 'Proj this week');
	const rows = await page.locator('main table tbody tr').evaluateAll((trs) =>
		trs
			.filter((tr) => tr.getClientRects().length > 0 && tr.querySelector('.nm') !== null)
			.map((tr) => ({
				text: (tr as HTMLElement).innerText,
				name: tr.querySelector<HTMLElement>('.nm')?.innerText.trim() ?? '',
				named: tr.classList.contains('moved-in'),
				gain: tr.querySelector('.beats .gain')?.textContent.trim() ?? null,
				beats: tr.querySelector('.beats .who')?.textContent.trim() ?? '',
				// A row with no gain over the roster draws its figure bare and quiet (Lane 98, B13).
				quiet: tr.querySelector('.beats .gain.quiet') !== null,
				// The Beats text's right edge and the Add button's left (review M-J).
				beatsRight: tr.querySelector('.beats .bt')?.getBoundingClientRect().right ?? null,
				addLeft: tr.querySelector('.act .add')?.getBoundingClientRect().left ?? null
			}))
	);
	const locked = rows.filter((r) => /\b(Final|Kicked off)\b/.test(r.text));
	const toPlay = rows.filter((r) => !locked.includes(r) && !r.text.includes(BOX.bye));
	// Addressing the next week, every row is still to play and none is past its kickoff.
	const next = addressesNextWeek('waivers');
	if (day === 'tuesday' && !next && toPlay.length > 0)
		fault(at, `${String(toPlay.length)} rows still to play on a finished week`);
	// The season Gain order below is the played week's, once a row is past its kickoff (Lane 85).
	if (next) {
		if (locked.length > 0)
			fault(at, `${String(locked.length)} rows of the next week past their kickoff`);
		// The fixture's McConkey (LAC) sits week 7: a row he is the Beats of names his bye in the week
		// addressed (Lane 108, B81; Lane 115, B90).
		const onBye = beatsPlace({ name: '', starter: true, bye: true });
		if (!rows.some((r) => r.beats.includes(onBye)))
			fault(at, `no Beats cell says "${onBye}" on the turned week`);
		return;
	}
	if (locked.length === 0) {
		fault(at, 'no row past its kickoff');
		return;
	}
	// In the season Gain order every row's Beats draws its season Gain, the key it is sorted by (M-I),
	// bare and quiet on a row with no gain (Lane 98, B13).
	for (const r of rows) {
		if (!r.quiet && !r.gain?.endsWith(` ${SEASON.gain}`))
			fault(at, `${r.name} draws ${r.gain ?? 'no figure'} in Beats, not its season Gain`);
		if (r.quiet && r.gain?.endsWith(` ${SEASON.gain}`))
			fault(at, `${r.name} draws a loud ${r.gain} under the divider`);
		if (r.beatsRight !== null && r.addLeft !== null && r.beatsRight > r.addLeft)
			fault(at, `${r.name}'s Beats runs under the Add button`);
	}
	const top = rows[0];
	const moves = await page.locator('main [data-strip="waivers"] .pickup .move').allInnerTexts();
	if (
		top === undefined ||
		!top.named ||
		moves.length !== 1 ||
		!(moves[0] ?? '').includes(shortName(top.name))
	)
		fault(at, `the strip ${JSON.stringify(moves)} is not the top row ${top?.name ?? 'none'}`);
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
		ready: 'Our ideas',
		check: (page, at) => checkNoWeekFigure(page, at, TRADES.projForYou)
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
			await checkStripWeek(page, at, screen.name);
			// Every row waits on its stats on Monday and Tuesday: each box screen's basis says when they
			// land (the League page's basis is its standings'), but a screen on the next week's rows has
			// none waiting (Lane 95).
			if (
				screen.name !== 'league' &&
				!addressesNextWeek(screen.name) &&
				!(await page.locator('main').innerText()).includes(STATS_BY_WEDNESDAY) &&
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
/** A lagging read (Lane 85 fix round 2, H-A): on Sunday the API's kicked-off games are rewritten to
 * upcoming on the wire, so only the page's clock is past their kickoffs. The one rule (lineState)
 * still reads them kicked off: the board's rows say Kicked off and the basis says when Final and the
 * stats land. The week tab's sections are held by the same rule in its unit test (order/week.test.ts),
 * the stand-in run carrying no kickers' board to shoot. */
const LAGGING: readonly {
	set: 'contract' | 'standin';
	name: string;
	path: string;
	ready: string;
	section: boolean;
}[] = [
	{
		set: 'contract',
		name: 'board-rb',
		path: '/board/ppr-12/rb',
		ready: 'Our rest-of-season order',
		section: false
	}
];
for (const lag of day === 'sunday' ? LAGGING.filter((l) => l.set === set) : []) {
	const ctx = await context('dark', 1440, true);
	await ctx.route(`${API_ORIGIN}/**`, async (route) => {
		const response = await route.fetch();
		const body = (await response.text())
			.replaceAll('"game_state":"kicked_off"', '"game_state":"upcoming"')
			.replaceAll('"section":"kicked_off"', '"section":"to_play"');
		await route.fulfill({ response, body });
	});
	const page = await ctx.newPage();
	const at = `${day} lagging ${lag.name}`;
	try {
		await page.goto(`${web}${lag.path}`);
		await ready(page, lag.ready);
		const rows = await page.locator('main table tbody tr').allInnerTexts();
		if (!rows.some((t) => t.includes(KICKED_OFF)))
			fault(at, 'no row reads Kicked off on a lagging read');
		if (lag.section) {
			const misplaced = await page
				.locator('main tbody.to_play tr')
				.filter({ hasText: KICKED_OFF })
				.count();
			if (misplaced > 0)
				fault(at, `${String(misplaced)} kicked-off rows under the to-play section`);
		}
		if (!(await page.locator('main').innerText()).includes(STATS_BY_WEDNESDAY))
			fault(at, 'the basis does not say when Final and the stats land');
		await page.screenshot({
			path: new URL(`lagging-${lag.name}-dark-1440.png`, out).pathname,
			fullPage: true
		});
		process.stdout.write(`${at}: holds\n`);
	} catch (error) {
		fault(at, error instanceof Error ? error.message : String(error));
	} finally {
		await ctx.close();
	}
}
await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`${day} ${set}: every screen holds\n`);
