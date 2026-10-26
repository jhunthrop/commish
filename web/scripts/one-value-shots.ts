// Screenshots of one player's value and order on every in-season view (Lane 220, B184) against the
// fixture API (scripts/inseason-fixture/serve.ts at FIXTURE_CLOCK 2026-10-18T18:56:00.000Z, the Sunday
// clock) and the site built on the one-board run (inseason-fixture/one-board-run.ts, made Thursday
// morning of week 6, so a club whose game has kicked off since reads fewer games left at the clock): the
// front door, Rankings (/players), one player page, one club page and compare, at 390 and 1280 in both
// themes. It reads three players (an RB whose game has kicked off, a WR whose game is final, a QB on
// bye) on every view that draws them and asserts each view prints the API order's position rank and its
// rest-of-season figure to the tenth (and its Over repl. where the view draws it), signed out, the order
// the Rankings read; and at every width that no page scrolls sideways and the copy passes the one
// guard. Writes what each view read to readings.json beside the shots. Exits non-zero on a miss.
//
//   node scripts/one-value-shots.ts [web origin] [out dir]
// with the site built against the fixture API at API_ORIGIN.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_SUNDAY_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/one-value/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN, FIXTURE_SUNDAY_CLOCK);

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [390, 1280] as const;
const PHONE_MAX = 760;
const PHONE_HEIGHT = 844;
const DESK_HEIGHT = 900;
/** A beat for a table to draw an answer that has arrived. */
const SETTLE_MS = 600;
/** How many text lines after a player's name his figures sit within, on any of the views; the window
 * also ends at the next player the order names, so a neighbour's cells are never his. */
const WINDOW_LINES = 16;
/** The order's rows the script reads the three players from. */
const ORDER_LIMIT = 100;

/** The three players: one per position the brief names, each in a different game state. */
const PLAYERS = [
	{ name: "D'Andre Swift", slug: 'd-andre-swift' },
	{ name: 'Parker Washington', slug: 'parker-washington' },
	{ name: 'Joe Burrow', slug: 'joe-burrow' }
] as const;
const CLUB = 'chi';
/** Each of the three players' clubs, read (not shot) so every one of them is held on a club page. */
const CLUBS: Readonly<Record<string, string>> = {
	"D'Andre Swift": 'chi',
	'Parker Washington': 'jax',
	'Joe Burrow': 'cin'
};
const COMPARE = `/compare?a=${PLAYERS[0].slug}&b=${PLAYERS[2].slug}`;

interface Expected {
	name: string;
	chip: string;
	projected: string;
	vor: string;
}

const failures: string[] = [];
function fail(tag: string, what: string): void {
	failures.push(`${tag}: ${what}`);
}

const tenth = (value: number): string => value.toFixed(1);
const signedTenth = (value: number): string => `${value >= 0 ? '+' : ''}${tenth(value)}`;

/** The order the Rankings read, signed out: each player's chip, figure and Over repl. */
async function expected(): Promise<{ want: Expected[]; names: Set<string> }> {
	const response = await fetch(`${API_ORIGIN}/order?limit=${String(ORDER_LIMIT)}`);
	if (!response.ok) throw new Error(`The fixture's /order answered ${String(response.status)}.`);
	const { data } = await response.json<{
		data: {
			rows: {
				rest_of_season_points: number | null;
				points_over_replacement: number | null;
				line: { player: { name: string; position: string }; position_rank: number | null };
			}[];
		};
	}>();
	const names = new Set(data.rows.map((row) => row.line.player.name));
	const want = PLAYERS.map(({ name }) => {
		const row = data.rows.find((candidate) => candidate.line.player.name === name);
		if (row?.rest_of_season_points == null || row.points_over_replacement == null)
			throw new Error(`The fixture's order has no figures for ${name}.`);
		return {
			name,
			chip: `${row.line.player.position} ${String(row.line.position_rank)}`,
			projected: tenth(row.rest_of_season_points),
			vor: signedTenth(row.points_over_replacement)
		};
	});
	return { want, names };
}

const browser = await chromium.launch();

async function context(theme: string, width: number): Promise<BrowserContext> {
	const phone = width <= PHONE_MAX;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? PHONE_HEIGHT : DESK_HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: phone ? 2 : 1
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(SETTLE_MS);
}

/** The page's text lines, trimmed, none empty. */
async function lines(page: Page): Promise<string[]> {
	const text = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
	return text
		.split('\n')
		.map((line) => line.trim().replace(/\s+/gu, ' '))
		.filter((line) => line !== '');
}

/** A position chip, whole: "RB 15". */
const CHIP = /^[A-Z]{1,3} \d+$/u;

/** A line's cells as chips and figures, whole: "RB 15" is one chip (never "RB 1"), "103.0" one figure. */
function cellsOf(line: string): string[] {
	return line.match(/[A-Z]{1,3} \d+|[+-]?\d+(?:\.\d+)?/gu) ?? [];
}

/** What a view draws for a player: the cells after his name, up to the next player the order names. */
function windowOf(
	all: readonly string[],
	name: string,
	names: ReadonlySet<string>
): string[] | null {
	const at = all.findIndex((line) => line === name);
	if (at < 0) return null;
	const after = all.slice(at + 1, at + WINDOW_LINES);
	const next = after.findIndex((line) => line !== name && names.has(line));
	const cells = (next < 0 ? after : after.slice(0, next)).flatMap(cellsOf);
	// A row draws one chip, his: a second chip is the next row's player, whom the order may not name.
	const first = cells.findIndex((cell) => CHIP.test(cell));
	const second = cells.findIndex((cell, i) => i > first && CHIP.test(cell));
	return second < 0 ? cells : cells.slice(0, second);
}

type Reading = Record<string, Record<string, string[] | null>>;
const readings: Reading = {};

/** Every player the view must draw is drawn, and his cells hold the order's chip and figure (and Over
 * repl. where the view draws it), each a whole cell. */
function checkView(
	view: string,
	all: readonly string[],
	players: readonly Expected[],
	names: ReadonlySet<string>,
	drawn: { projected: boolean; vor: boolean }
): void {
	readings[view] = {};
	for (const player of players) {
		const cells = windowOf(all, player.name, names);
		readings[view][player.name] = cells;
		if (cells === null) {
			fail(view, `draws no ${player.name}`);
			continue;
		}
		const said = cells.join(' | ');
		if (!cells.includes(player.chip))
			fail(view, `${player.name} reads no ${player.chip} (${said})`);
		if (drawn.projected && !cells.includes(player.projected))
			fail(view, `${player.name} reads no ${player.projected} (${said})`);
		if (drawn.vor && !cells.includes(player.vor) && !cells.includes(player.vor.replace('+', '')))
			fail(view, `${player.name} reads no Over repl. ${player.vor} (${said})`);
	}
}

/** Compare's table: each row's two cells, the leader first, held to the two players' figures. */
function checkCompare(all: readonly string[], pair: readonly Expected[]): void {
	/** A table row's line, "Projected 103.0 190.3", as its cells. */
	const row = (label: string): string[] => {
		const line = all.find((candidate) => candidate.startsWith(`${label} `));
		return line === undefined ? [] : cellsOf(line.slice(label.length + 1));
	};
	const shown = {
		chip: row('Position rank'),
		projected: row('Projected'),
		vor: row('Over replacement')
	};
	readings.compare = {
		[pair.map((player) => player.name).join(' and ')]: Object.values(shown).flat()
	};
	for (const player of pair) {
		const chip = player.chip;
		if (!shown.chip.includes(chip))
			fail('compare', `Position rank reads ${shown.chip.join(', ')}, not ${chip}`);
		if (!shown.projected.includes(player.projected))
			fail('compare', `Projected reads ${shown.projected.join(', ')}, not ${player.projected}`);
		if (!shown.vor.includes(player.vor))
			fail('compare', `Over replacement reads ${shown.vor.join(', ')}, not ${player.vor}`);
	}
	if (all.some((line) => line.startsWith('Floor to ceiling')))
		fail('compare', 'draws a Floor to ceiling row in season');
}

async function overflow(page: Page, tag: string): Promise<void> {
	const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	if (over > 0) fail(tag, `scrolls sideways by ${String(over)} px`);
}

/** The players each view must draw: the front door's top ten holds the order's first ten (Swift 2nd,
 * Washington 10th, Burrow 13th); Rankings' first page holds the playing players, Burrow's bye in its
 * own section past it; the club page its own club's; compare its pair. */
const SWIFT_WASHINGTON = [PLAYERS[0].name, PLAYERS[1].name];
const VIEWS = [
	// The Rankings row draws the week's Proj and Over repl., never the rest-of-season total. A player
	// page's head is read in the loop after the views (its figures under the name's other lines).
	{ key: 'home', path: '/', draws: SWIFT_WASHINGTON, drawn: { projected: true, vor: true } },
	{
		key: 'players',
		path: '/players',
		draws: SWIFT_WASHINGTON,
		drawn: { projected: false, vor: true }
	},
	{ key: 'p-swift', path: `/players/${PLAYERS[0].slug}`, draws: [], drawn: null },
	{
		key: `club-${CLUB}`,
		path: `/clubs/${CLUB}`,
		draws: [PLAYERS[0].name],
		drawn: { projected: true, vor: true }
	},
	{ key: 'compare', path: COMPARE, draws: [PLAYERS[0].name, PLAYERS[2].name], drawn: null }
] as const;

const { want, names } = await expected();
const wanted = (draws: readonly string[]): Expected[] =>
	want.filter((player) => draws.includes(player.name));
await mkdir(out, { recursive: true });
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const ctx = await context(theme, width);
		for (const view of VIEWS) {
			const tag = `${view.key}-${String(width)}-${theme}`;
			const page = await ctx.newPage();
			await page.goto(new URL(view.path, web).href);
			await settle(page);
			await overflow(page, tag);
			const fault = await copyFault(page);
			if (fault !== null) fail(tag, fault);
			// The figures are read once, at a desk in the light theme: the phone draws the same answer.
			if (theme === 'light' && width === WIDTHS[1]) {
				const all = await lines(page);
				if (view.key === 'compare') checkCompare(all, wanted(view.draws));
				else if (view.drawn !== null)
					checkView(view.key, all, wanted(view.draws), names, view.drawn);
			}
			await page.screenshot({ path: new URL(`${tag}.png`, out).pathname, fullPage: true });
			await page.close();
		}
		await ctx.close();
	}
}
// The three players' own pages: the head reads the order's chip and figure.
{
	const ctx = await context('light', WIDTHS[1]);
	for (const player of want) {
		const slug = PLAYERS.find((p) => p.name === player.name)?.slug ?? '';
		const page = await ctx.newPage();
		await page.goto(new URL(`/players/${slug}`, web).href);
		await settle(page);
		const all = await lines(page);
		const head = all.slice(0, 40).join(' | ');
		readings[`player-${slug}`] = { [player.name]: all.slice(0, 40) };
		if (!all.slice(0, 40).includes(player.chip))
			fail(`player-${slug}`, `the head reads no ${player.chip}`);
		if (!head.includes(player.projected))
			fail(`player-${slug}`, `the head reads no ${player.projected}`);
		await page.close();
		// His club's page, read at a desk: every one of the three is held on his club page.
		const club = CLUBS[player.name] ?? '';
		if (club !== CLUB) {
			const clubPage = await ctx.newPage();
			await clubPage.goto(new URL(`/clubs/${club}`, web).href);
			await settle(clubPage);
			checkView(`club-${club}`, await lines(clubPage), [player], names, {
				projected: true,
				vor: true
			});
			await clubPage.close();
		}
	}
	await ctx.close();
}
await browser.close();
await writeFile(
	new URL('readings.json', out),
	`${JSON.stringify({ want, readings }, null, '\t')}\n`
);

if (failures.length > 0) {
	throw new Error(`${String(failures.length)} misses:\n${failures.join('\n')}`);
}
process.stdout.write(
	`One value shots in ${out.pathname}: ${String(VIEWS.length)} views, ${String(want.length)} players, every figure the order's.\n`
);
