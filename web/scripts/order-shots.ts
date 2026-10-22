// Screenshots of the Rest of season, Players and Our record screens as box scores (Lane 66j), against
// the fixture API (scripts/inseason-fixture/serve.ts, whose order.json names its stand-ins) and the
// built site, dark and light at 1440 and dark at 390 (with its first screen). Rest of season is the
// board in season, signed in with the recorded Sleeper league selected; Players is signed out; Our
// record reads the run the site was built from. At 1440, 1024, 800, 768 and 390 it asserts the page
// never scrolls sideways, and that every screen's basis draws at most five rendered lines at 1440 and
// eight at 390 (measured as line boxes, basis-lines.ts; Lane 66q, 66t). It also asserts the heads ("Our rest-of-season order" over #, Rest of season
// over Projected and A game, the week projection headed "Wk 6"), that every figure cell prints one decimal or --, that Trade for him sits on
// fewer than a third of the rows, that the copy passes the one guard ("host" among its words, the
// names the API and the run handed it skipped, copy-scan.ts), the record's Order matched head with the
// published projection's -- before its week, the honest sentence where the run carries one, and the
// record's chart at least 200 px tall on a phone. Our record is held to the run the site was built
// from (Lane 82): its scale and the two decimals said once, the Published column, figure and line
// drawn only once a graded week carries it, the basis the record's own sentences and no capture time,
// the axis printed 0.00 to 1.00; and the basis once Published is drawn, and at its worst (kickers and
// defenses graded too), measured in the page at 1440 and 390. Exits non-zero on any fault.
//
//   node scripts/order-shots.ts [web origin] [out dir, from scripts/]
// with the site built on a rest-of-season run against PUBLIC_API_URL=http://localhost:8799 and the
// fixture API running there, and PUBLIC_RUN_ID and PUBLIC_RUN_BASE_URL naming that run here too (the
// record shots run, scripts/record-fixture/run.ts, is live's shape).
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { onListWords } from '../src/lib/format/designation.ts';
import { FIGURE } from '../src/lib/format/figure-words.ts';
import { ORDER } from '../src/lib/order/words.ts';
import { locationFor, parseBaseUrl, parseRunId } from '../src/lib/run/config.ts';
import { RECORD_BOX, publishedDrawn, recordBasis } from '../src/lib/run/record.ts';
import { RUN_PATHS, recordSchema, type RunRecord } from '../src/lib/run/schema.ts';
import { openRun } from '../src/lib/run/source.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { basisLines, basisReport } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { installFixtureApiClock, requireFixtureClock } from './inseason-fixture/clock.ts';
import { LEAGUE_RULES_NOTE } from './inseason-fixture/week.ts';
import { pageFaults, pageLine, pageMeasures } from './page-measures.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
/** The fixture API the site was built against, on the fixture week's clock (FIXTURE_CLOCK=
 * 2026-10-17T17:00:00.000Z): the browser runs at its instant, never the day the script runs. */
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);
const out = new URL(process.argv[3] ?? '../screenshots/order/', import.meta.url);
const WIDTHS = [1440, 1024, 800, 768, 390] as const;
const SHOTS: readonly (readonly ['dark' | 'light', number])[] = [
	['dark', 1440],
	['light', 1440],
	['dark', 390]
];
const VIEWPORT_HEIGHT = 900;
const PHONE_HEIGHT = 844;
const PHONE_MAX = 760;
const READY_TIMEOUT_MS = 30_000;
/** A beat for the table to draw an answer that has arrived. */
const SETTLE_MS = 300;
/** Below this width the figures after the key fold under the name and the group heads go. */
const FOLDS_AT = 1100;
const BASIS_WIDTH = 1440;
const CHART_MIN_HEIGHT = 200;
/** The record the site was built from, read from its run: the page's words are held to it. */
const RECORD: RunRecord = await (
	await openRun({
		runId: parseRunId(process.env.PUBLIC_RUN_ID),
		location: locationFor(parseBaseUrl(process.env.PUBLIC_RUN_BASE_URL), process.env)
	})
).read(RUN_PATHS.record, recordSchema);
/** The chart axis's ends, printed as the rates print. */
const AXIS_ENDS = ['0.00', '1.00'] as const;
/** Below this width the roster mark folds onto the club line. */
const ROSTER_FOLDS_AT = 900;
/** Trade for him on fewer rows than this share (the coordinator's ruling 3). */
const MOST_TRADE_SHARE = 1 / 3;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const WEEK_HEAD = new RegExp(`^${FIGURE.week} \\d+$`);
const FIGURE_CELL = /^([-−]?\d+(\.\d)?|\d+(st|nd|rd|th)|--)$/;
/** A season-long list's short form, the # cell of a player the order places after the available
 * (Lane 128 review fix round 1): never a number. */
const LIST_PLACE = /^(IR|PUP|NFI|Susp|Out)$/;

const SCREENS = [
	{
		name: 'rest',
		path: '/board/ppr-12/rb',
		signedIn: true,
		ready: 'Our rest-of-season order',
		table: 'table.order'
	},
	{
		name: 'players',
		path: '/players',
		signedIn: false,
		ready: 'Find a player',
		table: 'table.order'
	},
	{
		name: 'record',
		path: '/record',
		signedIn: false,
		ready: 'Order matched by week',
		table: 'table.weeks'
	}
] as const;
type Screen = (typeof SCREENS)[number];

/** The caption the shots folder carries: what is real and what is a stand-in in them. */
const CAPTION = `# Lane 66j shots

- Rest of season and Players read the fixture API's order (scripts/inseason-fixture/order.ts): every player line
  the recorded Sleeper league's answers carry, real as served (rest-of-season points a game, the week's facts,
  Proj, Avg, Last, Opp rank, status), its rosters, the trade finder's best trade with each team and the Waivers
  answer's claim moves (Sleeper takes no claim from here, so the add verb reads "Open Sleeper waivers").
  STAND-INS: the fixture holds 85 of the order's players; each Projected figure is the points a game times his club's games
  left and each Over repl. the points over replacement a week times 12, which the API reads from the board; a
  position's # is the fixture's own order of those totals among the players it holds; every Proj is the
  fixture's one projection snapshot, the week 1 published figure.
- The Rest of season shot is the RB tab. Its tabs are All, QB and RB only because the run the site was built
  from (the contract fixture's 2026-10-21T12-ros run) carries boards for those two positions.
- Our record reads the run the site was built from. On the record shots run (scripts/record-fixture/run.ts,
  Lane 82) that is live's shape a week on: weeks 1 and 2 are real grades of our preseason order, weeks 3 to 6
  are STAND-INS (live has weeks 3 to 5 missed and week 6 waiting on its stats), week 7 frozen and not played,
  and the published projection kept from week 7 so not drawn yet. The run keeps the contract fixture's time,
  Oct 21, so its header, the boards' refresh and week 7's freeze that morning agree. The basis lines "record published" and
  "record worst" are the page's basis with the words the nightly writes once Published is graded, and with
  kickers and defenses graded too, measured in the page.
`;

await mkdir(out, { recursive: true });
await writeFile(new URL('README.md', out), CAPTION);
const browser = await chromium.launch();
const faults: string[] = [];
const pageLines: string[] = [];

async function context(theme: string, width: number, signedIn: boolean): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: width <= PHONE_MAX ? PHONE_HEIGHT : VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: width <= PHONE_MAX ? 2 : 1
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	if (signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function open(
	page: Page,
	screen: Pick<Screen, 'table' | 'ready'> & { path: string }
): Promise<void> {
	await page.goto(`${web}${screen.path}`);
	await page.locator(screen.table).first().waitFor({ timeout: READY_TIMEOUT_MS });
	await page
		.getByText(screen.ready)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

async function common(page: Page, screen: Screen, width: number): Promise<string[]> {
	const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	const said: string[] = [];
	if (over > 0) said.push(`${screen.name} at ${String(width)} scrolls sideways by ${String(over)}`);
	// Every screen's basis is held at both widths (Lane 66t), measured as the line boxes it draws.
	const report = basisReport(
		screen.name === 'rest' ? 'board' : screen.name,
		width,
		await basisLines(page)
	);
	if (report !== null) {
		process.stdout.write(`${report.line}\n`);
		if (report.fault !== null) said.push(report.fault);
	}
	const banned = await copyFault(page);
	if (banned !== null) said.push(`${screen.name} at ${String(width)} says ${banned}`);
	return said;
}

async function orderFaults(page: Page, screen: Screen, width: number): Promise<string[]> {
	const seen = await page.evaluate(() => {
		const table = document.querySelector('main table.order');
		const text = (el: Element): string => el.textContent.trim();
		const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
		return {
			groups: [...(table?.querySelectorAll('tr.grp th') ?? [])].filter(visible).map(text),
			heads: [...(table?.querySelectorAll('tr.cols th') ?? [])].filter(visible).map(text),
			rows: table?.querySelectorAll('tbody tr').length ?? 0,
			trades: [...(table?.querySelectorAll('a.verb.trade') ?? [])].length,
			adds: [...(table?.querySelectorAll('a.verb.add') ?? [])].length,
			mine: table?.querySelectorAll('tbody tr.mine').length ?? 0,
			cells: [...(table?.querySelectorAll('td.n') ?? [])].filter(visible).map(text),
			places: [...(table?.querySelectorAll('td.rank') ?? [])].map(text),
			folded: [...(table?.querySelectorAll('.ph-ev') ?? [])].filter(visible).map(text)
		};
	});
	const said: string[] = [];
	if (seen.rows === 0) said.push(`${screen.name}: no rows`);
	if (width >= FOLDS_AT && !seen.groups.includes('Our rest-of-season order'))
		said.push(`${screen.name}: no order group over # (${seen.groups.join('|')})`);
	if (width >= FOLDS_AT && !seen.groups.includes('Rest of season'))
		said.push(`${screen.name}: no Rest of season group`);
	for (const head of ['#', 'Player']) {
		if (!seen.heads.includes(head))
			said.push(`${screen.name} at ${String(width)}: no ${head} head`);
	}
	// The week's projection beside the season's Projected is headed by the API's week ("Wk 6").
	if (!seen.heads.some((head) => WEEK_HEAD.test(head)) || seen.heads.includes('Proj'))
		said.push(`${screen.name} at ${String(width)}: no week head (${seen.heads.join('|')})`);
	if (!seen.heads.includes(FIGURE.projected) && !seen.heads.includes('Over repl.'))
		said.push(`${screen.name} at ${String(width)}: no key head`);
	if (width >= FOLDS_AT && !seen.heads.includes(FIGURE.perGame))
		said.push(`${screen.name}: no ${FIGURE.perGame} head`);
	if (width < FOLDS_AT && !seen.folded.every((f) => f.includes(FIGURE.avg)))
		said.push(`${screen.name} at ${String(width)}: the figures do not fold under the name`);
	for (const cell of seen.cells) {
		if (!FIGURE_CELL.test(cell) && !LIST_PLACE.test(cell))
			said.push(`${screen.name}: cell "${cell}"`);
	}
	// Every listed row sits after every numbered one (Lane 128 review fix round 1).
	const places = seen.places;
	const firstListed = places.findIndex((p) => LIST_PLACE.test(p));
	if (firstListed >= 0 && places.slice(firstListed).some((p) => !LIST_PLACE.test(p)))
		said.push(`${screen.name}: a numbered row after a listed one (${places.join(' ')})`);
	if (screen.signedIn) {
		if (seen.trades === 0 || seen.trades >= seen.rows * MOST_TRADE_SHARE)
			said.push(`rest: Trade for him on ${String(seen.trades)} of ${String(seen.rows)} rows`);
		if (seen.mine === 0) said.push('rest: none of your players tinted');
		if (width > ROSTER_FOLDS_AT && !seen.heads.includes('Roster'))
			said.push('rest: no Roster head');
	} else if (seen.trades + seen.adds > 0) {
		said.push('players: a league move without a league');
	}
	return said;
}

async function recordFaults(page: Page, width: number): Promise<string[]> {
	const seen = await page.evaluate(() => {
		const text = (el: Element): string => el.textContent.trim();
		return {
			heads: [...document.querySelectorAll('main table.weeks th')].map(text),
			published: document.querySelectorAll('main table.weeks .published').length,
			bug: document.querySelector('main .bug .tiles')?.textContent ?? '',
			lines: [...document.querySelectorAll('main .chart g text')].map(text),
			axis: [...document.querySelectorAll('main .chart text.axis')].map(text),
			honest: document.querySelector('main .honest')?.textContent.trim() ?? '',
			basis: document.querySelector('main [data-basis]')?.textContent.trim() ?? '',
			chart: document.querySelector('main .chart svg')?.getBoundingClientRect().height ?? 0,
			main: document.querySelector('main')?.textContent ?? ''
		};
	});
	const said: string[] = [];
	if (width > PHONE_MAX && !seen.heads.some((h) => /order matched/i.test(h)))
		said.push('record: no Order matched head');
	if (seen.heads.some((h) => /rank corr|agreement/i.test(h)))
		said.push('record: the old head is drawn');
	// The honest empty state (Lane 82): no Published column, figure or line before a graded week has it.
	const drawn = publishedDrawn(RECORD);
	const shown = {
		column: seen.published > 0,
		figure: seen.bug.includes(RECORD_BOX.published),
		line: seen.lines.includes(RECORD_BOX.published)
	};
	for (const [part, on] of Object.entries(shown)) {
		if (on !== drawn) said.push(`record: Published ${part} ${on ? 'drawn' : 'missing'}`);
	}
	if (seen.honest === '' && RECORD.honest !== null) said.push('record: no honest sentence');
	// The record defines order matched once, in its basis, and says nothing of decimals (Lane 93).
	if (seen.main.includes('Rates print')) said.push('record: the decimals sentence is drawn');
	for (const once of [RECORD.scale]) {
		const n = seen.main.split(once).length - 1;
		if (n !== 1) said.push(`record: "${once}" said ${String(n)} times`);
	}
	const basis = recordBasis(RECORD).join(' ');
	if (seen.basis !== basis) said.push(`record: the basis is not the record's: ${seen.basis}`);
	if (/capture/i.test(seen.basis)) said.push('record: the basis says the capture');
	if (seen.axis.at(0) !== undefined && !AXIS_ENDS.every((end) => seen.axis.includes(end)))
		said.push(`record: the axis prints ${seen.axis.join(' ')}`);
	if (width <= PHONE_MAX && seen.chart < CHART_MIN_HEIGHT)
		said.push(`record: the chart is ${String(Math.round(seen.chart))} px tall on a phone`);
	return said;
}

/** The record's basis in two states the run does not carry yet, measured in the page at a budget
 * width: Published drawn (a graded week carries it), and the worst case, Published drawn with kickers
 * and defenses graded too. Each is said as the nightly would (research/nightly/reads/record.py). */
function recordVariants(): readonly (readonly [string, RunRecord])[] {
	const published = RECORD.toDate.map((line) => ({ ...line, published: line.ours }));
	const drawn: RunRecord = {
		...RECORD,
		toDate: published,
		method: RECORD.method.replace('ADP on the same', 'ADP and Published on the same')
	};
	const worst: RunRecord = {
		...drawn,
		startersBasis:
			"Starters right counts a standard 12-team lineup, the week's top 12 QBs, 24 RBs, 36 WRs, 12 TEs, 12 kickers and 12 defenses, and how many of them the order also put there."
	};
	return [
		['record published', drawn],
		['record worst', worst]
	];
}

async function variantFaults(page: Page, width: number): Promise<string[]> {
	const said: string[] = [];
	for (const [name, variant] of recordVariants()) {
		await page.evaluate((text: string) => {
			const p = document.querySelector('main [data-basis] p');
			if (p !== null) p.textContent = text;
		}, recordBasis(variant).join(' '));
		const report = basisReport(name, width, await basisLines(page));
		if (report === null) continue;
		process.stdout.write(`${report.line}\n`);
		if (report.fault !== null) said.push(report.fault);
	}
	return said;
}

/** The first row's position and the table's row count, to see a tap change the table. */
async function tableState(page: Page): Promise<{ first: string; rows: number; kinds: string[] }> {
	return page.evaluate(() => {
		const rows = [...document.querySelectorAll('main table.order tbody tr')];
		return {
			first: rows[0]?.querySelector('.club')?.textContent ?? '',
			rows: rows.length,
			kinds: rows.map((r) => r.querySelector('td.roster .own')?.className ?? '')
		};
	});
}

/** Taps on the Rest of season screen (review 66j L14): a position chip reads that position's order (H1),
 * the Free chip reads the API's free players with the total after it (H5), Show more reads more rows,
 * and the basis names the league shape (H4). */
async function tapFaults(): Promise<string[]> {
	const said: string[] = [];
	const ctx = await context('dark', BASIS_WIDTH, true);
	const page = await ctx.newPage();
	const rest = SCREENS[0];
	await open(page, rest);
	const basis = (await page.locator('main [data-basis]').textContent()) ?? '';
	if (!basis.includes("less a free pickup's in your league.") || !basis.includes(LEAGUE_RULES_NOTE))
		said.push('rest: the basis names no league or no rules our stats lack');
	const before = await tableState(page);
	await page.getByRole('link', { name: 'QB', exact: true }).first().click();
	await page.waitForURL(/\/qb$/);
	await page.waitForFunction(
		() =>
			document.querySelector('main table.order tbody tr .club')?.textContent.includes('QB') ??
			false,
		undefined,
		{ timeout: READY_TIMEOUT_MS }
	);
	const after = await tableState(page);
	if (after.first === before.first) said.push('rest: the QB chip left the table as it was');
	await Promise.all([
		page.waitForResponse((r) => r.url().includes('roster=free')),
		page.getByRole('button', { name: 'Free', exact: true }).click()
	]);
	await page.waitForTimeout(SETTLE_MS);
	const free = await tableState(page);
	if (free.rows === 0 && (await page.getByText('No player in our order matches.').count()) === 0)
		said.push('rest: Free shows no rows and no sentence');
	if (free.kinds.some((k) => !k.includes('free'))) said.push('rest: Free shows a rostered player');
	// Show more: the fixture holds fewer rows than a page, so the answer is held to two rows a read.
	await page.route(
		(url) => url.pathname.endsWith('/order'),
		async (route) => {
			const url = new URL(route.request().url());
			const response = await route.fetch();
			const body = (await response.json()) as { data: { rows: unknown[]; total: number } };
			const limit = Number(url.searchParams.get('limit'));
			body.data.rows = body.data.rows.slice(0, limit === 100 ? 2 : 4);
			body.data.total = Math.max(body.data.total, 3);
			await route.fulfill({ response, json: body });
		}
	);
	await Promise.all([
		page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/order')),
		page.getByRole('button', { name: 'Everyone', exact: true }).click()
	]);
	await page.waitForTimeout(SETTLE_MS);
	const more = page.getByRole('button', { name: 'Show more', exact: true });
	if ((await more.count()) === 0) said.push('rest: no Show more though the total is past the rows');
	else {
		await Promise.all([page.waitForResponse((r) => r.url().includes('limit=200')), more.click()]);
		await page.waitForTimeout(SETTLE_MS);
		if ((await tableState(page)).rows <= 2) said.push('rest: Show more read no more rows');
	}
	await ctx.close();
	return said;
}

/** The add verb followed through to Waivers (review 66j N2): the order's add opens Waivers with him
 * named and his position, Waivers reads him by name, and his row is marked, never "not a free agent". */
async function addFaults(): Promise<string[]> {
	const said: string[] = [];
	const ctx = await context('dark', BASIS_WIDTH, true);
	const page = await ctx.newPage();
	// The backs' view: its one free back is on IR with no return date (the capture, Lane 128), so his
	// row draws the IR words in the verb's place and no add, and the add followed is the whole order's first.
	await open(page, SCREENS[0]);
	const held = page.locator('main table.order tr', { has: page.locator('.held') });
	if ((await held.count()) === 0) said.push('rest: no free back on IR draws the IR words');
	for (const text of await held.allInnerTexts()) {
		if (!text.includes(`${onListWords('IR')}, ${ORDER.noReturn}`))
			said.push(`rest: an IR free agent's row reads "${text}"`);
	}
	if ((await held.locator('a.verb').count()) > 0) said.push('rest: an IR free agent has a verb');
	await open(page, { ...SCREENS[0], path: '/board/ppr-12' });
	const add = page.locator('main table.order a.verb.add').first();
	if ((await add.count()) === 0) {
		await ctx.close();
		return ['rest: no add verb to follow'];
	}
	const href = (await add.getAttribute('href')) ?? '';
	const asked = new URL(href, web).searchParams;
	if (asked.get('player') === null || asked.get('position') === null)
		said.push(`rest: the add link names no player and position: ${href}`);
	const read = page.waitForRequest((r) => r.url().includes('/waivers'), {
		timeout: READY_TIMEOUT_MS
	});
	await add.click();
	const request = await read;
	if (new URL(request.url()).searchParams.get('player') !== asked.get('player'))
		said.push('waivers: the read does not name the asked player');
	await page
		.locator('main tr[data-asked]')
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS })
		.catch(() => said.push('waivers: the asked player has no marked row'));
	if ((await page.getByText('He is not a free agent in this league.').count()) > 0)
		said.push('waivers: says the free player is not a free agent');
	await page.screenshot({ path: new URL('rest-add-to-waivers-dark-1440.png', out).pathname });
	await ctx.close();
	return said;
}

faults.push(...(await tapFaults()));
faults.push(...(await addFaults()));
for (const screen of SCREENS) {
	for (const width of WIDTHS) {
		const ctx = await context('dark', width, screen.signedIn);
		const page = await ctx.newPage();
		await open(page, screen);
		faults.push(...(await common(page, screen, width)));
		faults.push(
			...(screen.name === 'record'
				? await recordFaults(page, width)
				: await orderFaults(page, screen, width))
		);
		if (screen.name === 'record') {
			faults.push(...(await variantFaults(page, width)));
			// Lane 87: every drawn row of the week table ends at its right edge, at every width.
			const measured = await pageMeasures(page);
			pageLines.push(pageLine(`record ${String(width)}`, measured));
			faults.push(
				...pageFaults(measured, width <= PHONE_MAX, 3).map((f) => `record ${String(width)}: ${f}`)
			);
		}
		await ctx.close();
	}
	for (const [theme, width] of SHOTS) {
		const ctx = await context(theme, width, screen.signedIn);
		const page = await ctx.newPage();
		await open(page, screen);
		const name = `${screen.name}-${theme}-${String(width)}`;
		if (width <= PHONE_MAX) {
			await page.screenshot({ path: new URL(`${name}-first-screen.png`, out).pathname });
		}
		await page.screenshot({ path: new URL(`${name}.png`, out).pathname, fullPage: true });
		if (screen.name === 'record') {
			// The table alone, the bars that ride over it hidden for its element shot.
			await page.addStyleTag({ content: 'nav.rail, header.top { display: none !important; }' });
			await page
				.locator(screen.table)
				.screenshot({ path: new URL(`record-table-${theme}-${String(width)}.png`, out).pathname });
		}
		await ctx.close();
	}
}
await browser.close();
for (const line of pageLines) process.stdout.write(`${line}\n`);
for (const fault of faults) process.stdout.write(`FAULT ${fault}\n`);
process.stdout.write(`${String(faults.length)} faults\n`);
process.exit(faults.length === 0 ? 0 : 1);
