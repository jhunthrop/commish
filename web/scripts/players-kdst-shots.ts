// Screenshots of the Week N rankings page's K and D/ST chips (Lane 155) against the fixture API
// (scripts/inseason-fixture/serve.ts, its week from week-order.ts, which names its stand-ins) and the
// built site, signed out: each chip dark and light at 1440, 1280 and 390, on the fixture API's clock
// (the week read on Saturday of week 6, or the Tuesday before with the projection not in, STATE=empty).
// At 1440, 1024, 800 and 390 it asserts the page never scrolls sideways and that the basis draws at
// most five rendered lines at 1440 and eight at 390. It asserts the chips read All, QB, RB, WR, TE, K
// and D/ST; that a K or D/ST chip draws the week's box score and never our order's table, with no #
// column and no floor-to-ceiling column; the head "Week 6 kickers" or "Week 6 defenses" as the table's
// name; the basis first saying the order is this week's published projection and that we have no
// model of our own (or, before the projection, that the rows are in order of Avg, with no Proj column
// and the status line); the rows still to play in order of Proj; the purpose naming the week's kickers
// and defenses; a search that keeps the club's row, and "No defense matches." for none; All bringing
// our order back; and that the copy passes the one guard. Exits non-zero on any fault.
//
//   node scripts/players-kdst-shots.ts [web origin] [out dir]
// with the site built on the stand-in run against the fixture API at API_ORIGIN.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { BOX } from '../src/lib/league/box/box.ts';
import { PAGE_PURPOSE } from '../src/lib/order/words.ts';
import { weekNone } from '../src/lib/order/week.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { basisLines, basisReport } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_UNREAD_CLOCK,
	FIXTURE_WEEK_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? '../screenshots/players-kdst/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
const STATE = process.env.STATE === 'empty' ? 'empty' : 'week';
await requireFixtureClock(
	API_ORIGIN,
	STATE === 'empty' ? FIXTURE_UNREAD_CLOCK : FIXTURE_WEEK_CLOCK
);

const WIDTHS = [1440, 1280, 1024, 800, 390] as const;
const SHOT_WIDTHS: ReadonlySet<number> = new Set([1440, 1280, 390]);
const THEMES = ['dark', 'light'] as const;
const VIEWPORT_HEIGHT = 900;
const PHONE_HEIGHT = 844;
const PHONE_MAX = 760;
const READY_TIMEOUT_MS = 30_000;
/** A beat for a table to draw an answer that has arrived. */
const SETTLE_MS = 300;
const CHIPS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const;
const BASIS = 'main p.basis';

interface Chip {
	chip: 'K' | 'D/ST';
	heading: string;
	many: string;
	one: 'kicker' | 'defense';
	/** A search that keeps one club's row, in the fixture's week. */
	search: string;
}

const WEEK_CHIPS: readonly Chip[] = [
	{ chip: 'K', heading: 'Week 6 kickers', many: 'Kickers', one: 'kicker', search: 'TEN' },
	{ chip: 'D/ST', heading: 'Week 6 defenses', many: 'Defenses', one: 'defense', search: 'titans' }
];

async function context(theme: string, width: number): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: width <= PHONE_MAX ? PHONE_HEIGHT : VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: width <= PHONE_MAX ? 2 : 1
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

async function choose(page: Page, chip: string): Promise<void> {
	await page.locator('.chips[aria-label="Position"] button', { hasText: chip }).first().click();
}

/** What a week chip draws, read in the page. */
async function weekSeen(page: Page) {
	return page.evaluate((basisSelector: string) => {
		const table = document.querySelector('main table.week');
		const heads = [...(table?.querySelectorAll('thead th') ?? [])].map((th) =>
			th.textContent.trim()
		);
		const projAt = heads.indexOf('Proj');
		const toPlay = [...(table?.querySelectorAll('tbody.to_play tr:not(.sec)') ?? [])].map((tr) =>
			Number((tr.querySelector('td.proj')?.textContent ?? '').trim())
		);
		return {
			table: table !== null,
			label: table?.getAttribute('aria-label') ?? '',
			order: document.querySelector('main table.order') !== null,
			heads,
			proj: projAt >= 0,
			toPlay,
			basis: document.querySelector(basisSelector)?.textContent ?? '',
			status: document.querySelector('main .week-screen')?.textContent ?? '',
			lead: document.querySelector('main')?.textContent ?? '',
			over: document.documentElement.scrollWidth - window.innerWidth,
			pressed: [
				...document.querySelectorAll('.chips[aria-label="Position"] button[aria-pressed="true"]')
			].map((b) => b.textContent.trim()),
			chips: [...document.querySelectorAll('.chips[aria-label="Position"] button')].map((b) =>
				b.textContent.trim()
			)
		};
	}, BASIS);
}

function weekFaults(seen: Awaited<ReturnType<typeof weekSeen>>, c: Chip, at: string): string[] {
	const said: string[] = [];
	if (!seen.table) said.push(`${at}: no week table`);
	if (seen.order) said.push(`${at}: our order's table drawn under ${c.chip}`);
	if (seen.label !== c.heading) said.push(`${at}: the table is named "${seen.label}"`);
	if (seen.heads.includes('#')) said.push(`${at}: a # column of ours`);
	if (seen.heads.some((h) => /floor|ceil/i.test(h))) said.push(`${at}: a floor-to-ceiling column`);
	if (seen.pressed.join() !== c.chip) said.push(`${at}: pressed ${seen.pressed.join()}`);
	if (seen.chips.join() !== CHIPS.join()) said.push(`${at}: the chips read ${seen.chips.join()}`);
	if (!seen.lead.includes(PAGE_PURPOSE.players)) said.push(`${at}: no purpose under the head`);
	if (STATE === 'week') {
		const first = `${c.many} are in order of ${BOX.proj}, this week's published projection`;
		if (!seen.basis.startsWith(first))
			said.push(`${at}: the basis opens "${seen.basis.slice(0, 80)}"`);
		if (!seen.basis.includes(`as we have no ${c.one} model of our own`))
			said.push(`${at}: the basis does not say we have no ${c.one} model`);
		if (!seen.proj) said.push(`${at}: no Proj column`);
		const sorted = seen.toPlay.every((p, i) => i === 0 || p <= (seen.toPlay[i - 1] ?? p));
		if (seen.toPlay.length === 0 || !sorted) said.push(`${at}: the rows to play are not by Proj`);
	} else {
		const first = `${c.many} are in order of ${BOX.avg} until this week's published projection is in.`;
		if (!seen.basis.startsWith(first))
			said.push(`${at}: the basis opens "${seen.basis.slice(0, 80)}"`);
		if (seen.proj) said.push(`${at}: a Proj column before the projection`);
		if (!seen.status.includes('is not in yet')) said.push(`${at}: no status line`);
	}
	return said;
}

async function searchFaults(page: Page, c: Chip, at: string): Promise<string[]> {
	const said: string[] = [];
	const input = page.locator('main input[type="search"]').first();
	await input.fill(c.search);
	await page.waitForTimeout(SETTLE_MS);
	const rows = await page.locator('main table.week tbody tr:not(.sec)').count();
	if (rows < 1 || rows > 2) said.push(`${at}: "${c.search}" keeps ${String(rows)} rows`);
	await input.fill('zzzz');
	await page.waitForTimeout(SETTLE_MS);
	const none = weekNone(c.chip === 'K' ? 'K' : 'DEF');
	if (!(await page.getByText(none).isVisible())) said.push(`${at}: no "${none}"`);
	await input.fill('');
	await page.waitForTimeout(SETTLE_MS);
	return said;
}

const browser = await chromium.launch();
const faults: string[] = [];
const measures: string[] = [];
await mkdir(out, { recursive: true });
try {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await context(theme, width);
			const page = await ctx.newPage();
			await page.goto(`${web}/players`);
			await page.locator('main table.order').waitFor({ timeout: READY_TIMEOUT_MS });
			await settle(page);
			for (const c of WEEK_CHIPS) {
				const at = `${theme} ${String(width)} ${c.chip}`;
				await choose(page, c.chip);
				await page.locator('main table.week').waitFor({ timeout: READY_TIMEOUT_MS });
				await page.locator(BASIS).waitFor({ timeout: READY_TIMEOUT_MS });
				await settle(page);
				const seen = await weekSeen(page);
				faults.push(...weekFaults(seen, c, at));
				if (seen.over > 0) faults.push(`${at}: scrolls sideways by ${String(seen.over)}`);
				const report = basisReport(`players ${c.chip}`, width, await basisLines(page, BASIS));
				if (report) {
					measures.push(`${theme} ${report.line}`);
					if (report.fault) faults.push(`${theme} ${report.fault}`);
				}
				if (SHOT_WIDTHS.has(width)) {
					const name = `${c.chip === 'K' ? 'k' : 'dst'}-${STATE}-${theme}-${String(width)}`;
					await page.screenshot({ path: new URL(`${name}.png`, out).pathname });
					if (width === 1440)
						await page.screenshot({
							path: new URL(`${name}-full.png`, out).pathname,
							fullPage: true
						});
				}
				const banned = await copyFault(page);
				if (banned) faults.push(`${at}: the copy says ${banned}`);
				if (theme === 'dark' && (width === 1440 || width === 390))
					faults.push(...(await searchFaults(page, c, at)));
			}
			await choose(page, 'All');
			await page.locator('main table.order').waitFor({ timeout: READY_TIMEOUT_MS });
			if ((await page.locator('main table.week').count()) > 0)
				faults.push(`${theme} ${String(width)}: the week's table stays under All`);
			await ctx.close();
		}
	}
} finally {
	await browser.close();
}

await writeFile(
	new URL('measures.txt', out),
	`${measures.join('\n')}\n${faults.length === 0 ? 'no faults' : faults.join('\n')}\n`
);
process.stdout.write(`${measures.join('\n')}\n`);
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exitCode = 1;
}
