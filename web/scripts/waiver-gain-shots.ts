// Screenshots of the Waivers screen's gain groups (Lane 98) against the fixture API started with
// FIXTURE_IR_DROP=1 (inseason-fixture/waiver-beats.ts: the strip's drop on injured reserve on the
// bench, an IR and an out free agent) and the built site, light and dark at 1280 and light at 390, on
// one of two clocks (inseason-fixture/clock.ts):
//   saturday      week 6 still to play, the week order with its Proj columns;
//   monday-night  every starter of the member's past his kickoff: the page addresses week 7, the
//                 season Gain order, no Proj columns.
// Checks on Waivers: the count is the rows over the divider, every row under it draws its figure
// quiet and names no one, a loud Gain is above zero, the line under the heads says Beats once, the
// strip says why its drop is the one named, the named row's Beats names that drop, the IR and out
// free agents are not listed in the table's groups but in the Stash group under its own divider, each
// saying the week he is back (Lane 118, B79), and the drop panel's IR bench row says why he is a drop. On the Lineup
// (saturday) the IR bench row says so and the IR slot row draws no game. Every page: nothing scrolls
// sideways and the copy passes the one guard (copy-scan.ts). Exits non-zero on any fault.
// STAND-INS (B118): 36 of the Waivers rows are the stand-in run's preseason lines the fixture adds
// (waivers.json rows labelled `standin`, inseason-fixture/project.ts), their gain the fixture's one rule.
//
//   CLOCK=saturday|monday-night node scripts/waiver-gain-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API, started on the same clock
// (FIXTURE_CLOCK) with FIXTURE_IR_DROP=1.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { BOX } from '../src/lib/league/box/box.ts';
import { HEAD_BASIS, STASH, WAIVERS } from '../src/lib/league/box/waivers.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import {
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_WEEK_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';

const CLOCKS = {
	saturday: FIXTURE_WEEK_CLOCK,
	'monday-night': FIXTURE_MONDAY_NIGHT_CLOCK
} as const;
type Day = keyof typeof CLOCKS;
type Theme = 'light' | 'dark';
const day = (process.env.CLOCK ?? 'monday-night') as Day;
const web = process.argv[2] ?? 'http://localhost:4196';
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8799';
const out = new URL(process.argv[3] ?? `../screenshots/waiver-gain/${day}/`, import.meta.url);
const SHOTS: readonly (readonly [Theme, 1280 | 390])[] = [
	['light', 1280],
	['dark', 1280],
	['light', 390]
];
const HEIGHTS = { 1280: 900, 390: 844 } as const;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const LEAGUE = `/league/${FIXTURE_IDS.league}`;
/** The fixture case's players (waiver-beats.ts). */
const DROP = 'Jaxson Dart';
/** His Beats name: his last name, no other Dart on the screen (review M2). */
const DROP_BEATS = 'Dart';
const UNLISTED = ["De'Von Achane", 'Joe Royer'];
/** The week each is back (waiver-beats.ts STAMPED). */
const BACK: Readonly<Record<string, number>> = { "De'Von Achane": 9, 'Joe Royer': 8 };
const IR_SLOT = 'Tank Bigsby';

await requireFixtureClock(API_ORIGIN, CLOCKS[day]);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

function fault(where: string, what: string): void {
	faults.push(`${where}: ${what}`);
}

async function context(theme: Theme, width: 1280 | 390): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: HEIGHTS[width] },
		colorScheme: theme,
		deviceScaleFactor: width < 500 ? 2 : 1
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function open(page: Page, path: string, text: string): Promise<void> {
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
	await page
		.getByText(text)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	// Waivers opens on the weakest Need (Lane 305): these checks read every position, the All card.
	const all = page.locator('[data-nav="positions"] [data-card="ALL"]');
	if ((await all.count()) > 0) {
		await all.click();
		await page.locator('.rows[aria-busy="false"]').waitFor({ timeout: READY_TIMEOUT_MS });
	}
	await page.evaluate(() => document.fonts.ready);
}

async function check(page: Page, where: string): Promise<string> {
	const text = await page.evaluate(() => document.body.innerText);
	const sideways = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	if (sideways > 0) fault(where, `scrolls sideways by ${String(sideways)} px`);
	const copy = await copyFault(page);
	if (copy !== null) fault(where, copy);
	return text;
}

interface PoolRowSeen {
	name: string;
	quiet: boolean;
	gain: string;
	who: string | null;
	named: boolean;
	underDivider: boolean;
}

/** The table's rows in order, each with its Beats cell and whether it sits under the divider. */
async function poolRows(page: Page): Promise<PoolRowSeen[]> {
	return page.locator('main table.pool').evaluate((table) => {
		let under = false;
		const seen: PoolRowSeen[] = [];
		for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
			if (tr.classList.contains('divider')) under = true;
			const gain = tr.querySelector('.beats .gain');
			if (gain === null || tr.classList.contains('nested')) continue;
			seen.push({
				name: tr.querySelector<HTMLElement>('.nm')?.innerText.trim() ?? '',
				quiet: gain.classList.contains('quiet'),
				gain: gain.textContent.trim(),
				who: tr.querySelector<HTMLElement>('.beats .who b')?.innerText.trim() ?? null,
				named: tr.classList.contains('moved-in'),
				underDivider: under
			});
		}
		return seen;
	});
}

async function checkWaivers(page: Page, where: string, text: string): Promise<void> {
	const rows = await poolRows(page);
	const over = rows.filter((r) => !r.underDivider);
	const count = /, (\d+) beats? a player of yours/.exec(text)?.[1];
	if (count !== undefined && Number(count) !== over.length)
		fault(where, `the head counts ${count}, ${String(over.length)} rows over the divider`);
	for (const r of rows) {
		if (r.underDivider && (!r.quiet || r.who !== null || r.gain.includes('Gain')))
			fault(where, `${r.name} under the divider draws "${r.who ?? ''} ${r.gain}"`);
		if (!r.underDivider && r.quiet) fault(where, `${r.name} over the divider is quiet`);
		if (!r.underDivider && /^[+−-]?0\.0/.test(r.gain) && !r.named)
			fault(where, `${r.name} draws a loud ${r.gain}`);
		if (r.who === BOX.bye) fault(where, `${r.name} draws Bye in Beats`);
		// A row counts as beating a player of yours only when Beats names one (fix round 1, H1).
		if (!r.underDivider && r.who === null) fault(where, `${r.name} gains and names no one`);
	}
	if (
		!rows.some((r) => r.underDivider) ||
		!text.toLowerCase().includes(WAIVERS.noGain.toLowerCase())
	)
		fault(where, 'no divider over the rows with no gain');
	const heads = (await page.locator('main .heads-basis').allInnerTexts()).join(' ');
	if (!heads.includes(HEAD_BASIS.beats)) fault(where, 'the line under the heads is missing');
	const basis = (await page.locator('main [data-basis]').allInnerTexts()).join(' ');
	if (basis.includes(HEAD_BASIS.rest) || basis.includes(`${BOX.delta} is its change`))
		fault(where, 'the footer says a column the heads line says');
	const groups = await stashGroups(page);
	for (const name of UNLISTED) {
		if (groups.table.some((row) => row.includes(name))) fault(where, `${name} is listed`);
		const stash = groups.stash.find((row) => row.includes(name));
		if (stash === undefined) fault(where, `${name} is not in the Stash group`);
		else if (!stash.includes(STASH.back(BACK[name] ?? 0)))
			fault(where, `${name}'s stash row reads "${stash}"`);
	}
	if (!groups.line.includes(STASH.line)) fault(where, `the Stash line reads "${groups.line}"`);
	const moves = await page.locator('main [data-strip="waivers"] .pickup .move').allInnerTexts();
	// The card names its drop as Beats does: his last name, the full name only where two share it.
	const card = moves.find((m) => m.includes(`drop ${DROP_BEATS}`)) ?? null;
	if (card === null) {
		fault(where, `no card drops ${DROP}: ${JSON.stringify(moves)}`);
		return;
	}
	if (!card.includes(`(${WAIVERS.irBench})`)) fault(where, `the card "${card}" does not say why`);
	// The card's row names its drop in Beats (B14), by his last name.
	if (!rows.some((r) => r.named && r.who === DROP_BEATS))
		fault(where, `no tinted row names ${DROP} in Beats`);
}

/** The table's rows before the Stash divider and after it, as their text, and the group's line. */
async function stashGroups(
	page: Page
): Promise<{ table: string[]; stash: string[]; line: string }> {
	return page.locator('main table.pool').evaluate((table, head: string) => {
		const out = { table: [] as string[], stash: [] as string[], line: '' };
		let inStash = false;
		for (const tr of Array.from(table.querySelectorAll<HTMLElement>('tbody tr'))) {
			if (tr.classList.contains('divider')) inStash = tr.innerText.trim().toLowerCase() === head;
			else if (tr.classList.contains('stash-basis')) out.line = tr.innerText.trim();
			else (inStash ? out.stash : out.table).push(tr.innerText);
		}
		return out;
	}, STASH.head.toLowerCase());
}

/** Opens the named row's drops: the IR bench drop says why he is one. */
async function checkDropPanel(page: Page, where: string): Promise<void> {
	await page
		.locator('main table.pool tr.moved-in', {
			has: page.locator('.beats .who', { hasText: DROP_BEATS })
		})
		.locator('.act .add')
		.first()
		.click();
	const panel = page.locator('main table.pool tbody.panel tr.nested', { hasText: DROP });
	await panel.first().waitFor({ timeout: READY_TIMEOUT_MS });
	const said = await panel.first().innerText();
	if (!said.includes(BOX.irBench)) fault(where, `the drop panel's ${DROP} row reads "${said}"`);
}

/** Every strip card within the strip at any width: the IR reason whole, never a hidden sideways
 * scroll (fix round 1, H2). */
async function checkStripFits(page: Page, where: string): Promise<void> {
	const over = await page.locator('main [data-strip="waivers"]').evaluate((strip) => {
		const edge = strip.getBoundingClientRect().right;
		return Array.from(strip.querySelectorAll('.pickup, .pickup .move')).some(
			(el) => el.getBoundingClientRect().right > edge + 1 || el.scrollWidth > el.clientWidth + 1
		);
	});
	if (over) fault(where, 'a strip card runs past the strip');
}

async function checkLineup(page: Page, where: string): Promise<void> {
	const row = (name: string): Promise<string> =>
		page.locator('main table tr', { hasText: name }).first().innerText();
	if (!(await row(DROP)).includes(BOX.irBench))
		fault(where, `the bench row of ${DROP} does not say why`);
	if (/\b(vs|at) [A-Z]{2,3}\b/.test(await row(IR_SLOT)))
		fault(where, `the IR row of ${IR_SLOT} draws a game`);
}

for (const [theme, width] of SHOTS) {
	const ctx = await context(theme, width);
	const page = await ctx.newPage();
	const at = `${day} ${theme} ${String(width)}`;
	const file = (name: string): string =>
		new URL(`${name}-${theme}-${String(width)}.png`, out).pathname;

	await open(page, `${LEAGUE}/waivers`, WAIVERS.noGain);
	const text = await check(page, `waivers ${at}`);
	await checkWaivers(page, `waivers ${at}`, text);
	await checkStripFits(page, `waivers ${at}`);
	await page.screenshot({ path: file('waivers'), fullPage: true });
	await checkDropPanel(page, `waivers panel ${at}`);
	await page.screenshot({ path: file('waivers-open'), fullPage: true });

	if (day === 'saturday') {
		await open(page, `${LEAGUE}/start`, BOX.reserve);
		await check(page, `lineup ${at}`);
		await checkLineup(page, `lineup ${at}`);
		await page.screenshot({ path: file('lineup'), fullPage: true });
	}
	await ctx.close();
}

await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`waiver gain shots (${day}) in ${out.pathname}\n`);
