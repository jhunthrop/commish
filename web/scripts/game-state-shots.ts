// Screenshots of a game's three states on the day after (Lane 80): the board's RB tab signed in,
// /players, Josh Allen's page, the schedule and the clubs, dark and light at 1440 and dark at 390, on
// the fixture's Monday clock (week 6's Sunday games kicked off, Thursday's final) or its Tuesday clock
// (the finals in). The fixture API must run on the same clock (FIXTURE_CLOCK), and stamps every game
// with the API's state at it (inseason-fixture/game-state.ts). Each screen asserts:
//   Monday: the API's rows say Kicked off and never carry an expected score or the weather after
//   kickoff, the basis says when Final lands, and no row says Kicked off on Tuesday;
//   the bases never claim a week a Sunday player's GP does not reach ("through week 6" alone);
//   the schedule and clubs head their strength Rest of season strength, never the preseason's;
//   every basis within five rendered lines at 1440 and eight at 390 (basis-lines.ts), the copy
//   passing the one guard (copy-scan.ts), nothing scrolling sideways.
// The prerendered pages read the contract run (2026-10-21T12-ros), the same on both clocks, whose schedule carries its own
// states at its instant: weeks 1 to 5 and Thursday's week 6 game final, the rest of week 6 kicked off.
// Exits non-zero on any fault.
//
//   CLOCK=monday|tuesday node scripts/game-state-shots.ts [web origin] [out dir, from scripts/]
// with the site built from the contract run against PUBLIC_API_URL at the fixture API.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { KICKED_OFF_PART } from '../src/lib/league/box/basis.ts';
import { STRENGTH_HEADS } from '../src/lib/run/strength-words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { BASIS_BUDGET, basisLines } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { FIXTURE_MONDAY_CLOCK, FIXTURE_TUESDAY_CLOCK } from './inseason-fixture/clock.ts';

const CLOCKS = { monday: FIXTURE_MONDAY_CLOCK, tuesday: FIXTURE_TUESDAY_CLOCK } as const;
const day = (process.env.CLOCK ?? 'monday') as keyof typeof CLOCKS;
const clock = CLOCKS[day];
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
/** Words a game past its kickoff never carries: its expected score and its weather. */
const AFTER_KICKOFF = /Roof TBD|\d+(\.5)? to \d+(\.5)?\b/;

interface Screen {
	name: string;
	path: string;
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
		signedIn: true,
		ready: 'Our rest-of-season order',
		rows: 'table.order tbody tr',
		strength: false
	},
	{
		name: 'players',
		path: '/players',
		signedIn: false,
		ready: 'Find a player',
		rows: 'table.order tbody tr',
		strength: false
	},
	{
		name: 'josh-allen',
		path: '/players/josh-allen',
		signedIn: false,
		ready: 'Josh Allen',
		rows: null,
		strength: false
	},
	{
		name: 'schedule',
		path: '/schedule',
		signedIn: false,
		ready: 'schedule strength',
		rows: null,
		strength: true
	},
	{ name: 'clubs', path: '/clubs', signedIn: false, ready: 'Clubs', rows: null, strength: true }
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

/** The API's rows: Kicked off on Monday, never on Tuesday, and no expected score or weather on a
 * row whose game is past its kickoff. */
async function checkRows(page: Page, screen: Screen, at: string): Promise<void> {
	if (screen.rows === null) return;
	const rows = await page.locator(screen.rows).allInnerTexts();
	if (rows.length === 0) fault(at, 'no rows');
	const kicked = rows.filter((text) => text.includes(KICKED_OFF));
	if (day === 'monday' && kicked.length === 0) fault(at, 'no row says Kicked off on Monday');
	if (day === 'tuesday' && kicked.length > 0)
		fault(at, `${String(kicked.length)} rows say Kicked off on Tuesday`);
	for (const text of kicked) {
		if (AFTER_KICKOFF.test(text))
			fault(at, `a kicked-off row carries its expected score or weather: ${text}`);
	}
}

async function checkPage(page: Page, screen: Screen, width: number, at: string): Promise<void> {
	const text = await page.locator('main').innerText();
	await checkRows(page, screen, at);
	if (screen.name === 'josh-allen') {
		// His weeks still to play are the run's: the contract run's week 6 is kicked off whatever the
		// clock (its finals come with the next nightly), and the fixture holds no live week for him.
		if (!text.includes(KICKED_OFF)) fault(at, `his week 6 does not say ${KICKED_OFF}`);
		if (text.includes('Roof TBD')) fault(at, 'his played game keeps Roof TBD');
	}
	if (day === 'monday' && screen.rows !== null && width === 1440 && !text.includes(KICKED_OFF_PART))
		fault(at, 'the basis does not say when Final lands');
	if (/through week 6(?! and)/.test(text) && day === 'monday')
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

for (const screen of SCREENS) {
	for (const [theme, width] of SHOTS) {
		const ctx = await context(theme, width, screen.signedIn);
		const page = await ctx.newPage();
		const at = `${day} ${screen.name} ${theme} ${String(width)}`;
		try {
			await page.goto(`${web}${screen.path}`);
			await ready(page, screen.ready);
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
process.stdout.write(`${day}: every screen holds\n`);
