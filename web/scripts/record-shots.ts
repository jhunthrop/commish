// Screenshots of Our record and the front door's record card (Lane 93) at 1280 and 390, on the record
// as the nightly writes it from the dev store on Monday night of week 6 (record-fixture/run.ts live):
// signed out (the standard lineup), and signed in with an ESPN stand-in league and the recorded
// Sleeper league selected (the league's own lineup, the ESPN league's week sentence from the fixture
// API, scripts/inseason-fixture/record.ts, a STAND-IN week). The browser runs on the fixture API's
// clock. It asserts the words the lane's rulings set: the graded count and why the rest are not, set
// and graded in one order, the measures defined once, no decimals sentence, no "froze", the chart's
// graded weeks, the distinct players, the front card's starters beside order matched and no ADP
// column on the in-season board. Exits non-zero on any fault.
//
//   node scripts/record-shots.ts [web origin] [api origin] [out dir]
// with the site built on the live record run against the fixture API at the api origin.
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { RECORD_WORDS } from '../src/lib/run/record.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { installFixtureApiClock } from './inseason-fixture/clock.ts';

const web = process.argv[2] ?? 'http://localhost:4193';
const API_ORIGIN = process.argv[3] ?? 'http://localhost:8893';
const out = new URL(process.argv[4] ?? '../screenshots/record-93/', import.meta.url);
const WIDTHS = [1280, 390] as const;
const PHONE_MAX = 760;
const SETTLE_MS = 600;
const READY_TIMEOUT_MS = 30_000;

type Who = 'signed-out' | 'espn' | 'sleeper';
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const ESPN = { name: 'fixture_league', value: 'espn' };

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

async function open(who: Who, width: number, path: string): Promise<Page> {
	const ctx = await browser.newContext({
		viewport: { width, height: width <= PHONE_MAX ? 844 : 900 },
		deviceScaleFactor: width <= PHONE_MAX ? 2 : 1,
		colorScheme: 'light'
	});
	await installFixtureApiClock(ctx, API_ORIGIN);
	const cookies = who === 'signed-out' ? [] : who === 'espn' ? [SIGNED_IN, ESPN] : [SIGNED_IN];
	if (cookies.length > 0)
		await ctx.addCookies(cookies.map((c) => ({ ...c, domain: 'localhost', path: '/' })));
	const page = await ctx.newPage();
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle', timeout: READY_TIMEOUT_MS });
	await page.waitForTimeout(SETTLE_MS);
	return page;
}

const has = (text: string, want: string, where: string): void => {
	if (!text.includes(want)) faults.push(`${where}: lacks "${want}"`);
};
const lacks = (text: string, never: RegExp, where: string): void => {
	if (never.test(text)) faults.push(`${where}: says ${String(never)}`);
};

async function record(who: Who, width: number): Promise<void> {
	const page = await open(who, width, '/record');
	const where = `record ${who} ${String(width)}`;
	const main = (await page.locator('main').textContent()) ?? '';
	has(main, 'Graded 2 of 5 weeks played', where);
	has(main, 'Weeks 3 to 5 were not set before kickoff, so they cannot be graded.', where);
	has(main, "Week 6 grades once every game's stats are in, usually Wednesday.", where);
	has(main, RECORD_WORDS.placesOff, where);
	// A run's own record leaves the published projection's start to the weekly record's desk and names
	// Published in its lead once its column is drawn (Lane 131, record.ts recordBasis): never here.
	lacks(main, /graded against the week's published projection/u, where);
	lacks(main, /Rates print|froze|freeze|one provider/u, where);
	if (width > PHONE_MAX) {
		has(main, 'Set Tue Sep 8, graded Tue Oct 13', where);
		has(main, '203 distinct', where);
		has(main, 'Players graded', where);
	}
	has(main, 'Order matched by week, 2 weeks graded', where);
	const axis = await page.locator('main .chart text.axis').allTextContents();
	if (axis.includes('18')) faults.push(`${where}: the chart draws an 18-week axis`);
	if (who === 'signed-out') has(main, 'Starters right counts a standard 12-team lineup', where);
	else {
		// Fix round 1: every starters figure and sentence on a league page reads the league's lineup.
		has(
			main,
			"Starters right counts the week's starters the order also put in your league's lineup, QB, 2 RB, 2 WR, TE and a flex across 12 teams",
			where
		);
		has(main, "ADP had more of the week's starters right, 107 of 168 against our 101.", where);
		lacks(main, /standard lineup|standard 12-team/u, where);
	}
	if (who === 'espn') {
		has(main, 'Following us instead of ESPN would have scored 8.4 more points over 1 week.', where);
		has(main, 'In your ESPN league, from week 7', where);
	} else lacks(main, /ESPN/u, where);
	await page.screenshot({
		path: new URL(`record-${who}-${String(width)}.png`, out).pathname,
		fullPage: true
	});
	await page.context().close();
}

async function front(width: number): Promise<void> {
	const page = await open('signed-out', width, '/');
	const where = `front ${String(width)}`;
	const card = (await page.locator('aside[aria-label="Our record"]').textContent()) ?? '';
	has(card, 'Graded 2 of 5 weeks played', where);
	has(card, 'Starters right, ours over the same weeks', where);
	has(card, 'Weeks 3 to 5 were not set before kickoff', where);
	lacks(card, /Rates print/u, where);
	const heads = await page
		.locator('main .top [role="columnheader"], main .top .head span')
		.allTextContents();
	if (heads.some((h) => h.trim() === 'ADP')) faults.push(`${where}: the in-season board draws ADP`);
	const basis = (await page.locator('main .top').textContent()) ?? '';
	lacks(basis, /ADP from/u, where);
	await page.screenshot({
		path: new URL(`front-${String(width)}.png`, out).pathname,
		fullPage: true
	});
	await page.context().close();
}

for (const width of WIDTHS) {
	for (const who of ['signed-out', 'espn', 'sleeper'] as const) await record(who, width);
	await front(width);
}
await browser.close();
process.stdout.write(
	`shots in ${out.pathname} (league ids ${FIXTURE_IDS.espnDone}, ${FIXTURE_IDS.league})\n`
);
if (faults.length > 0) {
	process.stdout.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write('no faults\n');
