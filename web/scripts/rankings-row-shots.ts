// Screenshots of the in-season Rankings row as a box score on the phone (Lane 209) against the fixture
// API (scripts/inseason-fixture/serve.ts at FIXTURE_CLOCK 2026-10-18T18:56:00.000Z, the Sunday clock)
// and the built site: /players at its top and with a kicker row scrolled into view (the K chip), the
// front door's top ten and /record, at 390 and 1280 in both themes. It asserts, at 390:
// - every Rankings row is two lines plus its strip, one height down the list, and no figure is set in
//   a sentence (each figure sits in a cell under its own head);
// - the row's verb shows its word, never a bare plus;
// - every face on the list has loaded once the list has been scrolled through (lazy faces, ruling 3);
// - the front door's bye cells say "Bye week 11" and never a bye already played;
// - /record's set rule is grammatical and its weeks before the weekly record are week chips;
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
const WIDTHS = [1280, 390] as const;
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
/** A figure joined into a sentence: a head, a figure, a comma, the next head. */
const SENTENCE = /[A-Za-z.] -?\d+\.\d, [A-Z]/u;
const ROW = 'main table.order tbody tr:not(.sec), main table.week tbody tr:not(.sec)';

const failures: string[] = [];
function fail(tag: string, what: string): void {
	failures.push(`${tag}: ${what}`);
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

/** What the Rankings rows draw on the page, read in it. */
async function rowsSeen(page: Page) {
	return page.evaluate((selector: string) => {
		const rows = [...document.querySelectorAll(selector)].filter(
			(tr) => tr.getBoundingClientRect().height > 0
		);
		return rows.map((tr) => {
			const verb = tr.querySelector('td.act');
			const words = verb?.querySelector('.words');
			return {
				height: Math.round(tr.getBoundingClientRect().height),
				text: (tr as HTMLElement).innerText.replace(/\s+/gu, ' '),
				cells: tr.querySelectorAll('.strip .cell').length,
				verbWord: words
					? (words as HTMLElement).innerText.trim()
					: ((verb as HTMLElement | null)?.innerText.trim() ?? ''),
				faces: [...tr.querySelectorAll('img')].map((img) => ({
					done: img.complete,
					width: img.naturalWidth
				})),
				blankFace: tr.querySelector('.face:not(.initials):not(:has(img))') !== null
			};
		});
	}, ROW);
}

function rowFaults(rows: Awaited<ReturnType<typeof rowsSeen>>, tag: string, verb: boolean): void {
	if (rows.length === 0) {
		fail(tag, 'no Rankings rows');
		return;
	}
	const heights = rows.map((r) => r.height);
	const tallest = Math.max(...heights);
	const shortest = Math.min(...heights);
	if (tallest > MAX_PHONE_ROW_PX) fail(tag, `a row is ${String(tallest)} px tall`);
	if (tallest - shortest > ROW_HEIGHT_SLACK_PX)
		fail(tag, `rows run ${String(shortest)} to ${String(tallest)} px tall`);
	const sentence = rows.find((r) => SENTENCE.test(r.text));
	if (sentence) fail(tag, `figures in a sentence: "${sentence.text.slice(0, 120)}"`);
	if (rows.some((r) => r.cells === 0)) fail(tag, 'a row with no labelled cells');
	if (verb && rows.some((r) => r.verbWord === '')) fail(tag, "a row's verb has no word");
	const unloaded = rows.filter((r) => r.blankFace || r.faces.some((f) => !f.done || f.width === 0));
	if (unloaded.length > 0) fail(tag, `${String(unloaded.length)} rows with an empty face`);
}

async function shoot(page: Page, name: string, full: boolean): Promise<void> {
	await page.screenshot({ path: new URL(`${name}.png`, out).pathname, fullPage: full });
}

async function players(ctx: BrowserContext, tag: string, phone: boolean): Promise<void> {
	const page = await ctx.newPage();
	await page.goto(`${web}/players`);
	await page.locator('main table.order').waitFor({ timeout: READY_TIMEOUT_MS });
	await settle(page);
	await loadFaces(page);
	await overflow(page, `players ${tag}`);
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
	if (phone) rowFaults(await rowsSeen(page), `players K ${tag}`, false);
	await shoot(page, `players-k-${tag}`, false);
	await page.close();
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
			.evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));
		if (byes.length === 0) fail(`front ${tag}`, 'no bye cells drawn');
		const wrong = byes.filter((b) => !/^bye week \d+$/iu.test(b) || b.includes(BYE_WORDS.done));
		if (wrong.length > 0) fail(`front ${tag}`, `bye cells read ${wrong.join(' | ')}`);
	}
	const fault = await copyFault(page);
	if (fault) fail(`front ${tag}`, fault);
	await shoot(page, `front-${tag}`, true);
	await page.close();
}

async function record(ctx: BrowserContext, tag: string, phone: boolean): Promise<void> {
	const page = await ctx.newPage();
	await page.goto(`${web}/record`);
	await settle(page);
	await overflow(page, `record ${tag}`);
	const text = (await page.locator('main').textContent()) ?? '';
	if (text.includes("Each week's are set"))
		fail(`record ${tag}`, 'the set rule reads "Each week\'s are set"');
	if (!text.includes(RECORDS_WORDS.before(7).split('. ')[1] ?? ''))
		fail(`record ${tag}`, 'no set rule');
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
		await record(ctx, tag, phone);
		await ctx.close();
	}
}
await browser.close();

if (failures.length > 0) {
	throw new Error(`${String(failures.length)} faults:\n${failures.join('\n')}`);
}
process.stdout.write(`Rankings row shots in ${out.pathname}: every check passed.\n`);
