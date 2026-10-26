// Screenshots of three game-day polish items from the Sunday live sense check (Lane 223: B187, B188,
// B190, and Lane 220's D2) at 390 and 1280 in both themes, signed out, the browser on the fixture's
// Sunday clock:
//   schedule  the Saturday run (inseason-fixture/saturday-run.ts, week 6's Thursday game final at the
//             run, every Sunday game still to come): /schedule, /clubs/sea (whose Thursday game is
//             final) and the front door. The current week's cells on the grid and the club's week row
//             say the run's game state (Final, Kicked off, or the kickoff with its day and zone) under
//             a line naming the run's read; on a phone the grid opens on that week. The club's head
//             names what its basis names; a bye already played draws no bye (KC's week 5, read);
//             no row's Bye cell reads "Done".
//   record    the two records' graded run (record-fixture/run.ts two graded): /record and the front
//             door name the graded order as the rest-of-season order in the web's own sentences,
//             never weekly rankings (the run's method sentence is the nightly's, not read).
// Every page: no sideways scroll at any width and the copy passes the one guard. Exits non-zero on a
// miss.
//
//   node scripts/game-day-polish-shots.ts <schedule|record> [web origin] [api origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { installFixtureApiClock } from './inseason-fixture/clock.ts';

const MODES = ['schedule', 'record'] as const;
type Mode = (typeof MODES)[number];
const mode: Mode = MODES.find((m) => m === process.argv[2]) ?? 'schedule';
const web = process.argv[3] ?? 'http://localhost:4223';
const API_ORIGIN = new URL(process.argv[4] ?? 'http://localhost:8223').origin;
const out = new URL(process.argv[5] ?? `../screenshots/game-day-polish/${mode}/`, import.meta.url);

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [390, 1280] as const;
const PHONE_MAX = 760;
const PHONE_HEIGHT = 844;
const DESK_HEIGHT = 900;
const SETTLE_MS = 600;
/** The Saturday run's current week: weeks 1 to 5 complete, week 6's Thursday game final. */
const CURRENT_WEEK = 6;
/** Week 6's Thursday clubs, final at the run. */
const THURSDAY_CLUBS = new Set(['DEN', 'SEA']);
/** A kickoff with its day and zone: "Sun 12:00 pm CT". */
const KICKOFF = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2} (am|pm) \S+$/u;
const CLUB = 'sea';
/** A club whose bye (week 5) is played at the run. */
const PLAYED_BYE_CLUB = 'kc';

const VIEWS: Readonly<Record<Mode, readonly { key: string; path: string }[]>> = {
	schedule: [
		{ key: 'schedule', path: '/schedule' },
		{ key: `club-${CLUB}`, path: `/clubs/${CLUB}` },
		{ key: 'home', path: '/' }
	],
	record: [
		{ key: 'record', path: '/record' },
		{ key: 'home', path: '/' }
	]
};

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

/** The main's text lines, trimmed, none empty. */
async function lines(page: Page): Promise<string[]> {
	const text = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
	return text
		.split('\n')
		.map((line) => line.trim().replace(/\s+/gu, ' '))
		.filter((line) => line !== '');
}

async function overflow(page: Page, tag: string): Promise<void> {
	const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	if (over > 0) fail(tag, `scrolls sideways by ${String(over)} px`);
}

/** Every grid row's current-week cell as drawn: its club and its lines. */
async function weekCells(page: Page): Promise<{ club: string; lines: string[] }[]> {
	return page.evaluate((week) => {
		return [...document.querySelectorAll('.frame tbody tr')].map((row) => {
			const club = row.querySelector('th a')?.getAttribute('href')?.split('/').pop() ?? '';
			const cell = row.querySelectorAll('td.week')[week - 1] as HTMLElement | undefined;
			const said = (cell?.innerText ?? '')
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line !== '');
			return { club: club.toUpperCase(), lines: said };
		});
	}, CURRENT_WEEK);
}

/** The grid's current week: every club's cell says its state, the run's read is named once, and on
 * a phone the grid opens on that week. */
async function checkGrid(page: Page, tag: string, phone: boolean): Promise<void> {
	const cells = await weekCells(page);
	if (cells.length !== 32) fail(tag, `draws ${String(cells.length)} clubs`);
	for (const { club, lines: said } of cells) {
		const state = said.at(-1) ?? '';
		if (said.length === 1 && said[0] === 'Bye') continue;
		const want = THURSDAY_CLUBS.has(club) ? state === 'Final' : KICKOFF.test(state);
		if (!want) fail(tag, `${club}'s week ${String(CURRENT_WEEK)} cell reads "${said.join(' / ')}"`);
	}
	const all = await lines(page);
	if (!all.some((line) => line.startsWith(`Week ${String(CURRENT_WEEK)}'s games as of `)))
		fail(tag, "names no run's read for the week's games");
	if (phone) {
		const seen = await page.evaluate((week) => {
			const frame = document.querySelector('.frame');
			const head = document.querySelectorAll('.frame thead th.week')[week - 1];
			if (!frame || !head) return false;
			const f = frame.getBoundingClientRect();
			const h = head.getBoundingClientRect();
			return h.left >= f.left && h.right <= f.right + 1;
		}, CURRENT_WEEK);
		if (!seen) fail(tag, `opens with week ${String(CURRENT_WEEK)} out of view`);
	}
}

/** The club's week row says its state, its head names what its basis names, and its bye is ahead. */
async function checkClub(page: Page, tag: string): Promise<void> {
	const all = await lines(page);
	const row = all.find((line) => line.startsWith(`Week ${String(CURRENT_WEEK)} `));
	if (!row?.includes('Final'))
		fail(tag, `the week ${String(CURRENT_WEEK)} row reads "${row ?? ''}"`);
	const head = all.find((line) => line.startsWith('On our ')) ?? '';
	const basis = await page.evaluate(
		() => document.querySelector('main p.basis')?.textContent ?? ''
	);
	// The basis's order sentence, wherever it sits: the order's lead, or the run's board sentence.
	const noun = (text: string): string | null =>
		text.includes('rest-of-season order')
			? 'order'
			: /\b[Oo]ur \S+ board\b/u.test(text)
				? 'board'
				: null;
	const lead = noun(basis);
	if (lead === null || noun(head) !== lead)
		fail(tag, `the head "${head}" and the basis "${basis.slice(0, 80)}" name different orders`);
	if (!all.some((line) => /\bBye week 11\b/iu.test(line))) fail(tag, 'says no Bye week 11');
}

/** No row's Bye column reads a bye already played. */
async function checkByes(page: Page, tag: string): Promise<void> {
	const done = await page.evaluate(
		() =>
			[...document.querySelectorAll('main .row .n')].filter(
				(cell) => cell.textContent.trim() === 'Done'
			).length
	);
	if (done > 0) fail(tag, `${String(done)} Bye cells read Done`);
}

/** The web's own sentences that named the graded order as weekly rankings before Lane 223. The run's
 * own method and notes (research/nightly/reads/weekly_record.py) are the nightly's words, not read
 * here, and said in the report. */
const WEEKLY_MODEL_WORDS = [
	'Our weekly rankings against',
	'Weekly rankings start week',
	'Our weekly rankings over',
	'Our weekly rankings, set'
];

/** The record and its front card name the graded order as the rest-of-season order. */
async function checkRecordWords(page: Page, tag: string, home: boolean): Promise<void> {
	const text = (await lines(page)).join(' ');
	for (const words of WEEKLY_MODEL_WORDS) if (text.includes(words)) fail(tag, `says "${words}"`);
	if (!text.includes('rest-of-season order')) fail(tag, 'names no rest-of-season order');
	if (home && !text.includes('Our rest-of-season order, graded over'))
		fail(tag, 'the record card names no graded rest-of-season order');
}

await mkdir(out, { recursive: true });
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const phone = width <= PHONE_MAX;
		const ctx = await context(theme, width);
		for (const view of VIEWS[mode]) {
			const tag = `${view.key}-${String(width)}-${theme}`;
			const page = await ctx.newPage();
			await page.goto(new URL(view.path, web).href);
			await settle(page);
			await overflow(page, tag);
			const fault = await copyFault(page);
			if (fault !== null) fail(tag, fault);
			if (view.key === 'schedule') await checkGrid(page, tag, phone);
			if (view.key === `club-${CLUB}`) await checkClub(page, tag);
			if (mode === 'schedule' && !phone) await checkByes(page, tag);
			if (mode === 'record') await checkRecordWords(page, tag, view.key === 'home');
			await page.screenshot({ path: new URL(`${tag}.png`, out).pathname, fullPage: true });
			await page.close();
		}
		await ctx.close();
	}
}
if (mode === 'schedule') {
	// A club whose bye is played draws no bye in its head, read once at a desk.
	const ctx = await context('light', WIDTHS[1]);
	const page = await ctx.newPage();
	await page.goto(new URL(`/clubs/${PLAYED_BYE_CLUB}`, web).href);
	await settle(page);
	if ((await lines(page)).some((line) => /\bbye\b/iu.test(line) && /\b5\b/u.test(line)))
		fail(`club-${PLAYED_BYE_CLUB}`, 'says its played bye');
	await ctx.close();
}
await browser.close();

if (failures.length > 0) {
	throw new Error(`${String(failures.length)} misses:\n${failures.join('\n')}`);
}
process.stdout.write(`Game-day polish shots (${mode}) in ${out.pathname}: no miss.\n`);
