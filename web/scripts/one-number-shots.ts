// Screenshots of one number for a player everywhere (Lane 234, B233; B209, B206, B211) against the
// fixture API (scripts/inseason-fixture/serve.ts at the Sunday clock, FIXTURE_SUNDAY_CLOCK) and the site
// built on the three-scoring run (inseason-fixture/formats-run.ts): Rankings (/players, the week's
// rankings with the byes last), one player page's every-format table and compare, at 390 and 1280.
// It reads, at a desk, every Rankings row's # cell against the answer's full-order number (overall_rank;
// the list's word for a player on a season-long list), the player page's rank cells against his
// /players/{id}/week figures' position_rank in each scoring, and compare's Our rank and Position rank
// against the order; at every width that no page scrolls sideways and the copy passes the one guard.
// Writes what each view read to readings.json beside the shots. Exits non-zero on a miss.
//
//   node scripts/one-number-shots.ts [web origin] [out dir]
// with the site built against the fixture API at API_ORIGIN (npm run shots -- one-number-shots).
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { components } from '../src/lib/api/types.ts';
import { ORDER } from '../src/lib/order/words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_SUNDAY_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';

type OrderRow = components['schemas']['OrderRow'];
type PlayerWeek = components['schemas']['PlayerWeek'];

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/one-number/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN, FIXTURE_SUNDAY_CLOCK);

const THEME = 'light';
const WIDTHS = [390, 1280] as const;
const DESK = WIDTHS[1];
const PHONE_MAX = 760;
const PHONE_HEIGHT = 844;
const DESK_HEIGHT = 900;
/** A beat for a table to draw an answer that has arrived. */
const SETTLE_MS = 600;
const READY_MS = 30_000;
/** The Rankings' answer with the byes last, every row (a row's overall_rank is the same at any limit). */
const RANKINGS = '/order?limit=400&byes=last';
/** The player whose every-format table is shot: a receiver whose place moves between scorings. */
const PLAYER = { slug: 'parker-washington', name: 'Parker Washington' };
/** The pair compare draws: the receiver and a back. */
const PAIR = [PLAYER, { slug: 'd-andre-swift', name: "D'Andre Swift" }] as const;
const COMPARE = `/compare?a=${PAIR[0].slug}&b=${PAIR[1].slug}`;
/** The empty figure the site draws (format/empty.ts). */
const NONE = '--';
/** The API's names for the scorings, in the table's labels. */
const SCORING_LABELS: Readonly<Record<string, string>> = {
	ppr: 'PPR',
	half_ppr: 'Half PPR',
	standard: 'Standard'
};

const failures: string[] = [];
function fail(tag: string, what: string): void {
	failures.push(`${tag}: ${what}`);
}

async function api<T>(path: string): Promise<T> {
	const response = await fetch(`${API_ORIGIN}${path}`);
	if (!response.ok) throw new Error(`The fixture's ${path} answered ${String(response.status)}.`);
	return (await response.json<{ data: T }>()).data;
}

const listed = (row: OrderRow): boolean => row.line.facts.designation?.season_long === true;

const browser = await chromium.launch();

async function context(width: number): Promise<BrowserContext> {
	const phone = width <= PHONE_MAX;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? PHONE_HEIGHT : DESK_HEIGHT },
		colorScheme: THEME,
		deviceScaleFactor: phone ? 2 : 1
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, THEME] as const
	);
	return ctx;
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(SETTLE_MS);
}

async function overflow(page: Page, tag: string): Promise<void> {
	const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	if (over > 0) fail(tag, `scrolls sideways by ${String(over)} px`);
}

type Readings = Record<string, unknown>;
const readings: Readings = {};

/** Every Rankings row's # cell and its player's page, in the order drawn. */
async function rankCells(page: Page): Promise<{ place: string; href: string }[]> {
	return page.$$eval('main table.order tbody tr', (rows) =>
		rows.flatMap((tr) => {
			const place = tr.querySelector('td.rank');
			const link = tr.querySelector('.nm a');
			return place === null
				? []
				: [
						{
							place: (place as HTMLElement).innerText.trim(),
							href: link?.getAttribute('href') ?? ''
						}
					];
		})
	);
}

/** Rankings: each row's # is the answer's full-order number, a listed row the list's word, and the
 * numbers skip where the byes moved (rows not consecutive). */
async function checkRankings(page: Page, rows: readonly OrderRow[]): Promise<void> {
	const drawn = await rankCells(page);
	const bySlug = new Map(rows.map((row) => [row.line.slug ?? '', row]));
	const seen: { slug: string; drawn: string; want: string }[] = [];
	for (const cell of drawn) {
		const slug = /\/players\/([^/#?]+)/u.exec(cell.href)?.[1] ?? '';
		const row = slug === '' ? undefined : bySlug.get(slug);
		if (row === undefined) continue;
		const want = listed(row) ? 'list word' : String(row.overall_rank ?? row.rank);
		seen.push({ slug, drawn: cell.place, want });
		const ok = listed(row) ? !/^\d+$/u.test(cell.place) && cell.place !== '' : cell.place === want;
		if (!ok) fail('players', `${slug} draws "${cell.place}", not ${want}`);
	}
	readings.players = seen;
	if (seen.length === 0) fail('players', 'draws no row the answer holds');
	const numbers = seen.filter((s) => /^\d+$/u.test(s.drawn)).map((s) => Number(s.drawn));
	const skips = numbers.some((n, i) => i > 0 && n !== (numbers[i - 1] ?? 0) + 1);
	if (!skips)
		fail('players', 'the numbers run 1..n, so no bye row moved (the fixture lost its byes)');
}

/** The every-format table: each scoring's Position rank cell is his figure's position_rank there. */
async function checkFormats(page: Page, week: PlayerWeek): Promise<void> {
	const table = page.locator('section[aria-label="Every format"] table');
	const lines = await table
		.locator('tbody tr')
		.evaluateAll((trs) =>
			trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()))
		);
	const position = week.line.player.position;
	const seen: { label: string; drawn: string; want: string }[] = [];
	for (const figure of week.rest_of_season ?? []) {
		const label = SCORING_LABELS[figure.format] ?? figure.format;
		const line = lines.find((cells) => cells[0]?.startsWith(label) === true);
		const rank = figure.position_rank ?? null;
		const want = rank === null ? NONE : `${position} ${String(rank)}`;
		const drawn = line?.[1] ?? '';
		seen.push({ label, drawn, want });
		if (drawn !== want) fail('formats', `${label} draws "${drawn}", not ${want}`);
	}
	readings.formats = seen;
	if (seen.length < 2) fail('formats', 'the read answers fewer than two scorings');
	const footnote = await page
		.locator('section[aria-label="Every format"] p, section[aria-label="Every format"] small')
		.allInnerTexts();
	readings.formatsNotes = footnote;
	if (footnote.some((text) => text.includes('no position rank')))
		fail('formats', 'draws the no-position-rank footnote over ranked rows');
}

/** Compare's Our rank and Position rank rows hold the order's numbers for the pair. */
async function checkCompare(page: Page, rows: readonly OrderRow[]): Promise<void> {
	const text = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
	const lines = text.split('\n').map((line) => line.trim().replace(/\s+/gu, ' '));
	const row = (label: string): string =>
		lines.find((line) => line.startsWith(`${label} `))?.slice(label.length + 1) ?? '';
	const shown = { ours: row('Our rank'), position: row('Position rank') };
	readings.compare = shown;
	for (const player of PAIR) {
		const placed = rows.find((r) => r.line.slug === player.slug);
		if (placed === undefined) {
			fail('compare', `the order places no ${player.name}`);
			continue;
		}
		const overall = String(placed.overall_rank ?? placed.rank);
		const chip = `${placed.line.player.position} ${String(placed.line.position_rank)}`;
		if (!shown.ours.split(' ').includes(overall))
			fail('compare', `Our rank reads "${shown.ours}", not ${overall} for ${player.name}`);
		if (!shown.position.includes(chip))
			fail('compare', `Position rank reads "${shown.position}", not ${chip} for ${player.name}`);
	}
}

async function open(ctx: BrowserContext, path: string, tag: string): Promise<Page> {
	const page = await ctx.newPage();
	await page.goto(new URL(path, web).href);
	await settle(page);
	await overflow(page, tag);
	const fault = await copyFault(page);
	if (fault !== null) fail(tag, fault);
	return page;
}

const rankings = await api<{ rows: OrderRow[] }>(RANKINGS);
const order = await api<{ rows: OrderRow[] }>('/order?limit=400');
const index = await api<{ rows: OrderRow[] }>(`/order?limit=400&q=${PLAYER.name.split(' ')[1]}`);
const id = index.rows.find((row) => row.line.slug === PLAYER.slug)?.line.player.board_id ?? '';
const week = await api<PlayerWeek>(`/players/${id}/week`);
readings.answer = {
	rankings: rankings.rows.map((row) => ({
		slug: row.line.slug,
		rank: row.rank,
		overall_rank: row.overall_rank,
		bye: row.line.facts.bye
	})),
	week: week.rest_of_season
};

await mkdir(out, { recursive: true });
for (const width of WIDTHS) {
	const ctx = await context(width);
	const desk = width === DESK;
	{
		const tag = `players-${String(width)}`;
		const page = await open(ctx, '/players', tag);
		await page.locator('main table.order').waitFor({ timeout: READY_MS });
		await settle(page);
		await page.screenshot({ path: new URL(`${tag}.png`, out).pathname, fullPage: true });
		// The byes sit past the first page: Show more draws them under their head, numbered.
		await page.getByRole('button', { name: ORDER.moreRows }).click();
		await page.locator('main table.order tbody.bye').waitFor({ timeout: READY_MS });
		await settle(page);
		if (desk) await checkRankings(page, rankings.rows);
		await page.locator('main table.order tbody.bye').scrollIntoViewIfNeeded();
		await page.screenshot({ path: new URL(`${tag}-byes.png`, out).pathname });
		await page.close();
	}
	{
		const tag = `player-${PLAYER.slug}-${String(width)}`;
		const page = await open(ctx, `/players/${PLAYER.slug}`, tag);
		if (desk) await checkFormats(page, week);
		const section = page.locator('section[aria-label="Every format"]');
		await section.scrollIntoViewIfNeeded();
		await section.screenshot({ path: new URL(`${tag}-formats.png`, out).pathname });
		await page.screenshot({ path: new URL(`${tag}.png`, out).pathname, fullPage: true });
		await page.close();
	}
	{
		const tag = `compare-${String(width)}`;
		const page = await open(ctx, COMPARE, tag);
		if (desk) await checkCompare(page, order.rows);
		await page.screenshot({ path: new URL(`${tag}.png`, out).pathname, fullPage: true });
		await page.close();
	}
	await ctx.close();
}
await browser.close();
await writeFile(new URL('readings.json', out), `${JSON.stringify(readings, null, '\t')}\n`);

if (failures.length > 0) {
	throw new Error(`${String(failures.length)} misses:\n${failures.join('\n')}`);
}
process.stdout.write(`One number shots in ${out.pathname}: every number the order's.\n`);
