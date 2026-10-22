// Screenshots of Our record's two records and the front door's record card (Lane 114) at 1280 and 390,
// on the two records' shots run (scripts/record-fixture/two.ts): `upcoming` is the state at the run
// (week 7 not set, the draft record's real figures from the dev store), `graded` the STAND-IN page
// after week 7 grades. Signed out, and signed in with the ESPN stand-in league selected (the fixture
// API's weekly record in the league, scripts/inseason-fixture/record.ts, a STAND-IN week). It asserts
// the rulings' words: each record named by what it grades, ADP only under the draft record, weeks 1 to
// 6 in one line with the set rule, no Yahoo sentence, no figure before a week is graded, the draft
// pairs' leaders, the league's sentence, and the front card's named record and week link. Exits
// non-zero on any fault. Each record's basis is held to the budget on its own (basis-lines.ts: eight
// lines at 390, Lane 131, and five at the 1440 desk, Lane 138), its count printed; the record pages are
// shot in both themes, the budget measured in light.
//
// `published` (Lane 142) shoots the front card once the week's published projection is graded beside
// ESPN: both yardsticks, the leader named per pair. `upcoming` also shoots the week's rankings page
// and its rail at 1280 and 390, signed out and with the ESPN stand-in, on a run page and on a league
// page the Worker draws: one name, "Week 7 rankings", on the rail, the bar's crumb after Players, the
// page's head and its rank column.
//
//   node scripts/record-two-shots.ts <upcoming|graded|published> [web origin] [api origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { basisLines, basisReport } from './basis-lines.ts';
import { installFixtureApiClock } from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const MODES = ['upcoming', 'graded', 'published'] as const;
const mode = MODES.find((m) => m === process.argv[2]) ?? 'upcoming';
const web = process.argv[3] ?? 'http://localhost:4114';
const API_ORIGIN = process.argv[4] ?? 'http://localhost:8814';
const out = new URL(process.argv[5] ?? '../screenshots/record-114/', import.meta.url);
/** The shot widths; 1440 is where the desk budget is measured (basis-lines.ts BASIS_BUDGET). */
const WIDTHS = [1440, 1280, 390] as const;
/** The front card is shot at 1280 and 390 (Lane 114), and its strip's basis held to the budget at
 * 1440 and 390 too (Lane 140). */
const FRONT_WIDTHS: readonly number[] = [1440, 1280, 390];
/** The rail and the week's rankings page are shot at 1280 and 390 (Lane 142). */
const RAIL_WIDTHS = [1280, 390] as const;
const PHONE_MAX = 760;
const SETTLE_MS = 600;
const READY_TIMEOUT_MS = 30_000;

type Who = 'signed-out' | 'espn';
type Theme = 'light' | 'dark';
const THEMES: readonly Theme[] = ['light', 'dark'];
/** The two records, each with its own basis block. */
const RECORDS = ['weekly', 'draft'] as const;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const ESPN = { name: 'fixture_league', value: 'espn' };

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

async function open(who: Who, width: number, path: string, theme: Theme = 'light'): Promise<Page> {
	const ctx = await browser.newContext({
		viewport: { width, height: width <= PHONE_MAX ? 844 : 900 },
		deviceScaleFactor: width <= PHONE_MAX ? 2 : 1,
		colorScheme: theme
	});
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
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

/** Each record's basis against the budget at a width it holds (Lane 131): its line printed, a fault
 * when over. */
async function basisFaults(page: Page, who: Who, width: number): Promise<void> {
	for (const name of RECORDS) {
		const lines = await basisLines(page, `section#${name} [data-basis]`);
		const report = basisReport(`record ${mode} ${name} ${who}`, width, lines);
		if (report === null) continue;
		process.stdout.write(`${report.line}\n`);
		if (report.fault !== null) faults.push(report.fault);
	}
}

async function record(who: Who, width: number, theme: Theme): Promise<void> {
	const page = await open(who, width, '/record', theme);
	const where = `record ${mode} ${who} ${theme} ${String(width)}`;
	const weekly = (await page.locator('section#weekly').textContent()) ?? '';
	const draft = (await page.locator('section#draft').textContent()) ?? '';
	has(weekly, 'Weekly record', where);
	has(weekly, "Our weekly rankings against ESPN and the week's published projection", where);
	has(weekly, 'Weeks 1 to 6', where);
	has(weekly, 'Before that the site shipped the draft board, graded under Draft record.', where);
	has(weekly, "Each week's are set before its first kickoff and graded as set", where);
	lacks(weekly, /Yahoo|weekly experts|\bADP\b|FantasyPros|froze|freeze|rest-of-season/iu, where);
	if (width > PHONE_MAX) has(weekly, 'Set each week before kickoff', where);
	has(draft, 'Draft record', where);
	has(draft, "Our draft board against ADP, on the season's points so far", where);
	has(draft, 'Season points through week 5', where);
	has(draft, "Top named counts how many of the season's top", where);
	has(draft, 'ADP named more of the season', where);
	has(draft, 'Each position is graded on its own', where);
	// The draft tiles: ADP beside ours at one size, each pair's leader, and what the figures count.
	has(draft, 'lower is better', where);
	has(draft, 'of the top 12 QB, 24 RB, 36 WR, 12 TE', where);
	has(draft, 'ADP by 4', where);
	has(draft, 'below 0.00 the order runs backwards', where);
	if (mode === 'upcoming') {
		has(weekly, 'Week 7 not graded yet', where);
		has(weekly, "Grades after Monday's game.", where);
		has(weekly, 'Set before kickoff Thu Oct 22', where);
		lacks(weekly, /ESPN 0\.|Order matched by week/u, where);
	} else {
		has(weekly, 'Set Thu Oct 22, ', where);
		has(weekly, 'Our weekly rankings, set Oct 22', where);
		has(weekly, 'Order matched by week, 1 week graded', where);
		has(weekly, "ESPN's is its own public projection in PPR", where);
		// The weekly pairs name the leader, ESPN's where it leads (fix round 1, HIGH-1).
		has(weekly, 'ESPN by 2', where);
	}
	if (who === 'espn') {
		has(weekly, 'Your ESPN league, as it scores', where);
		has(
			weekly,
			'Following us instead of ESPN would have scored 8.4 more points over 1 week.',
			where
		);
		if (mode === 'graded') {
			has(
				weekly,
				"Starters right counts the week's starters the order also put in your league's lineup",
				where
			);
			has(weekly, 'kickers and defenses not counted', where);
		}
	}
	if (theme === 'light') await basisFaults(page, who, width);
	await page.screenshot({
		path: new URL(`record-${mode}-${who}-${theme}-${String(width)}.png`, out).pathname,
		fullPage: true
	});
	await page.context().close();
}

async function front(width: number): Promise<void> {
	const page = await open('signed-out', width, '/');
	const where = `front ${mode} ${String(width)}`;
	const card = (await page.locator('aside[aria-label="Our record"]').textContent()) ?? '';
	if (mode === 'upcoming') {
		has(card, 'Draft record', where);
		has(card, 'Order matched is how closely an order ranked the players', where);
		has(card, 'Our draft board through week 5', where);
		has(
			card,
			"Weekly rankings start week 7, against ESPN and the week's published projection.",
			where
		);
		has(card, 'ADP by 4', where);
		lacks(card, /below it the reverse/u, where);
	} else {
		has(card, 'Weekly record', where);
		has(card, 'Order matched is how closely an order ranked the players', where);
		has(card, 'Our weekly rankings over week 7', where);
		has(card, 'ESPN by 2', where);
		lacks(card, /\bADP\b/u, where);
		// Both yardsticks once the published projection is graded, the leader named per pair (Lane 142).
		if (mode === 'published') {
			has(card, 'Published', where);
			has(card, 'Published by 2', where);
			has(card, 'ours by 0.05', where);
		} else lacks(card, /Published/u, where);
	}
	has(card, 'Week 7 rankings', where);
	// The link lands on a page headed as the link promised (fix round 1, MEDIUM-3).
	const target = await open('signed-out', width, '/players');
	has(
		(await target.locator('main h1, main h2').first().textContent()) ?? '',
		'Week 7 rankings',
		`${where} players`
	);
	await target.context().close();
	const lines = await basisLines(page, 'section.top p.basis');
	const report = basisReport(`front ${mode}`, width, lines);
	if (report !== null) {
		process.stdout.write(`${report.line}\n`);
		if (report.fault !== null) faults.push(report.fault);
	}
	const shot = page.locator('aside[aria-label="Our record"]');
	await shot.screenshot({ path: new URL(`front-${mode}-${String(width)}.png`, out).pathname });
	await page.context().close();
	// The whole front door in both themes, the heading, the strip's basis and its byes (Lane 140).
	for (const theme of THEMES) {
		const whole = await open('signed-out', width, '/', theme);
		await whole.screenshot({
			path: new URL(`front-page-${mode}-${theme}-${String(width)}.png`, out).pathname
		});
		await whole.context().close();
	}
}

/** The rail's labels as drawn, the phone's five or the desk's column. */
async function railLabels(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('nav.rail .item[data-k]')]
			.filter((item) => item.getBoundingClientRect().width > 0)
			.map((item) => item.innerText.trim())
	);
}

/** The week's rankings under one name (Lane 142, ruling 1): the rail on the run's page and on a league
 * page the Worker draws, the bar's crumb, the page's head and its rank column; no rail item says
 * Players in season. */
async function rail(who: Who, width: number): Promise<void> {
	const page = await open(who, width, '/players');
	const where = `rail ${who} ${String(width)}`;
	const head = page.locator('table.order th.g-order');
	await head
		.waitFor({ timeout: READY_TIMEOUT_MS })
		.catch(() => faults.push(`${where}: the order table never drew`));
	const labels = await railLabels(page);
	if (!labels.includes('Week 7 rankings'))
		faults.push(`${where}: the rail shows ${labels.join(', ')}`);
	if (labels.includes('Players')) faults.push(`${where}: the rail still says Players`);
	has(
		(await page.locator('main h1, main h2').first().textContent()) ?? '',
		'Week 7 rankings',
		where
	);
	has((await head.textContent()) ?? '', 'Week 7 rank', where);
	if (width > PHONE_MAX)
		has(
			(await page.locator('header.top h1').textContent()) ?? '',
			'Players / Week 7 rankings',
			where
		);
	await page.screenshot({
		path: new URL(`rail-players-${who}-${String(width)}.png`, out).pathname
	});
	await page.context().close();
	if (who !== 'espn') return;
	// A league page the Worker draws names the week from the API's season once the context answers.
	const league = await open(who, width, `/league/${FIXTURE_IDS.espnDone}`);
	await league
		.waitForFunction(
			() =>
				[...document.querySelectorAll<HTMLElement>('nav.rail .item[data-k="week"]')].some(
					(item) => item.innerText.trim() === 'Week 7 rankings'
				),
			undefined,
			{ timeout: READY_TIMEOUT_MS }
		)
		.catch(() => undefined);
	const leagueLabels = await railLabels(league);
	if (!leagueLabels.includes('Week 7 rankings'))
		faults.push(`${where} league: the rail shows ${leagueLabels.join(', ')}`);
	await league.screenshot({
		path: new URL(`rail-league-${who}-${String(width)}.png`, out).pathname
	});
	await league.context().close();
}

for (const width of WIDTHS) {
	if (mode !== 'published') {
		for (const who of ['signed-out', 'espn'] as const) {
			for (const theme of THEMES) await record(who, width, theme);
		}
	}
	if (FRONT_WIDTHS.includes(width)) await front(width);
}
if (mode === 'upcoming') {
	for (const width of RAIL_WIDTHS) {
		for (const who of ['signed-out', 'espn'] as const) await rail(who, width);
	}
}
await browser.close();
process.stdout.write(`shots in ${out.pathname}\n`);
if (faults.length > 0) {
	process.stdout.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write('no faults\n');
