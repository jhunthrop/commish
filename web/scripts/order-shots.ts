// Screenshots of the Rest of season, Players and Our record screens as box scores (Lane 66j), against
// the fixture API (scripts/inseason-fixture/serve.ts, whose order.json names its stand-ins) and the
// built site, dark and light at 1440 and dark at 390 (with its first screen). Rest of season is the
// board in season, signed in with the recorded Sleeper league selected; Players is signed out; Our
// record reads the run the site was built from. At 1440, 1024, 800, 768 and 390 it asserts the page
// never scrolls sideways, and at 1440 that the basis draws at most five rendered lines (measured, never
// counted in paragraphs). It also asserts the heads ("Our rest-of-season order" over #, Rest of season
// over Total and A game), that every figure cell prints one decimal or --, that Trade for him sits on
// fewer than a third of the rows, that no word says "host", the record's Order matched head with the
// published projection's -- before its week, the honest sentence where the run carries one, and the
// record's chart at least 200 px tall on a phone. Exits non-zero on any fault.
//
//   node scripts/order-shots.ts [web origin] [out dir, from scripts/]
// with the site built on a rest-of-season run against PUBLIC_API_URL=http://localhost:8799 and the
// fixture API running there.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
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
const BASIS_WIDTH = 1440;
const MOST_BASIS_LINES = 5;
const CHART_MIN_HEIGHT = 200;
/** Below this width the roster mark folds onto the club line. */
const ROSTER_FOLDS_AT = 900;
/** Trade for him on fewer rows than this share (the coordinator's ruling 3). */
const MOST_TRADE_SHARE = 1 / 3;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const FIGURE_CELL = /^(\d+(\.\d)?|\d+(st|nd|rd|th)|--)$/;

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
  the recorded Sleeper league's answers carry, real as served (position rank, rest-of-season points a game, the
  week's facts, Avg, Last, Opp rank, status), its rosters and the trade finder's best trade with each team.
  STAND-INS: the fixture holds 85 of the order's players; each Total is the points a game times his club's games
  left, which the API divides the other way, and a position's # is the fixture's own order of those totals among
  the players it holds; every Proj is the fixture's one projection snapshot, the week 1 published figure.
- Our record reads the run the site was built from (the contract fixture's 2026-10-21T12-ros run, its record
  regenerated from dev's register, read only): weeks 1 and 2 are real grades, weeks 3 to 5 the register's real
  misses, the published projection -- until week 7, as the register holds it.
`;

await mkdir(out, { recursive: true });
await writeFile(new URL('README.md', out), CAPTION);
const browser = await chromium.launch();
const faults: string[] = [];

async function context(theme: string, width: number, signedIn: boolean): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: width <= PHONE_MAX ? PHONE_HEIGHT : VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: width <= PHONE_MAX ? 2 : 1
	});
	if (signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function open(page: Page, screen: Screen): Promise<void> {
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
	const seen = await page.evaluate(() => {
		const basis = [...document.querySelectorAll('main [data-basis] p')];
		return {
			over: document.documentElement.scrollWidth - window.innerWidth,
			basisLines: basis.reduce((n, p) => {
				const style = getComputedStyle(p);
				return n + Math.round(p.getBoundingClientRect().height / parseFloat(style.lineHeight));
			}, 0),
			host: [...document.querySelectorAll('main p, main td, main th, main button, main a')]
				.map((el) => (el as HTMLElement).innerText)
				.filter((text) => /\bhosts?\b/i.test(text))
		};
	});
	const said: string[] = [];
	if (seen.over > 0)
		said.push(`${screen.name} at ${String(width)} scrolls sideways by ${String(seen.over)}`);
	if (width === BASIS_WIDTH && (seen.basisLines === 0 || seen.basisLines > MOST_BASIS_LINES))
		said.push(`${screen.name}: basis draws ${String(seen.basisLines)} lines`);
	for (const word of seen.host) said.push(`${screen.name} says host: ${word}`);
	return said;
}

async function orderFaults(page: Page, screen: Screen, width: number): Promise<string[]> {
	const seen = await page.evaluate(() => {
		const table = document.querySelector('main table.order');
		const text = (el: Element): string => (el.textContent ?? '').trim();
		const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
		return {
			groups: [...(table?.querySelectorAll('tr.grp th') ?? [])].filter(visible).map(text),
			heads: [...(table?.querySelectorAll('tr.cols th') ?? [])].filter(visible).map(text),
			rows: table?.querySelectorAll('tbody tr').length ?? 0,
			trades: [...(table?.querySelectorAll('a.verb.trade') ?? [])].length,
			adds: [...(table?.querySelectorAll('a.verb.add') ?? [])].length,
			mine: table?.querySelectorAll('tbody tr.mine').length ?? 0,
			cells: [...(table?.querySelectorAll('td.n') ?? [])].filter(visible).map(text)
		};
	});
	const said: string[] = [];
	const wide = width > PHONE_MAX;
	if (seen.rows === 0) said.push(`${screen.name}: no rows`);
	if (wide && !seen.groups.includes('Our rest-of-season order'))
		said.push(`${screen.name}: no order group over # (${seen.groups.join('|')})`);
	if (wide && !seen.groups.includes('Rest of season'))
		said.push(`${screen.name}: no Rest of season group`);
	for (const head of ['#', 'Player', 'Proj', 'Total']) {
		if (!seen.heads.includes(head))
			said.push(`${screen.name} at ${String(width)}: no ${head} head`);
	}
	if (width >= 1100 && !seen.heads.includes('A game')) said.push(`${screen.name}: no A game head`);
	for (const cell of seen.cells) {
		if (!FIGURE_CELL.test(cell)) said.push(`${screen.name}: cell "${cell}"`);
	}
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
		const text = (el: Element): string => (el.textContent ?? '').trim();
		return {
			heads: [...document.querySelectorAll('main table.weeks th')].map(text),
			published: [...document.querySelectorAll('main table.weeks td.published')].map(text),
			honest: document.querySelector('main .honest')?.textContent.trim() ?? '',
			chart: document.querySelector('main .chart svg')?.getBoundingClientRect().height ?? 0
		};
	});
	const said: string[] = [];
	if (width > PHONE_MAX && !seen.heads.some((h) => /order matched/i.test(h)))
		said.push('record: no Order matched head');
	if (seen.heads.some((h) => /rank corr|agreement/i.test(h)))
		said.push('record: the old head is drawn');
	if (seen.published.length > 0 && seen.published.some((cell) => cell !== '--'))
		said.push(
			`record: a published figure before the register holds it: ${seen.published.join(' ')}`
		);
	if (seen.honest === '') said.push('record: no honest sentence though ours trails');
	if (width <= PHONE_MAX && seen.chart < CHART_MIN_HEIGHT)
		said.push(`record: the chart is ${String(Math.round(seen.chart))} px tall on a phone`);
	return said;
}

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
		await ctx.close();
	}
}
await browser.close();
for (const fault of faults) process.stdout.write(`FAULT ${fault}\n`);
process.stdout.write(`${String(faults.length)} faults\n`);
process.exit(faults.length === 0 ? 0 : 1);
