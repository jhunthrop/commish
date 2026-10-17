// Screenshots of the week's game facts (Lane 66a): the expected score and margin, the roof and the
// kickoff weather with their read time, on the waivers and trades rows and a player page as a sentence,
// and on the Lineup and Matchup box scores (Lane 66d) as a cell ("20 to 22.5" and the weather in two or
// three words) with the read said once under the boxes, in both themes at 1440 and 390 on a Central
// clock (on a phone the waiver and trade rows keep to their decision, so they carry none). Each asserts
// what it shows, no betting word, and that nothing scrolls sideways. Against the built site served static and the
// fixture API (scripts/inseason-fixture/serve.ts), whose /games/week answers the recorded week.
//
//   node scripts/game-facts-shots.ts [web origin] [out dir] [player slug]
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
/** A game facts sentence as a row says it. */
const FACTS =
	/(Expected to score \d+(\.5)? and to (win|lose) by \d+(\.5)?|Expected to be a close game), \d+(\.5)? points in the game\./;
const READ = /Read \w{3} \d{1,2}:\d{2} [ap]m\./;
const WEATHER =
	/\d+°F and \d+ mph wind at kickoff, (outdoors|under a retractable roof)\.|Indoors\.|Played abroad, so no forecast\./;
/** A box score's facts cell: the expected score with his club's first, then the weather's words. */
const EXPECTED = /^\d+(\.5)? to \d+(\.5)?$/;
const CELL_WEATHER =
	/^(\d+°, \d+ mph(, \d+% (rain|snow|ice))?|Indoors|Roof TBD|Abroad, no forecast|Outdoors)$/;
const FACTS_READ = /Game facts read \w{3} \d{1,2}:\d{2} [ap]m Central\./;
const BETTING =
	/\b(favou?red|underdogs?|odds|lines?|spreads?|totals?|bets?|betting|vegas|sportsbooks?|props?|moneyline)\b|over\/under/i;

const web = process.argv[2] ?? 'http://localhost:4682';
const out = new URL(process.argv[3] ?? '../screenshots/game-facts/', import.meta.url);
const player = process.argv[4] ?? 'jordan-love';
const id = FIXTURE_IDS.league;
const PAGES = [
	{
		name: 'start',
		path: `/league/${id}/start`,
		ready: 'Set it on Sleeper',
		phone: true,
		box: true
	},
	{
		name: 'waivers',
		path: `/league/${id}/waivers`,
		ready: 'Claim on Sleeper',
		phone: false,
		box: false
	},
	{
		name: 'trades',
		path: `/league/${id}/trades`,
		ready: 'Propose on Sleeper',
		phone: false,
		box: false
	},
	{ name: 'matchup', path: `/league/${id}/matchup`, ready: 'Week 6', phone: true, box: true },
	{ name: 'player', path: `/players/${player}`, ready: 'Week 6:', phone: true, box: false }
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

/** The first visible element holding a game facts sentence, scrolled into view. */
async function factsLine(page: Page): Promise<string | null> {
	const line = page.getByText(FACTS).filter({ visible: true }).first();
	if ((await line.count()) === 0) return null;
	await line.scrollIntoViewIfNeeded();
	return line.innerText();
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
		const rows = [...document.querySelectorAll('main table.box tbody tr')];
		return {
			expected: texts('main table.box .exp'),
			weather: texts('main table.box .wx'),
			text: document.body.innerText,
			stamped: rows.filter((tr) => /\bRead \w{3} /.test(tr.textContent)).length
		};
	});
}

for (const { name, path, ready, phone, box } of PAGES) {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const where = `${name} ${theme} ${String(width)}`;
			const ctx = await context(theme, width);
			const page = await ctx.newPage();
			try {
				await open(page, path, ready);
				if (box) {
					const cells = await boxFacts(page);
					check(cells.expected.length > 0, `${where}: no expected score in a box`);
					for (const e of cells.expected) check(EXPECTED.test(e), `${where}: expected "${e}"`);
					check(cells.weather.length > 0, `${where}: no weather in a box`);
					for (const w of cells.weather) check(CELL_WEATHER.test(w), `${where}: weather "${w}"`);
					check(FACTS_READ.test(cells.text), `${where}: no game facts read line`);
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
					continue;
				}
				const said = await factsLine(page);
				// The waiver and trade rows keep to their decision on a phone, so the first row clears the pin.
				const shown = phone || width !== PHONE_WIDTH;
				check(
					(said !== null) === shown,
					`${where}: ${shown ? 'no game facts sentence' : 'game facts on a phone row'}`
				);
				if (said !== null) {
					check(READ.test(said), `${where}: no read time in "${said}"`);
					check(WEATHER.test(said), `${where}: no roof or weather in "${said}"`);
					check(!BETTING.test(said), `${where}: a betting word in "${said}"`);
				}
				const wide = await page.evaluate(
					() => document.documentElement.scrollWidth > document.documentElement.clientWidth
				);
				check(!wide, `${where}: scrolls sideways`);
				await page.screenshot({
					path: new URL(`${name}-${theme}-${String(width)}.png`, out).pathname
				});
				process.stdout.write(`${where}: ${said ?? 'none'}\n`);
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
