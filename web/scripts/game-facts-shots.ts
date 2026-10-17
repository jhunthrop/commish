// Screenshots of the week's game facts (Lane 66a): the expected score and margin, the roof and the
// kickoff weather with their read time, on the pickup table (Lane 66f) and an opened trade of the
// Trades table (Lane 66g) as a cell, and on the Lineup and Matchup box scores (Lane 66d) as a cell ("20 to 22.5" and the weather in two or
// three words) with the read said once under the boxes, in both themes at 1440 and 390 on a Central
// clock (on a phone the waiver and trade rows keep to their decision, so they carry none). Each asserts
// what it shows, no betting word, and that nothing scrolls sideways. Against the built site served static and the
// fixture API (scripts/inseason-fixture/serve.ts), whose /games/week answers the recorded week.
//
//   node scripts/game-facts-shots.ts [web origin] [out dir]
// The player card's Game cell is player-card-shots.ts's (Lane 66h).
// with the site built against PUBLIC_API_URL pointing at the fixture API.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const THEMES = ['light', 'dark'] as const;
const PHONE_WIDTH = 390;
const WIDTHS = [1440, PHONE_WIDTH] as const;
const VIEWPORT_HEIGHT = 900;
const ZONE = 'America/Chicago';
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
/** A box score's facts cell: the expected score with his club's first, then the weather's words. */
const EXPECTED = /^\d+(\.5)? to \d+(\.5)?$/;
const CELL_WEATHER =
	/^(\d+°, \d+ mph(, \d+% (rain|snow|ice))?|Indoors|Roof TBD|Abroad, no forecast|Outdoors)$/;
const FACTS_READ =
	/The Game cell(?: shows each club's expected points, his club first, then the kickoff weather, read|'s expected points and weather were read) \w{3} \d{1,2}:\d{2} [ap]m Central\./g;
const BETTING =
	/\b(favou?red|underdogs?|odds|lines?|spreads?|totals?|bets?|betting|vegas|sportsbooks?|props?|moneyline)\b|over\/under/i;

const web = process.argv[2] ?? 'http://localhost:4682';
const out = new URL(process.argv[3] ?? '../screenshots/game-facts/', import.meta.url);
const id = FIXTURE_IDS.league;
const PAGES = [
	{
		name: 'start',
		path: `/league/${id}/start`,
		ready: 'Copy the lineup',
		phone: true
	},
	{
		name: 'waivers',
		path: `/league/${id}/waivers`,
		ready: 'Open Sleeper waivers',
		// The pickup table is a box score too (Lane 66f): its Game cells and one read line.
		phone: true
	},
	{
		name: 'trades',
		path: `/league/${id}/trades`,
		ready: 'worth proposing',
		phone: false
	},
	{ name: 'matchup', path: `/league/${id}/matchup`, ready: 'Week 6', phone: true }
] as const;
const failures: string[] = [];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		timezoneId: ZONE
	});
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	// No live provider: faces come from the headshot route, left unanswered here.
	await ctx.route('**/img/**', (route) => route.abort());
	return ctx;
}

function check(ok: boolean, what: string): void {
	if (!ok) failures.push(what);
}

async function open(page: Page, path: string, text: string): Promise<void> {
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
	await page
		.getByText(text)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

/** A box score's facts: every visible row's expected score and weather words, and the screen's text
 * for its one read line, and any row that still carries a read stamp. */
async function boxFacts(
	page: Page
): Promise<{ expected: string[]; weather: string[]; text: string; stamped: number }> {
	return page.evaluate(() => {
		const visible = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
		const texts = (selector: string): string[] =>
			[...document.querySelectorAll(selector)]
				.filter(visible)
				.map((el) => (el as HTMLElement).innerText.trim());
		const rows = [
			...document.querySelectorAll(
				'main table.box tbody tr, main table.lineup tbody tr, main table.pool tbody tr, main table.inner tbody tr'
			)
		];
		return {
			expected: texts(
				'main table.box .exp, main table.lineup .exp, main table.pool .exp, main table.inner .exp'
			),
			weather: texts(
				'main table.box .wx, main table.lineup .wx, main table.pool .wx, main table.inner .wx'
			),
			text: document.body.innerText,
			stamped: rows.filter((tr) => /\bRead \w{3} /.test(tr.textContent)).length
		};
	});
}

for (const { name, path, ready, phone } of PAGES) {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const where = `${name} ${theme} ${String(width)}`;
			const ctx = await context(theme, width);
			const page = await ctx.newPage();
			try {
				await open(page, path, ready);
				// The Trades table shows its game cells in an opened trade (Lane 66g).
				if (name === 'trades') await page.locator('table.finder button.why').first().click();
				{
					const cells = await boxFacts(page);
					// The opened trade's rows keep to the opponent and kickoff on a phone (Lane 66g).
					const cellsShown = phone || width !== PHONE_WIDTH;
					check(
						cells.expected.length > 0 === cellsShown,
						`${where}: ${cellsShown ? 'no expected score in a box' : 'game cells on a phone'}`
					);
					for (const e of cells.expected) check(EXPECTED.test(e), `${where}: expected "${e}"`);
					check(cells.weather.length > 0 === cellsShown, `${where}: weather in a box`);
					for (const w of cells.weather) check(CELL_WEATHER.test(w), `${where}: weather "${w}"`);
					const read = (cells.text.match(FACTS_READ) ?? []).length;
					check(read === 1, `${where}: the Game cell's line said ${String(read)} times`);
					check(cells.stamped === 0, `${where}: ${String(cells.stamped)} rows carry a read stamp`);
					for (const said of [...cells.expected, ...cells.weather]) {
						check(!BETTING.test(said), `${where}: a betting word in "${said}"`);
					}
					const sideways = await page.evaluate(
						() => document.documentElement.scrollWidth > document.documentElement.clientWidth
					);
					check(!sideways, `${where}: scrolls sideways`);
					await page.screenshot({
						path: new URL(`${name}-${theme}-${String(width)}.png`, out).pathname
					});
					process.stdout.write(
						`${where}: ${cells.expected[0] ?? 'none'} | ${cells.weather[0] ?? 'none'}\n`
					);
				}
			} catch (error: unknown) {
				failures.push(`${where}: ${String(error)}`);
			} finally {
				await ctx.close();
			}
		}
	}
}

await browser.close();
for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
process.stdout.write(`${String(failures.length)} failures\n`);
process.exit(failures.length === 0 ? 0 : 1);
