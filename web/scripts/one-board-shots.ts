// Screenshots of one board for every reader (Lane 96 fix round 1, B08; Lane 163, D05): the front door
// and /board, signed out and signed in, at 1280 and 390, against the fixture API on the fixture week's
// clock and the site built on the one-board run (inseason-fixture/one-board-run.ts, made Thursday
// morning, before week 6's Thursday game). It asserts that the front door prints the API's order signed
// out and signed in, its lead naming the shape and the read, with no run stamp ("Projected and Over
// replacement updated Thu Oct 15, 8:50 am Central"), that signed out each Over replacement it prints is
// the one GET /order (the Players page's read) gives the player and the basis defines it in the site's
// one sentence, and that /board reads the API's order either way. With TWO_QB=1 (the fixture API started with FIXTURE_TWO_QB=1, Lane 117, B78) the signed-in
// front door's strip holds rows built from the answer (shown with their Avg), and the basis says once why
// Tier reads "--" and that Avg is in the league's scoring, at a desk (a phone draws neither column).
// Both themes. Exits non-zero on any fault.
//
//   node scripts/one-board-shots.ts [web origin] [out dir]
// with the site built with PUBLIC_RUN_ID=2026-10-15T13-oneboard PUBLIC_RUN_BASE_URL=.runs against
// PUBLIC_API_URL naming the fixture API (API_ORIGIN, default http://localhost:8799), started with
// FIXTURE_RUN_ID=2026-10-15T13-oneboard FIXTURE_CLOCK=2026-10-17T17:00:00.000Z.
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import type { components } from '../src/lib/api/types.ts';
import { STRIP_ROWS, STRIP_WORDS, overReplacementPart } from '../src/lib/front/live-board.ts';
import { installFixtureApiClock, requireFixtureClock } from './inseason-fixture/clock.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
const out = process.argv[3] ?? new URL('../screenshots/one-board/', import.meta.url).pathname;
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);

const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const ZONE = 'America/Chicago';
const WIDTHS = [1280, 390] as const;
const PHONE_MAX = 760;
const HEIGHT = { desk: 900, phone: 844 } as const;
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 600;
const RUN_STAMP = 'Over replacement updated Thu Oct 15, 8:50 am Central';
const LIVE_LEAD = "for 12 teams, your league's shape, read";
/** The signed-out lead: the board's shape, no league (Lane 163, D05). */
const LIVE_LEAD_OUT = 'by points over replacement for 12 teams, read';
/** The site's one definition of Over replacement, for the signed-out board (Lane 163, D05). */
const DEFINED = overReplacementPart(12, 'PPR', false).text;
/** The API's order drawn as its box score (OrderScreen's table). */
const ORDER_TABLE = 'table.order';
const TWO_QB = process.env.TWO_QB === '1';
const THEMES = ['dark', 'light'] as const;
/** The basis parts a two-quarterback strip says once (B78). */
const TWO_QB_PARTS = [STRIP_WORDS.untiered('PPR'), STRIP_WORDS.leagueAvg];

interface Shot {
	name: string;
	path: string;
	signedIn: boolean;
	/** Words the page prints, or the selector its API read draws. */
	said: string;
	table?: boolean;
	unsaid?: string;
}
const SHOTS: readonly Shot[] = [
	{ name: 'front-signed-out', path: '/', signedIn: false, said: LIVE_LEAD_OUT, unsaid: RUN_STAMP },
	{ name: 'front-signed-in', path: '/', signedIn: true, said: LIVE_LEAD, unsaid: RUN_STAMP },
	{
		name: 'board-signed-out',
		path: '/board/ppr-12',
		signedIn: false,
		said: ORDER_TABLE,
		table: true
	},
	{ name: 'board-signed-in', path: '/board/ppr-12', signedIn: true, said: ORDER_TABLE, table: true }
];

/** A two-quarterback strip: its untiered rows draw their Avg, and the basis says each part once. */
async function twoQbFaults(page: Page, where: string): Promise<void> {
	const top = page.locator('section.top');
	const basis = (await top.locator('p.basis').first().textContent()) ?? '';
	const text = (await top.textContent()) ?? '';
	for (const part of TWO_QB_PARTS) {
		const said = text.split(part).length - 1;
		if (said !== 1) faults.push(`${where}: "${part}" said ${String(said)} times`);
		if (!basis.includes(part)) faults.push(`${where}: "${part}" is not in the basis line`);
	}
	if ((await top.locator('.notes').count()) > 0)
		faults.push(`${where}: a notes block under the rows`);
}

/** The Players page's read with no league: each top player's Over replacement, to the tenth. */
type OrderAdvice = components['schemas']['OrderAdvice'];
const publicResponse = await fetch(`${API_ORIGIN}/order?limit=${String(STRIP_ROWS)}`);
const publicOrder = (await publicResponse.json<{ data: OrderAdvice }>()).data;

/** One number everywhere (Lane 163, D05): the signed-out strip prints each row's Over replacement
 * as GET /order gives it, and its basis says the site's one definition once. */
async function oneNumberFaults(page: Page, where: string): Promise<void> {
	const text = (await page.locator('section.top').textContent()) ?? '';
	for (const row of publicOrder.rows) {
		const vor = row.points_over_replacement;
		if (vor !== null && !text.includes(`+${vor.toFixed(1)}`))
			faults.push(`${where}: ${row.line.player.name}'s ${vor.toFixed(1)} not printed`);
	}
	const said = text.split(DEFINED).length - 1;
	if (said !== 1) faults.push(`${where}: "${DEFINED}" said ${String(said)} times`);
}

await mkdir(out, { recursive: true });
const faults: string[] = [];
const browser = await chromium.launch();
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const phone = width <= PHONE_MAX;
		for (const shot of SHOTS) {
			const ctx = await browser.newContext({
				viewport: { width, height: phone ? HEIGHT.phone : HEIGHT.desk },
				colorScheme: theme,
				deviceScaleFactor: phone ? 2 : 1,
				timezoneId: ZONE
			});
			await installFixtureApiClock(ctx, API_ORIGIN);
			if (shot.signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
			const page = await ctx.newPage();
			await page.goto(`${web}${shot.path}`, { waitUntil: 'networkidle' });
			try {
				const ready =
					shot.table === true
						? page.locator(shot.said)
						: page.getByText(shot.said, { exact: false });
				await ready.first().waitFor({ timeout: READY_TIMEOUT_MS });
			} catch {
				faults.push(`${shot.name} at ${String(width)}: no "${shot.said}"`);
			}
			await page.waitForTimeout(SETTLE_MS);
			if (shot.unsaid !== undefined && (await page.getByText(shot.unsaid).count()) > 0) {
				faults.push(`${shot.name} at ${String(width)}: still "${shot.unsaid}"`);
			}
			if (shot.name === 'front-signed-out')
				await oneNumberFaults(page, `${shot.name} at ${String(width)}`);
			// The two parts are a desk's: a phone draws neither the Tier nor the Avg column.
			if (TWO_QB && !phone && shot.name === 'front-signed-in')
				await twoQbFaults(page, `${shot.name} at ${String(width)}`);
			const name = `${shot.name}-${theme}-${String(width)}.png`;
			await page.screenshot({ path: `${out}/${name}`, fullPage: true });
			await ctx.close();
		}
	}
}
await browser.close();
for (const fault of faults) process.stdout.write(`FAULT ${fault}\n`);
process.stdout.write(`${String(faults.length)} faults, shots in ${out}\n`);
process.exitCode = faults.length === 0 ? 0 : 1;
