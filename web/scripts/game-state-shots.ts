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
import { BASIS_BUDGET, basisLines } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
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
	await checkOneRest(page, at);
}

/** Lane 86 (review H3): his rest of season is one figure on the page, at every clock: the card's tile,
 * the read's lead figure, the every-format table's PPR row and his line in the tier box. */
async function checkOneRest(page: Page, at: string): Promise<void> {
	const text = async (selector: string): Promise<string> =>
		(await page.locator(selector).first().innerText()).trim();
	const figures = {
		tile: await text('.tiles .tile:has(.lb:text-is("Rest of season")) .fig'),
		read: await text('.pulls b'),
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
