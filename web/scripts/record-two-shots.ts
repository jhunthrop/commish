// Screenshots of Our record's two records and the front door's record card (Lane 114) at 1280 and 390,
// on the two records' shots run (scripts/record-fixture/two.ts): `upcoming` is the state at the run
// (week 7 not set, the draft record's real figures from the dev store), `graded` the STAND-IN page
// after week 7 grades. Signed out, and signed in with the ESPN stand-in league selected (the fixture
// API's weekly record in the league, scripts/inseason-fixture/record.ts, a STAND-IN week). It asserts
// the rulings' words: each record named by what it grades, ADP only under the draft record, weeks 1 to
// 6 in one line, the Yahoo sentence, the league's sentence, and the front card's named record. Exits
// non-zero on any fault.
//
//   node scripts/record-two-shots.ts <upcoming|graded> [web origin] [api origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { installFixtureApiClock } from './inseason-fixture/clock.ts';

const mode = process.argv[2] === 'graded' ? 'graded' : 'upcoming';
const web = process.argv[3] ?? 'http://localhost:4114';
const API_ORIGIN = process.argv[4] ?? 'http://localhost:8814';
const out = new URL(process.argv[5] ?? '../screenshots/record-114/', import.meta.url);
const WIDTHS = [1280, 390] as const;
const PHONE_MAX = 760;
const SETTLE_MS = 600;
const READY_TIMEOUT_MS = 30_000;

type Who = 'signed-out' | 'espn';
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
	if (who === 'espn')
		await ctx.addCookies([SIGNED_IN, ESPN].map((c) => ({ ...c, domain: 'localhost', path: '/' })));
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
	const where = `record ${mode} ${who} ${String(width)}`;
	const weekly = (await page.locator('section#weekly').textContent()) ?? '';
	const draft = (await page.locator('section#draft').textContent()) ?? '';
	has(weekly, 'Weekly record', where);
	has(weekly, "Our weekly rankings against ESPN and the week's published projection", where);
	has(weekly, 'Weeks 1 to 6', where);
	has(weekly, 'Before that the site shipped the draft board, graded under Draft record.', where);
	has(weekly, 'Yahoo publishes no player projection we can read, so it is not graded.', where);
	lacks(weekly, /\bADP\b|FantasyPros|froze|freeze/u, where);
	has(draft, 'Draft record', where);
	has(draft, "Our draft board against ADP, on the season's points so far", where);
	has(draft, 'Season points through week 5', where);
	has(draft, 'Top named counts the season', where);
	has(draft, 'ADP named more of the season', where);
	if (mode === 'upcoming') {
		has(weekly, '(set before kickoff Thu Oct 22)', where);
		lacks(weekly, /ESPN 0\.|Order matched by week/u, where);
	} else {
		has(weekly, '(set Thu Oct 22)', where);
		has(weekly, 'Order matched by week, 1 week graded', where);
		has(weekly, "ESPN's is its own public projection in PPR", where);
	}
	if (who === 'espn') {
		has(weekly, 'Your ESPN league, as it scores', where);
		has(
			weekly,
			'Following us instead of ESPN would have scored 8.4 more points over 1 week.',
			where
		);
		if (mode === 'graded') has(weekly, "Starters right counts your league's lineup", where);
	}
	await page.screenshot({
		path: new URL(`record-${mode}-${who}-${String(width)}.png`, out).pathname,
		fullPage: true
	});
	await page.context().close();
}

async function front(width: number): Promise<void> {
	const page = await open('signed-out', width, '/');
	const where = `front ${mode} ${String(width)}`;
	const card = (await page.locator('aside[aria-label="Our record"]').textContent()) ?? '';
	if (mode === 'upcoming') {
		has(card, 'Our record, Draft record', where);
		has(card, 'Order matched, our draft board through week 5', where);
		has(card, 'Weekly rankings start week 7.', where);
	} else {
		has(card, 'Our record, Weekly record', where);
		has(card, 'Order matched, our weekly rankings over week 7', where);
		lacks(card, /\bADP\b/u, where);
	}
	const shot = page.locator('aside[aria-label="Our record"]');
	await shot.screenshot({ path: new URL(`front-${mode}-${String(width)}.png`, out).pathname });
	await page.context().close();
}

for (const width of WIDTHS) {
	for (const who of ['signed-out', 'espn'] as const) await record(who, width);
	await front(width);
}
await browser.close();
process.stdout.write(`shots in ${out.pathname}\n`);
if (faults.length > 0) {
	process.stdout.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write('no faults\n');
