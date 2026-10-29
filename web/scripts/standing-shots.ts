// Screenshots of the ESPN fixture league's Matchup and Lineup (Lane 99), at 1440 and 1280 light at a
// desk and 390 dark in a hand, on whichever of three clocks the fixture API runs: the week before its
// kickoffs (FIXTURE_WEEK_CLOCK), Monday night with the Monday game under way (FIXTURE_LIVE_CLOCK) and
// the Tuesday after (FIXTURE_TUESDAY_CLOCK). It asserts both tables head the position chip Our rank and
// say what it is in the basis; the Lineup strip names whose lineup its figure is, its link says where
// it goes, its rule for our pick is said under the rows and never above them, and the Opp rank's key
// sits under its head with no colour on a game played; from the first kickoff the Matchup bug prints
// the API's standing line and the Lineup strip the API's miss line, never before it. It prints each
// basis's rendered lines and holds them to five at a desk and eight on a phone (BASIS_BUDGET), and at
// a desk every name in the Matchup's boxes keeps to one line (fix round 1) and each box stays inside
// its column (Lane 108 fix round 1). Exits non-zero on any
// fault.
//
//   node scripts/standing-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API (API_ORIGIN, default
// http://localhost:8999), and the fixture API running there on one of the three clocks.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
	PICK_PART,
	RANK_OPP_PART,
	RANK_OPP_PHONE,
	RANK_PART
} from '../src/lib/league/box/basis.ts';

/** The phone Lineup's opening clause: the rule our pick follows (basis.ts pickProjPart). */
const PICK_PHONE_START = "Our pick is each slot's highest Proj,";
import { BOX } from '../src/lib/league/box/box.ts';
import { LINEUP } from '../src/lib/league/box/lineup.ts';
import type { LineupAdvice, MatchupBox } from '../src/lib/league/inseason/api.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import {
	FIXTURE_LIVE_CLOCK,
	FIXTURE_TUESDAY_CLOCK,
	FIXTURE_WEEK_CLOCK,
	fixtureApiClock,
	installFixtureApiClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { BASIS_BUDGET, basisLines } from './basis-lines.ts';

const web = process.argv[2] ?? 'http://localhost:4199';
const out = new URL(process.argv[3] ?? '../screenshots/standing/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8999').origin;
const SHOTS: readonly (readonly ['dark' | 'light', number])[] = [
	['light', 1440],
	['light', 1280],
	['dark', 390]
];
const PHONE_MAX = 760;
const HEIGHT = 900;
const PHONE_HEIGHT = 844;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const league = FIXTURE_IDS.espnDone;
/** The desk's budget at every desk width (BASIS_BUDGET names 1440). */
const DESK_BUDGET = 5;

const MOMENTS: Readonly<Record<string, string>> = {
	[FIXTURE_WEEK_CLOCK]: 'week',
	[FIXTURE_LIVE_CLOCK]: 'live',
	[FIXTURE_TUESDAY_CLOCK]: 'tuesday'
};

const clock = (await fixtureApiClock(API_ORIGIN)).clock ?? '';
const moment = MOMENTS[clock];
if (moment === undefined)
	throw new Error(`The fixture API at ${API_ORIGIN} runs on ${clock || 'the real clock'}.`);

async function apiAnswer<T>(route: string): Promise<T> {
	const res = await fetch(`${API_ORIGIN}/leagues/attached/${league}/${route}`, {
		headers: { cookie: `${SIGNED_IN.name}=${SIGNED_IN.value}` }
	});
	return (await res.json<{ data: T }>()).data;
}

const box = await apiAnswer<MatchupBox>('matchup');
const lineup = await apiAnswer<LineupAdvice>('lineup');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];
const counts: string[] = [];

async function context(theme: string, width: number): Promise<BrowserContext> {
	const phone = width <= PHONE_MAX;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? PHONE_HEIGHT : HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: phone ? 2 : 1
	});
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle', { timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
}

/** The text of every match of a selector on the page. */
async function texts(page: Page, selector: string): Promise<string[]> {
	return page.locator(selector).allInnerTexts();
}

function expect(ok: boolean, fault: string): void {
	if (!ok) faults.push(fault);
}

async function matchup(page: Page, at: string): Promise<void> {
	const heads = await texts(page, 'table.box thead .cols th');
	expect(
		heads.some((h) => h.toLowerCase() === BOX.ourRank.toLowerCase()),
		`${at}: no Our rank head`
	);
	const main = await page.locator('main').innerText();
	expect(main.includes(RANK_PART), `${at}: the basis does not say what Our rank is`);
	const standing = await texts(page, '.bug .standing');
	if (moment === 'week') expect(standing.length === 0, `${at}: a standing line before kickoff`);
	else
		expect(
			standing[0] === (box.standing ?? ''),
			`${at}: standing ${JSON.stringify(standing)}, the API's ${String(box.standing)}`
		);
	if (box.decided === true)
		expect(
			(await page.locator('.bug .mid b').innerText()).toLowerCase() === 'decided',
			`${at}: decided but the bug does not say so`
		);
}

async function lineupScreen(page: Page, at: string, width: number): Promise<void> {
	const heads = await texts(page, 'table.lineup thead .cols th');
	expect(
		heads.some((h) => h.toLowerCase() === BOX.ourRank.toLowerCase()),
		`${at}: no Our rank head`
	);
	if (width > PHONE_MAX)
		expect(
			heads.some((h) => h.includes(BOX.oppRankKey)),
			`${at}: the Opp rank head has no key`
		);
	const strip = await page.locator('div.strip:not(.words)').innerText();
	expect(strip.includes('as set on ESPN'), `${at}: the strip does not name whose lineup it is`);
	expect(strip.includes(LINEUP.pastWeeks), `${at}: the strip has no link to past weeks`);
	expect(
		(await page.locator('[data-basis="rule"]').count()) === 0,
		`${at}: the rule for our pick above the rows`
	);
	const basis = await page.locator('[data-basis]').last().innerText();
	const phone = width <= PHONE_MAX;
	// The phone says the rule in one clause with what Proj is, Our rank in fewer words (Lane 115, B83).
	expect(
		basis.startsWith(phone ? PICK_PHONE_START : PICK_PART),
		`${at}: the basis does not open with the rule for our pick`
	);
	expect(
		basis.includes(phone ? RANK_OPP_PHONE : RANK_OPP_PART),
		`${at}: the basis does not say what Our rank is`
	);
	const missed = await texts(page, 'div.strip .missed');
	expect(
		(missed[0] ?? null) === (lineup.missed ?? null),
		`${at}: miss line ${JSON.stringify(missed)}, the API's ${String(lineup.missed)}`
	);
	if (moment === 'week') expect(missed.length === 0, `${at}: a miss line before kickoff`);
	if (moment === 'tuesday') {
		const tinted = await page.locator('table.lineup .rk.easy, table.lineup .rk.hard').count();
		expect(tinted === 0, `${at}: ${String(tinted)} Opp rank cells coloured on a week played`);
	}
}

for (const [theme, width] of SHOTS) {
	const ctx = await context(theme, width);
	const page = await ctx.newPage();
	for (const [name, path] of [
		['matchup', `/league/${league}/matchup`],
		['lineup', `/league/${league}/start`]
	] as const) {
		const at = `${name} ${moment} ${theme} ${String(width)}`;
		await page.goto(`${web}${path}`);
		await settle(page);
		if (name === 'matchup') await matchup(page, at);
		else await lineupScreen(page, at, width);
		const lines = await basisLines(page);
		const budget = width > PHONE_MAX ? DESK_BUDGET : (BASIS_BUDGET[width] ?? DESK_BUDGET);
		counts.push(`${at}: basis ${String(lines)} lines (of ${String(budget)})`);
		expect(lines <= budget, `${at}: basis ${String(lines)} lines, over ${String(budget)}`);
		if (name === 'matchup' && width > PHONE_MAX) {
			const wrapped = await page.$$eval('table.box .nm a, table.box .nm b', (names) =>
				names.filter((n) => n.getClientRects().length > 1).map((n) => n.textContent)
			);
			expect(wrapped.length === 0, `${at}: names on two lines: ${wrapped.join(', ')}`);
			// Each box stays inside its column of the two (Lane 108 fix round 1, HIGH-1): the page does
			// not scroll sideways when a box overruns, so its edge is measured against its grid cell.
			// Its column is half the pair's row less the gap; a box never reaches past it.
			const over = await page.$$eval('main .boxes', (rows) =>
				rows.flatMap((row) => {
					const frame = row.getBoundingClientRect();
					const cells = [...row.children];
					const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
					const column = (frame.width - gap * (cells.length - 1)) / cells.length;
					return cells.flatMap((cell, i) => {
						const right = frame.left + column * (i + 1) + gap * i;
						const edges = [cell, ...cell.querySelectorAll('table.box')].map(
							(el) => el.getBoundingClientRect().right
						);
						const edge = Math.max(...edges);
						return edge > right + 0.5
							? [`${(edge - right).toFixed(0)} px (box ${String(i + 1)})`]
							: [];
					});
				})
			);
			expect(over.length === 0, `${at}: a box runs past its column by ${over.join(', ')}`);
		}
		const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
		expect(!wide, `${at}: scrolls sideways`);
		await page.screenshot({
			path: new URL(`${name}-${moment}-${theme}-${String(width)}.png`, out).pathname,
			fullPage: true
		});
	}
	await ctx.close();
}
await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${[...counts, ...faults].join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`${counts.join('\n')}\nStanding shots (${moment}) in ${out.pathname}\n`);
