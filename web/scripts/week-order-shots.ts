// Screenshots of the kickers' and defenses' tabs in season (Lane 66w) against the fixture API
// (scripts/inseason-fixture/serve.ts, its week from week-order.ts, which names its stand-ins) and the
// built site: each tab for a visitor and for a member following the ESPN stand-in league, dark and
// light at 1440 and 390 (with the phone's first screen), the week read (Saturday of week 6) and the
// honest empty state (the Tuesday before, the projection not in). The script starts the fixture API
// itself on each state's clock and gives the browser the same clock. At 1440, 1024, 800 and 390 it
// asserts the page never scrolls sideways; that the basis draws at most five rendered lines at 1440
// and eight at 390; the head "Week 6 kickers" or "Week 6 defenses" and never the rest of the season;
// that every figure cell prints one decimal, a rank or --; that no word says "host"; the Proj column
// once the projection is in and the status line with no Proj column before; the played Thursday and
// bye sections; for a member the Roster head and at most five adds; and that no image comes from the
// image host, every club mark from our route at its drawn size. Exits non-zero on any fault.
//
//   node scripts/week-order-shots.ts [web origin] [fixture port] [out dir, from scripts/]
// with the site built on the stand-in run against PUBLIC_API_URL=http://localhost:<fixture port> and
// served by scripts/serve-built.ts at the web origin.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import {
	FIXTURE_CLOCK_VARIABLE,
	FIXTURE_UNREAD_CLOCK,
	FIXTURE_WEEK_CLOCK
} from './inseason-fixture/clock.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
const fixturePort = Number(process.argv[3] ?? 8799);
const out = new URL(process.argv[4] ?? '../screenshots/week-order/', import.meta.url);
const WIDTHS = [1440, 1024, 800, 390] as const;
const SHOTS: readonly (readonly ['dark' | 'light', number])[] = [
	['dark', 1440],
	['light', 1440],
	['dark', 390],
	['light', 390]
];
const VIEWPORT_HEIGHT = 900;
const PHONE_HEIGHT = 844;
const PHONE_MAX = 760;
const READY_TIMEOUT_MS = 30_000;
/** How long the fixture API has to answer its clock, and how often it is asked. */
const FIXTURE_START_MS = 15_000;
const FIXTURE_POLL_MS = 250;
/** A beat for a table to draw an answer that has arrived. */
const SETTLE_MS = 300;
/** The most rendered lines the basis may draw, by the widths it is measured at. */
const MOST_BASIS_LINES: Readonly<Partial<Record<number, number>>> = { 1440: 5, 390: 8 };
/** Above this width the Roster column is drawn. */
const ROSTER_FROM = 900;
const MOST_ADDS = 5;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
/** The fixture's ESPN stand-in league is the member's selected league (serve.ts). */
const ESPN_LEAGUE = { name: 'fixture_league', value: 'espn' };
const FIGURE_CELL = /^(\d+\.\d|\d+(st|nd|rd|th)|--)$/;
const CLUB_MARK = /\/img\/clubs\/nfl\/[a-z]+\/64$/;

interface Screen {
	name: string;
	path: string;
	member: boolean;
	heading: string;
	state: 'week' | 'empty';
}

const SCREENS: readonly Screen[] = [
	{
		name: 'k-visitor',
		path: '/board/ppr-12/k',
		member: false,
		heading: 'Week 6 kickers',
		state: 'week'
	},
	{
		name: 'k-member',
		path: '/board/ppr-12/k',
		member: true,
		heading: 'Week 6 kickers',
		state: 'week'
	},
	{
		name: 'dst-visitor',
		path: '/board/ppr-12/dst',
		member: false,
		heading: 'Week 6 defenses',
		state: 'week'
	},
	{
		name: 'dst-member',
		path: '/board/ppr-12/dst',
		member: true,
		heading: 'Week 6 defenses',
		state: 'week'
	},
	{
		name: 'k-visitor-empty',
		path: '/board/ppr-12/k',
		member: false,
		heading: 'Week 6 kickers',
		state: 'empty'
	},
	{
		name: 'dst-member-empty',
		path: '/board/ppr-12/dst',
		member: true,
		heading: 'Week 6 defenses',
		state: 'empty'
	}
];

const CLOCKS = { week: FIXTURE_WEEK_CLOCK, empty: FIXTURE_UNREAD_CLOCK } as const;

const CAPTION = `# Lane 66w shots

- The kickers' (K) and defenses' (DST) tabs of the in-season board, read from the fixture API's week
  (scripts/inseason-fixture/week-order.ts) on the stand-in run's site. The visitor reads GET /order/week in
  PPR; the member follows the ESPN stand-in league (Office League), whose claims are made from here, so the
  add reads "Add on ESPN" on the first five free rows still to play.
- REAL: each club's game in week 6 (opponent, kickoff, expected points, roof, weather) from the fixture's
  recorded GET /games/week; the kickers' and defenses' names, clubs and headshots from dev's directory; the
  member's own defenses (Houston, Minnesota) from the recorded league; club marks through our own image route
  at 64 px.
- STAND-INS: every Proj is the fixture's one projection snapshot (the dev store's week 1 figure); Opp rank,
  Avg and Last are made up from each club's code, as dev holds no kicking source yet; the other teams' rosters
  are dealt by club.
- \`*-empty-*\` is the Tuesday before: the projection and the game facts not read yet, so there is no Proj
  column and the Game cell holds the opponent and kickoff alone.
`;

await mkdir(out, { recursive: true });
await writeFile(new URL('README.md', out), CAPTION);
const browser = await chromium.launch();
const faults: string[] = [];
const measures: string[] = [];

function startFixture(clock: string): ChildProcess {
	const child = spawn(process.execPath, ['scripts/inseason-fixture/serve.ts'], {
		env: { ...process.env, PORT: String(fixturePort), [FIXTURE_CLOCK_VARIABLE]: clock },
		stdio: 'ignore'
	});
	return child;
}

/** The fixture API started on the state's clock, read from its own /fixture/clock (Lane 66x): the
 * screens are shot only when the API and the browser agree on the instant. */
async function fixtureOnClock(clock: string): Promise<void> {
	const until = Date.now() + FIXTURE_START_MS;
	while (Date.now() < until) {
		const said = await fetch(`http://localhost:${String(fixturePort)}/fixture/clock`)
			.then((r) => r.json<{ data: { clock: string | null } | null }>())
			.catch(() => null);
		if (said !== null) {
			if (said.data?.clock !== clock)
				throw new Error(
					`The fixture API on ${String(fixturePort)} runs on ${said.data?.clock ?? 'the real clock'}, not ${clock}.`
				);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, FIXTURE_POLL_MS));
	}
	throw new Error(`The fixture API on ${String(fixturePort)} did not answer its clock.`);
}

async function context(theme: string, width: number, screen: Screen): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: width <= PHONE_MAX ? PHONE_HEIGHT : VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: width <= PHONE_MAX ? 2 : 1
	});
	if (screen.member) {
		await ctx.addCookies([
			{ ...SIGNED_IN, domain: 'localhost', path: '/' },
			{ ...ESPN_LEAGUE, domain: 'localhost', path: '/' }
		]);
	}
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	await ctx.clock.install({ time: new Date(CLOCKS[screen.state]) });
	return ctx;
}

/** The page open with its week read, and every image it fetched. */
async function open(
	page: Page,
	screen: Screen
): Promise<{ images: string[]; bytes: () => number }> {
	const images: string[] = [];
	let bytes = 0;
	page.on('response', (response) => {
		if (response.request().resourceType() !== 'image') return;
		images.push(response.url());
		void response
			.body()
			.then((body) => {
				bytes += body.length;
			})
			.catch(() => undefined);
	});
	await page.goto(`${web}${screen.path}`);
	await page.locator('main table.week').first().waitFor({ timeout: READY_TIMEOUT_MS });
	await page.getByText(screen.heading).first().waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
	return { images, bytes: () => bytes };
}

async function check(
	page: Page,
	screen: Screen,
	width: number,
	images: string[]
): Promise<string[]> {
	const seen = await page.evaluate(() => {
		const text = (el: Element): string => el.textContent.trim();
		const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
		const basis = document.querySelector('main .lead .basis');
		const style = basis ? getComputedStyle(basis) : null;
		const table = document.querySelector('main table.week');
		return {
			over: document.documentElement.scrollWidth - window.innerWidth,
			basisLines:
				basis && style
					? Math.round(basis.getBoundingClientRect().height / parseFloat(style.lineHeight))
					: 0,
			heading: document.querySelector('main .lead h2')?.textContent.trim() ?? '',
			heads: [...(table?.querySelectorAll('thead th') ?? [])].filter(visible).map(text),
			sections: [...(table?.querySelectorAll('tr.sec th') ?? [])].map(text),
			cells: [...(table?.querySelectorAll('td.n') ?? [])].filter(visible).map(text),
			adds: [...(table?.querySelectorAll('a.verb.add') ?? [])].map(
				(a) => a.getAttribute('aria-label') ?? ''
			),
			rows: table?.querySelectorAll('tbody tr:not(.sec)').length ?? 0,
			mine: table?.querySelectorAll('tbody tr.mine').length ?? 0,
			status: document.querySelector('main .status')?.textContent.trim() ?? '',
			rules: basis?.textContent.match(/Our stats omit [^.]+\./)?.[0] ?? '',
			rulesLink: basis?.querySelector('a')?.getAttribute('href') ?? '',
			glued: /[a-z]\.[A-Z]/.test(basis?.textContent ?? ''),
			host: [...document.querySelectorAll('main p, main td, main th, main a, main button')]
				.map((el) => (el as HTMLElement).innerText)
				.filter((said) => /\bhosts?\b/i.test(said))
		};
	});
	const at = `${screen.name} at ${String(width)}`;
	const said: string[] = [];
	if (seen.over > 0) said.push(`${at} scrolls sideways by ${String(seen.over)}`);
	const most = MOST_BASIS_LINES[width];
	if (most !== undefined) {
		measures.push(`${at}: basis ${String(seen.basisLines)} lines`);
		if (seen.basisLines === 0 || seen.basisLines > most)
			said.push(`${at}: basis draws ${String(seen.basisLines)} lines`);
	}
	if (seen.heading.toLowerCase() !== screen.heading.toLowerCase())
		said.push(`${at}: head "${seen.heading}"`);
	if (/rest of/i.test(seen.heading)) said.push(`${at}: the head names the rest of the season`);
	if (seen.rows !== 32) said.push(`${at}: ${String(seen.rows)} rows for 32 clubs`);
	for (const cell of seen.cells) if (!FIGURE_CELL.test(cell)) said.push(`${at}: cell "${cell}"`);
	for (const word of seen.host) said.push(`${at} says host: ${word}`);
	const proj = seen.heads.includes('Proj');
	if (screen.state === 'week') {
		if (!proj) said.push(`${at}: no Proj head with the projection in`);
		if (!seen.sections.includes('Played Thursday')) said.push(`${at}: no Played Thursday section`);
		if (seen.status !== '') said.push(`${at}: a status line with the projection in`);
	} else {
		if (proj) said.push(`${at}: a Proj column before the projection is in`);
		if (!seen.status.includes('is not in yet')) said.push(`${at}: no status line`);
	}
	if (!seen.sections.includes('Bye in week 6')) said.push(`${at}: no bye section`);
	// The fixture's league leaves out two rules a tab (week-order-serve.ts), named inline (Lane 111,
	// B33): the kickers' as one missed kick, the defenses' both.
	const named = screen.path.endsWith('/k') ? 'missed kick' : 'fumble recovery and safety';
	if (seen.rules !== `Our stats omit ${named}.`)
		said.push(`${at}: the rules left out read "${seen.rules}"`);
	if (seen.glued) said.push(`${at}: two basis sentences run together`);
	// No link to follow: the rules are named where they are said.
	if (seen.rulesLink !== '') said.push(`${at}: the basis links to "${seen.rulesLink}"`);
	if (screen.member) {
		if (width > ROSTER_FROM && !seen.heads.includes('Roster')) said.push(`${at}: no Roster head`);
		// The member holds two defenses in the recorded league and no kicker.
		if (screen.name.startsWith('dst') && seen.mine === 0) said.push(`${at}: none of yours tinted`);
		if (screen.state === 'week' && (seen.adds.length === 0 || seen.adds.length > MOST_ADDS))
			said.push(`${at}: ${String(seen.adds.length)} adds`);
		if (seen.adds.some((a) => !a.startsWith('Add on ESPN')))
			said.push(`${at}: an add not "Add on ESPN": ${seen.adds.join(' | ')}`);
	} else if (seen.adds.length > 0) {
		said.push(`${at}: an add without a league`);
	}
	if (!seen.heads.includes('Opp rank') && width >= 1100) said.push(`${at}: no Opp rank head`);
	for (const url of images) {
		if (url.includes('espncdn')) said.push(`${at}: an image from the image host: ${url}`);
	}
	if (screen.name.startsWith('dst') && !images.some((url) => CLUB_MARK.test(url)))
		said.push(`${at}: no club mark from our route`);
	return said;
}

/** The board's position chips move between tabs on one page (review 66w finding 1): All, RB, K, DST
 * and back to RB, each tab's own table drawn under its own head, never a stale head or a reading
 * line. */
async function tabFaults(): Promise<string[]> {
	const said: string[] = [];
	const member = SCREENS.find((s) => s.name === 'dst-member');
	if (member === undefined) return ['no member screen'];
	const ctx = await context('dark', 1440, member);
	const page = await ctx.newPage();
	await page.goto(`${web}/board/ppr-12`);
	await page.locator('main table.order').first().waitFor({ timeout: READY_TIMEOUT_MS });
	const steps = [
		{ chip: 'RB', table: 'table.order', head: /^(?!.*(kickers|defenses)).+$/ },
		{ chip: 'K', table: 'table.week', head: /^Week 6 kickers$/ },
		{ chip: 'DST', table: 'table.week', head: /^Week 6 defenses$/ },
		{ chip: 'RB', table: 'table.order', head: /^(?!.*(kickers|defenses)).+$/ }
	] as const;
	for (const step of steps) {
		await page.getByRole('link', { name: step.chip, exact: true }).first().click();
		await page.waitForURL(new RegExp(`/${step.chip.toLowerCase()}$`));
		const drawn = await page
			.locator(`main ${step.table} tbody tr`)
			.first()
			.waitFor({ timeout: READY_TIMEOUT_MS })
			.then(() => true)
			.catch(() => false);
		if (step.table === 'table.week')
			await page
				.getByText(step.head)
				.first()
				.waitFor({ timeout: READY_TIMEOUT_MS })
				.catch(() => undefined);
		const seen = await page.evaluate(() => ({
			head: document.querySelector('main .lead h2')?.textContent.trim() ?? '',
			reading: [...document.querySelectorAll('main p.reading')].filter(
				(p) => (p as HTMLElement).offsetParent !== null
			).length,
			basis: document.querySelector('main .lead .basis')?.textContent ?? ''
		}));
		const at = `tabs to ${step.chip}`;
		if (!drawn) said.push(`${at}: no rows`);
		if (!step.head.test(seen.head)) said.push(`${at}: head "${seen.head}"`);
		if (seen.reading > 0) said.push(`${at}: a reading line stays`);
		if (step.chip === 'RB' && /kickers|defenses/.test(seen.basis))
			said.push(`${at}: the week's basis stays`);
	}
	await page.screenshot({ path: new URL('tabs-back-to-rb-dark-1440.png', out).pathname });
	said.push(...(await lateReadFaults(page)));
	await ctx.close();
	return said;
}

/** How long the kickers' read is held, past the defenses' read and the tab switch. */
const LATE_READ_MS = 2500;

/** A late kickers' read never lands on the defenses' tab (rereview N1): the K read is held, K then
 * DST are clicked at once, and once both reads are in the tab still heads and explains defenses. */
async function lateReadFaults(page: Page): Promise<string[]> {
	const said: string[] = [];
	await page.route(
		(url) => url.pathname.endsWith('/order/week') && url.searchParams.get('position') === 'K',
		async (route) => {
			await new Promise((resolve) => setTimeout(resolve, LATE_READ_MS));
			await route.continue().catch(() => undefined);
		}
	);
	const late = page.waitForResponse((r) => r.url().includes('position=K'), {
		timeout: READY_TIMEOUT_MS
	});
	await page.getByRole('link', { name: 'K', exact: true }).first().click();
	await page.getByRole('link', { name: 'DST', exact: true }).first().click();
	await page.waitForURL(/\/dst$/);
	await page.locator('main table.week tbody tr').first().waitFor({ timeout: READY_TIMEOUT_MS });
	await late;
	await page.waitForTimeout(SETTLE_MS);
	const seen = await page.evaluate(() => ({
		head: document.querySelector('main .lead h2')?.textContent.trim() ?? '',
		basis: document.querySelector('main .lead .basis')?.textContent ?? ''
	}));
	if (seen.head !== 'Week 6 defenses') said.push(`late K read: the DST tab heads "${seen.head}"`);
	if (!seen.basis.startsWith('Defenses')) said.push('late K read: the DST tab explains kickers');
	await page.screenshot({ path: new URL('tabs-late-kickers-read-dark-1440.png', out).pathname });
	await page.unrouteAll({ behavior: 'ignoreErrors' });
	return said;
}

for (const state of ['week', 'empty'] as const) {
	const fixture = startFixture(CLOCKS[state]);
	await fixtureOnClock(CLOCKS[state]);
	try {
		if (state === 'week') faults.push(...(await tabFaults()));
		for (const screen of SCREENS.filter((s) => s.state === state)) {
			for (const width of WIDTHS) {
				const ctx = await context('dark', width, screen);
				const page = await ctx.newPage();
				const { images, bytes } = await open(page, screen);
				faults.push(...(await check(page, screen, width, images)));
				if (width === 1440 && screen.name.startsWith('dst'))
					measures.push(
						`${screen.name} at 1440: ${String(images.length)} images, ${String(Math.round(bytes() / 1024))} KB`
					);
				await ctx.close();
			}
			for (const [theme, width] of SHOTS) {
				const ctx = await context(theme, width, screen);
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
	} finally {
		fixture.kill();
	}
}
await browser.close();
for (const line of measures) process.stdout.write(`${line}\n`);
for (const fault of faults) process.stdout.write(`FAULT ${fault}\n`);
process.stdout.write(`${String(faults.length)} faults\n`);
process.exit(faults.length === 0 ? 0 : 1);
