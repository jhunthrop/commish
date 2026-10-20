// Screenshots of the week turn (Lane 95) against the fixture API (scripts/inseason-fixture/serve.ts)
// and the built site, dark at 1280 and 390, on one of two clocks (inseason-fixture/clock.ts):
//   saturday      the fixture's week clock, week 6 still to play: Waivers and Trades say Week 6;
//   monday-night  Monday 11:00 pm Central, every starter of the member's kicked off or final: the
//                 front door's roster facts are for week 7 with no stamp saying "Listed", Waivers and
//                 Trades say Week 7, Trades draws no "This week, Proj" group, and both bases say the
//                 day week 7's published projection arrives.
// Every page: nothing scrolls sideways, and the copy passes the one guard (copy-scan.ts). Exits
// non-zero on any fault.
//
//   CLOCK=saturday|monday-night node scripts/week-turn-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API, started on the same clock
// (FIXTURE_CLOCK).
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { TRADES } from '../src/lib/league/box/trades.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import {
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_WEEK_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';

const CLOCKS = {
	saturday: FIXTURE_WEEK_CLOCK,
	'monday-night': FIXTURE_MONDAY_NIGHT_CLOCK
} as const;
type Day = keyof typeof CLOCKS;
const day = (process.env.CLOCK ?? 'monday-night') as Day;
const turned = day === 'monday-night';
const web = process.argv[2] ?? 'http://localhost:4196';
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8799';
const out = new URL(process.argv[3] ?? `../screenshots/week-turn/${day}/`, import.meta.url);
const WIDTHS = [1280, 390] as const;
const HEIGHTS = { 1280: 900, 390: 844 } as const;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const WEEK = turned ? 'Week 7' : 'Week 6';
const ARRIVES = 'Week 7 projections arrive Thursday.';

await requireFixtureClock(API_ORIGIN, CLOCKS[day]);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

function fault(where: string, what: string): void {
	faults.push(`${where}: ${what}`);
}

async function context(width: 1280 | 390): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: HEIGHTS[width] },
		colorScheme: 'dark',
		deviceScaleFactor: width < 500 ? 2 : 1
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, 'dark'] as const
	);
	return ctx;
}

async function open(page: Page, path: string, text: string): Promise<void> {
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
	await page
		.getByText(text)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
}

async function check(page: Page, where: string): Promise<string> {
	const text = await page.evaluate(() => document.body.innerText);
	const sideways = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	if (sideways > 0) fault(where, `scrolls sideways by ${String(sideways)} px`);
	const copy = await copyFault(page);
	if (copy !== null) fault(where, copy);
	return text;
}

for (const width of WIDTHS) {
	const ctx = await context(width);
	const page = await ctx.newPage();
	const w = String(width);

	await open(page, '/', 'Your roster');
	const front = await check(page, `front ${w}`);
	if (front.includes('Listed ')) fault(`front ${w}`, 'a roster fact says Listed');
	if (turned !== front.includes('for week 7.'))
		fault(`front ${w}`, `the roster head ${turned ? 'is not' : 'is'} for week 7`);
	await page.screenshot({ path: new URL(`front-${w}.png`, out).pathname, fullPage: true });

	await open(page, `/league/${FIXTURE_IDS.league}/waivers`, WEEK);
	const waivers = await check(page, `waivers ${w}`);
	if (turned !== waivers.includes(ARRIVES))
		fault(`waivers ${w}`, `the basis ${turned ? 'does not say' : 'says'} when week 7's arrives`);
	await page.screenshot({ path: new URL(`waivers-${w}.png`, out).pathname, fullPage: true });

	await open(page, `/league/${FIXTURE_IDS.league}/trades`, WEEK);
	const trades = await check(page, `trades ${w}`);
	if (width > 500 && turned === trades.toLowerCase().includes(TRADES.weekHead.toLowerCase()))
		fault(`trades ${w}`, `the week's Proj group ${turned ? 'is' : 'is not'} drawn`);
	if (turned !== trades.includes(ARRIVES))
		fault(`trades ${w}`, `the basis ${turned ? 'does not say' : 'says'} when week 7's arrives`);
	await page.screenshot({ path: new URL(`trades-${w}.png`, out).pathname, fullPage: true });
	await ctx.close();
}

await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`week turn shots (${day}) in ${out.pathname}\n`);
