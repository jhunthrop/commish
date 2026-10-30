// Screenshots of the Waivers screen centred on its position cards (Lane 305) against the fixture API
// on the fixture week's clock and the built site: light and dark at 1280 by 800 and 390 by 844,
// light at 1024 by 768. Each shoots the landing, QB chosen, This week and D/ST. Checks: nothing scrolls
// sideways, the copy passes the one guard (copy-scan.ts), the cards lead with All and every card says
// a rank, a count or what it waits on (never a bare "--"), the screen opens on the weakest Need with
// its comparison (the member's players over the free agents, Add on the free agents), the chosen card
// is pressed and in view on a phone (one row of cards), a card chooses its position, the toggle changes
// the cards, and the strip's pickup at the chosen position marks its row. Prints the taps from landing
// to an add.
//
//   node scripts/waiver-nav-shots.ts [web origin] [out dir, from scripts/]
// with the site built against PUBLIC_API_URL at the fixture API (API_ORIGIN, default 8799), started
// with FIXTURE_CLOCK on the fixture week's clock.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { PANEL } from '../src/lib/league/box/positions.ts';
import { LINES } from '../src/lib/league/inseason/words.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import {
	FIXTURE_WEEK_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';

type Theme = 'light' | 'dark';
type Width = 1280 | 1024 | 390;
const web = process.argv[2] ?? 'http://localhost:4196';
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8799';
const out = new URL(process.argv[3] ?? '../screenshots/waiver-nav/', import.meta.url);
const SHOTS: readonly (readonly [Theme, Width])[] = [
	['light', 1280],
	['dark', 1280],
	['light', 1024],
	['light', 390],
	['dark', 390]
];
const HEIGHTS = { 1280: 800, 1024: 768, 390: 844 } as const;
/** The fixture league's weakest Need (TE rank 9 of 12 against QB's 8). */
const OPENS_ON = 'TE';
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const LEAGUE = `/league/${FIXTURE_IDS.league}`;
const NAV = '[data-nav="positions"]';

await requireFixtureClock(API_ORIGIN, FIXTURE_WEEK_CLOCK);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

function fault(where: string, what: string): void {
	faults.push(`${where}: ${what}`);
}

async function context(theme: Theme, width: Width): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: HEIGHTS[width] },
		colorScheme: theme,
		deviceScaleFactor: width < 500 ? 2 : 1
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function check(page: Page, where: string): Promise<void> {
	const sideways = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	if (sideways > 0) fault(where, `scrolls sideways by ${String(sideways)} px`);
	const copy = await copyFault(page);
	if (copy !== null) fault(where, copy);
}

interface CardSeen {
	key: string;
	text: string;
	top: number;
	pressed: boolean;
	inView: boolean;
}

function cardsSeen(page: Page): Promise<CardSeen[]> {
	return page.evaluate((nav) => {
		const row = document.querySelector(`${nav} .cards`);
		const box = row?.getBoundingClientRect();
		return [...document.querySelectorAll(`${nav} [data-card]`)].map((c) => {
			const r = c.getBoundingClientRect();
			return {
				key: (c as HTMLElement).dataset.card ?? '',
				text: (c as HTMLElement).innerText,
				top: Math.round(r.top),
				pressed: c.getAttribute('aria-pressed') === 'true',
				inView: box !== undefined && r.left >= box.left - 1 && r.right <= box.right + 1
			};
		});
	}, NAV);
}

/** The comparison's groups: the member's rows and the free agents' rows with an Add. */
function comparison(page: Page): Promise<{ yours: number; free: number; named: number }> {
	return page.evaluate(() => {
		const table = document.querySelector('table.pool');
		return {
			yours: table?.querySelectorAll('tbody.yours tr').length ?? 0,
			free: [...(table?.querySelectorAll('tbody:not(.yours):not(.panel) button.add') ?? [])].length,
			// The strip's pickups are tinted in BoxLine's moved-in mark (its `marked` prop).
			named: table?.querySelectorAll('tbody:not(.yours) tr.moved-in').length ?? 0
		};
	});
}

async function settle(page: Page): Promise<void> {
	await page.locator(`table.pool .rows, table.pool`).first().waitFor({ timeout: READY_TIMEOUT_MS });
	await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, null, {
		timeout: READY_TIMEOUT_MS
	});
}

async function shoot(page: Page, name: string): Promise<void> {
	// The pointer off the cards and their 120 ms change settled, so a shot shows rest, not hover.
	await page.mouse.move(0, 0);
	await page.waitForTimeout(200);
	await page.screenshot({ path: new URL(`${name}.png`, out).pathname });
}

for (const [theme, width] of SHOTS) {
	const ctx = await context(theme, width);
	const page = await ctx.newPage();
	const where = `waivers ${theme} ${String(width)}`;
	const tag = `${theme}-${String(width)}`;
	await page.goto(`${web}${LEAGUE}/waivers`, { waitUntil: 'networkidle' });
	await settle(page);
	await page.evaluate(() => document.fonts.ready);
	await check(page, where);
	await shoot(page, `after-${tag}`);
	const cards = await cardsSeen(page);
	if (cards[0]?.key !== 'ALL') fault(where, 'the cards do not lead with All');
	for (const c of cards) {
		if (!/rank \d+ of \d+|free agents|Ranks once/i.test(c.text)) {
			fault(where, `a card without its rank, count or wait: ${c.text.replace(/\n/g, ' ')}`);
		}
	}
	const opened = cards.find((c) => c.pressed);
	if (opened?.key !== OPENS_ON)
		fault(where, `opens on ${opened?.key ?? 'nothing'}, not ${OPENS_ON}`);
	if (opened !== undefined && !opened.inView) fault(where, 'the chosen card is out of view');
	if (width === 390 && new Set(cards.map((c) => c.top)).size > 1) {
		fault(where, 'the cards are more than one row');
	}
	const landed = await comparison(page);
	if (landed.yours === 0) fault(where, "the comparison has none of the member's players");
	if (landed.free === 0) fault(where, 'the comparison has no free agent with Add');
	if (landed.named === 0) fault(where, "the strip's pickup at the chosen position is not marked");
	// The QB card: one tap to the position, its free agents with Add.
	await page.locator(`${NAV} [data-card="QB"]`).click();
	await settle(page);
	const qb = await comparison(page);
	const qbPressed = (await cardsSeen(page)).find((c) => c.pressed)?.key;
	if (qbPressed !== 'QB') fault(where, 'the QB card did not choose QB');
	if (qb.yours === 0 || qb.free === 0) fault(where, 'QB lists no comparison');
	await check(page, `${where} QB`);
	await shoot(page, `after-${tag}-qb`);
	// The taps from landing to an add at QB: the card, the row's Add (its drops), the verb.
	await page.locator('table.pool tbody:not(.yours) button.add').first().click();
	const verb = page.locator('table.pool .go button');
	if ((await verb.count()) === 0) fault(where, 'the Add opened no verb');
	await shoot(page, `after-${tag}-qb-add`);
	await page.locator(`${NAV} [data-card="DEF"]`).click();
	await settle(page);
	await check(page, `${where} D/ST`);
	await shoot(page, `after-${tag}-dst`);
	const seasonText = (await cardsSeen(page)).map((c) => c.text).join('|');
	await page.locator(NAV).getByRole('button', { name: PANEL.week, exact: true }).click();
	const weekText = (await cardsSeen(page)).map((c) => c.text).join('|');
	if (weekText === seasonText) fault(where, 'This week leaves the cards as they were');
	await check(page, `${where} week`);
	await shoot(page, `after-${tag}-week`);
	await page.locator(`${NAV} [data-card="ALL"]`).click();
	await settle(page);
	if ((await comparison(page)).yours !== 0) fault(where, "All lists the member's players");
	await shoot(page, `after-${tag}-all`);
	process.stdout.write(
		`${where}: opens on ${opened?.key ?? '-'}, ${String(landed.yours)} yours, ${String(landed.free)} free; taps to an add: strip 1, opening position 2 (${LINES.add}, verb), another position 3\n`
	);
	await ctx.close();
}
await browser.close();
for (const f of faults) process.stderr.write(`FAULT ${f}\n`);
process.exit(faults.length > 0 ? 1 : 0);
