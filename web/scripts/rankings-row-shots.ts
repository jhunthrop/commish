// Screenshots of the in-season Rankings row as a box score on the phone (Lane 209) against the fixture
// API (scripts/inseason-fixture/serve.ts at FIXTURE_CLOCK 2026-10-18T18:56:00.000Z, the Sunday clock)
// and the built site: /players at its top and with a kicker row scrolled into view (the K chip), the
// front door's top ten and /record, at 320, 360, 390, 768, 1024 and 1280 in both themes; and our order
// signed in with the ESPN stand-in league at 390 (the in-season board), a tagged row in view. It
// asserts:
// - on a phone every Rankings row is two lines plus its strip, one height down the list (a row whose
//   game line wraps rather than cut its status or tags is said apart), no figure set in a sentence,
//   the name never smaller than the row's big figure, the game's line never cut;
// - wherever the strip is drawn, each head fits its cell (the heads line up row to row);
// - the row's verb shows its word, never a bare glyph, signed out and in a league;
// - the faces in the first screen load before any scroll, and every face once scrolled through;
// - the front door's bye cells say "Bye week 11" and never a bye already played;
// - /record says its set rule once on the phone, as drawn, and its early weeks are week chips;
// and at every width that no page scrolls sideways and the copy passes the one guard. Exits non-zero
// on a miss.
//
//   node scripts/rankings-row-shots.ts [web origin] [out dir]
// with the site built against the fixture API at API_ORIGIN.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { BYE_WORDS } from '../src/lib/format/bye.ts';
import { RECORDS_WORDS } from '../src/lib/run/records.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_SUNDAY_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/rankings-row/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN, FIXTURE_SUNDAY_CLOCK);

const THEMES = ['dark', 'light'] as const;
const WIDTHS = [1280, 1024, 768, 390, 360, 320] as const;
const LEAGUE_WIDTH = 390;
/** Our order in the selected league's view, the in-season board, where each row carries its move. */
const LEAGUE_PATH = '/board';
/** Below this width /record draws its narrow cells (record.css). */
const RECORD_NARROW_MAX = 1180;
const PHONE_MAX = 760;
const PHONE_HEIGHT = 844;
const DESK_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
/** A beat for a table to draw an answer that has arrived. */
const SETTLE_MS = 400;
/** A scroll step through a long list, so every lazy face comes into view. */
const SCROLL_STEP_PX = 600;
const SCROLL_PAUSE_MS = 60;
/** A row's height may differ by a hairline or a chip's border, never by a line. */
const ROW_HEIGHT_SLACK_PX = 4;
/** Two lines and the strip of labelled cells, padding included, at the phone's type sizes. */
const MAX_PHONE_ROW_PX = 100;
/** A game's line one line high; taller, it has wrapped. */
const GAME_LINE_PX = 24;
/** Sub-pixel rounding a measured head may run over its cell by. */
const FIT_SLACK_PX = 0.5;
/** A figure joined into a sentence: a head, a figure, a comma, the next head. */
const SENTENCE = /[A-Za-z.] -?\d+\.\d, [A-Z]/u;
const ROW = 'main table.order tbody tr:not(.sec), main table.week tbody tr:not(.sec)';
/** The signed-in fixture's cookies: the member, following the ESPN stand-in league. */
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const ESPN = { name: 'fixture_league', value: 'espn' };
const failures: string[] = [];
function fail(tag: string, what: string): void {
	failures.push(`${tag}: ${what}`);
}

const browser = await chromium.launch();

async function context(theme: string, width: number, league = false): Promise<BrowserContext> {
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
	if (league)
		await ctx.addCookies([SIGNED_IN, ESPN].map((c) => ({ ...c, domain: 'localhost', path: '/' })));
	return ctx;
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(SETTLE_MS);
}

/** The faces in the first screen load with the page, before any scroll (review L6). */
async function firstFaces(page: Page, tag: string): Promise<void> {
	try {
		await page.waitForFunction(
			() =>
				[...document.querySelectorAll('main img')]
					.filter((img) => img.getBoundingClientRect().top < window.innerHeight)
					.every(
						(img) =>
							(img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0
					),
			undefined,
			{ timeout: READY_TIMEOUT_MS }
		);
	} catch {
		fail(tag, 'a face in the first screen did not load before a scroll');
	}
}

/** Scrolls the page through so every lazy face is asked for, then waits for each to finish. */
async function loadFaces(page: Page): Promise<void> {
	const height = await page.evaluate(() => document.documentElement.scrollHeight);
	for (let y = 0; y < height; y += SCROLL_STEP_PX) {
		await page.evaluate((top) => window.scrollTo(0, top), y);
		await page.waitForTimeout(SCROLL_PAUSE_MS);
	}
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll('main img')].every((img) => (img as HTMLImageElement).complete),
		undefined,
		{ timeout: READY_TIMEOUT_MS }
	);
	await page.evaluate(() => window.scrollTo(0, 0));
}

async function overflow(page: Page, tag: string): Promise<void> {
	const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	if (over > 0) fail(tag, `scrolls sideways by ${String(over)} px`);
}

/** Every strip head wider than its cell, wherever a strip is drawn (review M6). */
async function headsFit(page: Page, tag: string): Promise<void> {
	const over = await page.evaluate(
		(slack: number) =>
			[...document.querySelectorAll('main .strip .cell')]
				.filter((cell) => cell.getBoundingClientRect().width > 0)
				.map((cell) => {
					const head = cell.querySelector('.head');
					const spare = cell.getBoundingClientRect().width - (head?.scrollWidth ?? 0);
					return { head: head?.textContent ?? '', spare };
				})
				.filter((c) => c.spare < -slack),
		FIT_SLACK_PX
	);
	if (over.length > 0)
		fail(tag, `${String(over.length)} strip heads overflow their cells (${over[0]?.head ?? ''})`);
}

/** What the Rankings rows draw on the page, read in it. */
async function rowsSeen(page: Page) {
	return page.evaluate((selector: string) => {
		const rows = [...document.querySelectorAll(selector)].filter(
			(tr) => tr.getBoundingClientRect().height > 0
		);
		const size = (el: Element | null): number =>
			el === null ? 0 : parseFloat(getComputedStyle(el).fontSize);
		return rows.map((tr) => {
			const verb = tr.querySelector('td.act');
			const sheetWords = verb?.querySelector('.short');
			const game = tr.querySelector('.phone-game');
			return {
				height: Math.round(tr.getBoundingClientRect().height),
				text: (tr as HTMLElement).innerText.replace(/\s+/gu, ' '),
				cells: tr.querySelectorAll('.strip .cell').length,
				verbWord: sheetWords ? (sheetWords as HTMLElement).innerText.trim() : '',
				hasVerb: verb?.querySelector('a, button') != null,
				name: size(tr.querySelector('.nm a, .nm b')),
				figure: size(tr.querySelector('td.key') ?? tr.querySelector('td.proj')),
				gameHeight: game === null ? 0 : Math.round(game.getBoundingClientRect().height),
				gameCut: game === null ? false : game.scrollWidth > game.clientWidth + 1,
				tags: tr.querySelector('.line-tags') !== null,
				faces: [...tr.querySelectorAll('img')].map((img) => ({
					done: img.complete,
					width: img.naturalWidth
				})),
				blankFace: tr.querySelector('.face:not(.initials):not(:has(img))') !== null
			};
		});
	}, ROW);
}

type RowSeen = Awaited<ReturnType<typeof rowsSeen>>[number];

function rowFaults(rows: readonly RowSeen[], tag: string, verb: boolean): void {
	if (rows.length === 0) {
		fail(tag, 'no Rankings rows');
		return;
	}
	// A row whose game line wrapped (a long status beside the game) is one line taller, said apart.
	const oneLine = rows.filter((r) => r.gameHeight <= GAME_LINE_PX);
	const heights = oneLine.map((r) => r.height);
	const tallest = Math.max(...heights);
	const shortest = Math.min(...heights);
	if (tallest > MAX_PHONE_ROW_PX) fail(tag, `a row is ${String(tallest)} px tall`);
	if (tallest - shortest > ROW_HEIGHT_SLACK_PX)
		fail(tag, `rows run ${String(shortest)} to ${String(tallest)} px tall`);
	const wrapped = rows.length - oneLine.length;
	if (wrapped > 0)
		process.stdout.write(`${tag}: ${String(wrapped)} rows with a wrapped game line\n`);
	const sentence = rows.find((r) => SENTENCE.test(r.text));
	if (sentence) fail(tag, `figures in a sentence: "${sentence.text.slice(0, 120)}"`);
	if (rows.some((r) => r.cells === 0)) fail(tag, 'a row with no labelled cells');
	if (rows.some((r) => r.figure > r.name))
		fail(tag, "a row's big figure is set larger than the player's name");
	if (rows.some((r) => r.gameCut)) fail(tag, "a row's game line is cut");
	if (verb && rows.some((r) => r.hasVerb && r.verbWord === ''))
		fail(tag, "a row's verb has no word");
	const unloaded = rows.filter((r) => r.blankFace || r.faces.some((f) => !f.done || f.width === 0));
	if (unloaded.length > 0) fail(tag, `${String(unloaded.length)} rows with an empty face`);
}

async function shoot(page: Page, name: string, full: boolean): Promise<void> {
	await page.screenshot({ path: new URL(`${name}.png`, out).pathname, fullPage: full });
}

async function openPlayers(page: Page, tag: string, path = '/players'): Promise<void> {
	await page.goto(`${web}${path}`);
	await page.locator('main table.order').waitFor({ timeout: READY_TIMEOUT_MS });
	await settle(page);
	await firstFaces(page, tag);
	await loadFaces(page);
}

async function players(ctx: BrowserContext, tag: string, phone: boolean): Promise<void> {
	const page = await ctx.newPage();
	await openPlayers(page, `players ${tag}`);
	await overflow(page, `players ${tag}`);
	await headsFit(page, `players ${tag}`);
	if (phone) rowFaults(await rowsSeen(page), `players ${tag}`, true);
	const fault = await copyFault(page);
	if (fault) fail(`players ${tag}`, fault);
	await shoot(page, `players-${tag}`, false);
	await shoot(page, `players-full-${tag}`, true);

	await page.locator('.chips[aria-label="Position"] button', { hasText: 'K' }).first().click();
	await page.locator('main table.week').waitFor({ timeout: READY_TIMEOUT_MS });
	await settle(page);
	await loadFaces(page);
	await page.locator('main table.week tbody tr:not(.sec)').nth(4).scrollIntoViewIfNeeded();
	await page.evaluate(() => window.scrollBy(0, 200));
	await page.waitForTimeout(SETTLE_MS);
	await overflow(page, `players K ${tag}`);
	await headsFit(page, `players K ${tag}`);
	if (phone) rowFaults(await rowsSeen(page), `players K ${tag}`, false);
	await shoot(page, `players-k-${tag}`, false);
	await page.close();
}

/** Our order in the ESPN stand-in league (the in-season board) at a phone's width: every verb named,
 * a row with its tags, roster mark and game shot, nothing on the game's line cut (reviews M2, M4). */
async function league(theme: string): Promise<void> {
	const tag = `league-${String(LEAGUE_WIDTH)}-${theme}`;
	const ctx = await context(theme, LEAGUE_WIDTH, true);
	const page = await ctx.newPage();
	await openPlayers(page, `players ${tag}`, LEAGUE_PATH);
	await overflow(page, `players ${tag}`);
	await headsFit(page, `players ${tag}`);
	const rows = await rowsSeen(page);
	rowFaults(rows, `players ${tag}`, true);
	if (!rows.some((r) => r.tags)) fail(tag, 'no row draws its tags');
	// The first row with its tags (the sheet's Held), its roster mark and its game on one line or two.
	const tagged = page.locator('main table.order tbody tr', { has: page.locator('.line-tags') });
	await tagged.first().scrollIntoViewIfNeeded();
	await page.evaluate(() => window.scrollBy(0, -200));
	await page.waitForTimeout(SETTLE_MS);
	await shoot(page, `players-${tag}-tagged`, false);
	await page.evaluate(() => window.scrollTo(0, 0));
	const moves = await page.locator('main td.act a.verb').count();
	if (moves === 0) fail(tag, 'no move drawn in the league');
	const bare = await page
		.locator('main td.act a.verb')
		.evaluateAll(
			(links) =>
				links.filter((a) => (a.querySelector<HTMLElement>('.short')?.innerText ?? '').trim() === '')
					.length
		);
	if (bare > 0) fail(tag, `${String(bare)} moves with a bare glyph`);
	const fault = await copyFault(page);
	if (fault) fail(`players ${tag}`, fault);
	await shoot(page, `players-${tag}`, false);
	await ctx.close();
}

async function front(ctx: BrowserContext, tag: string, phone: boolean): Promise<void> {
	const page = await ctx.newPage();
	await page.goto(`${web}/`);
	await settle(page);
	await loadFaces(page);
	await overflow(page, `front ${tag}`);
	if (phone) {
		const byes = await page
			.locator('main .phone-bye')
			.evaluateAll((els) => els.map((el) => (el as HTMLElement).textContent.trim()));
		if (byes.length === 0) fail(`front ${tag}`, 'no bye cells drawn');
		// Each one the word table's own "Bye week N" (review L1), never a bye already played.
		const wrong = byes.filter((b) => {
			const week = Number(/\d+$/u.exec(b)?.[0] ?? NaN);
			return Number.isNaN(week) || b !== BYE_WORDS.week(week);
		});
		if (wrong.length > 0) fail(`front ${tag}`, `bye cells read ${wrong.join(' | ')}`);
	}
	const fault = await copyFault(page);
	if (fault) fail(`front ${tag}`, fault);
	await shoot(page, `front-${tag}`, true);
	await page.close();
}

async function record(ctx: BrowserContext, tag: string, width: number): Promise<void> {
	const phone = width <= PHONE_MAX;
	const narrow = width <= RECORD_NARROW_MAX;
	const page = await ctx.newPage();
	await page.goto(`${web}/record`);
	await settle(page);
	await overflow(page, `record ${tag}`);
	// Read as drawn (review M3): a hidden desk cell says nothing on a phone.
	const seen = await page.locator('main').innerText();
	if (seen.includes("Each week's are set"))
		fail(`record ${tag}`, 'the set rule reads "Each week\'s are set"');
	const rule = narrow ? RECORDS_WORDS.setRulePhone : (RECORDS_WORDS.before(7).split('. ')[1] ?? '');
	if (!seen.includes(rule)) fail(`record ${tag}`, 'the set rule is not drawn');
	if (phone) {
		const chips = await page.locator('main tr.before .wk-chips li:visible').count();
		if (chips === 0) fail(`record ${tag}`, 'the weeks before the weekly record are not chips');
	}
	const fault = await copyFault(page);
	if (fault) fail(`record ${tag}`, fault);
	await shoot(page, `record-${tag}`, true);
	await page.close();
}

await mkdir(out, { recursive: true });
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const tag = `${String(width)}-${theme}`;
		const phone = width <= PHONE_MAX;
		const ctx = await context(theme, width);
		await players(ctx, tag, phone);
		await front(ctx, tag, phone);
		await record(ctx, tag, width);
		await ctx.close();
	}
	await league(theme);
}
await browser.close();

if (failures.length > 0) {
	throw new Error(`${String(failures.length)} faults:\n${failures.join('\n')}`);
}
process.stdout.write(`Rankings row shots in ${out.pathname}: every check passed.\n`);
