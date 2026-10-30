// Screenshots of the Waivers screen centred on its position cards (Lane 305) against the fixture API
// on the fixture week's clock and the built site: light and dark at 1280 by 800 and 390 by 844,
// light at 1024 by 768. Each shoots the landing, QB chosen, This week and D/ST. Checks: nothing scrolls
// sideways, the copy passes the one guard (copy-scan.ts), the cards lead with All and every card says
// a rank, a count or what it waits on (never a bare "--"), the screen opens on the weakest Need with
// its comparison (the member's players over the free agents, Add on the free agents), the chosen card
// is pressed and in view on a phone (one row of cards), a card chooses its position, the toggle changes
// the cards, and the strip's pickup at the chosen position marks its row. Prints the taps from landing
// to an add. Then (review 305 H2) the answer a minute later holds a free agent at the chosen position on
// the member's roster, claimed since: the list reads again and lists him as the member's alone. On a
// phone the row shows a part of a card at its edge (it scrolls), the lead gives way to the chosen card
// (drawn on All), the rank's meaning is said under the cards and the comparison's first row starts
// above the pinned verb (M3, M5, round 2 N2 and N3). A minute's read whose position top-up fails keeps
// the list and the open Add and says nothing (round 2 N1).
//
//   node scripts/waiver-nav-shots.ts [web origin] [out dir, from scripts/]
// with the site built against PUBLIC_API_URL at the fixture API (API_ORIGIN, default 8799), started
// with FIXTURE_CLOCK on the fixture week's clock.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';
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
	/** Cut by the row's left or right edge: a phone's row says it scrolls. */
	partial: boolean;
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
				inView: box !== undefined && r.left >= box.left - 1 && r.right <= box.right + 1,
				partial:
					box !== undefined &&
					((r.left < box.left - 1 && r.right > box.left + 1) ||
						(r.left < box.right - 1 && r.right > box.right + 1))
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

/** Whether the lead over the comparison is drawn. */
function leadShown(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const lead = document.querySelector<HTMLElement>('[data-lead]');
		return lead !== null && lead.offsetParent !== null;
	});
}

/** On a phone: whether the rank's meaning is said under the cards, and where the comparison's first
 * row starts and ends against the pinned verb's top. */
function phoneFold(
	page: Page
): Promise<{ explained: boolean; rowTop: number; rowBottom: number; pinTop: number }> {
	return page.evaluate(() => {
		const under = document.querySelector<HTMLElement>('[data-nav="positions"] .explain.under');
		const row = document
			.querySelector('table.pool tbody.yours tr, table.pool tbody:not(.yours) tr[data-player]')
			?.getBoundingClientRect();
		const pin = [...document.querySelectorAll<HTMLElement>('.pin')]
			.find((p) => p.offsetParent !== null)
			?.getBoundingClientRect();
		return {
			explained: under !== null && under.offsetParent !== null && under.innerText.trim() !== '',
			rowTop: row?.top ?? Infinity,
			rowBottom: row?.bottom ?? Infinity,
			pinTop: pin?.top ?? innerHeight
		};
	});
}

interface Line {
	player: { host_id: string; board_id: string; position: string };
}
interface Answer {
	rows: { add: Line }[];
	stash?: { add: Line }[];
	roster: Line[];
	positions?: { position: string; mine: unknown[] }[];
}

/** The answer as if the member had claimed `boardId` since: off the free agents, on his roster and on
 * his card's players. */
function claimed(answer: Answer, boardId: string): Answer {
	const his = answer.rows.find((r) => r.add.player.board_id === boardId)?.add;
	if (his === undefined) return answer;
	const free = (r: { add: Line }): boolean => r.add.player.board_id !== boardId;
	return {
		...answer,
		rows: answer.rows.filter(free),
		stash: answer.stash?.filter(free),
		roster: [...answer.roster, his],
		positions: answer.positions?.map((c) =>
			c.position === his.player.position
				? {
						...c,
						mine: [
							...c.mine,
							{
								line: his,
								starter: false,
								starts_this_week: false,
								rest_of_season_points: null
							}
						]
					}
				: c
		)
	};
}

/** Round 2 N1: the minute's read brings a new answer but the chosen position's own read fails. The
 * position's list stays as it was, the open Add stays open with its verb, and no line is said. */
async function failedTopUp(page: Page, where: string): Promise<void> {
	const before = await comparison(page);
	let failed = 0;
	let markFailed: () => void = () => undefined;
	const failedOnce = new Promise<void>((resolve) => {
		markFailed = resolve;
	});
	const answers = '**/leagues/attached/*/waivers*';
	const fail = async (route: Route): Promise<void> => {
		if (new URL(route.request().url()).searchParams.has('position')) {
			failed += 1;
			markFailed();
			await route.fulfill({ status: 500, json: { ok: false, data: null, error: null } });
			return;
		}
		// A new read of the league, so the page tops the position up.
		const response = await route.fetch();
		const body = (await response.json()) as { data: { read_at: string } | null };
		const data =
			body.data === null
				? null
				: { ...body.data, read_at: new Date(Date.parse(body.data.read_at) + 1000).toISOString() };
		await route.fulfill({ response, json: { ...body, data } });
	};
	await page.route(answers, fail);
	await page.clock.fastForward(60_000);
	await page
		.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, null, {
			timeout: READY_TIMEOUT_MS
		})
		.catch(() => undefined);
	await Promise.race([failedOnce, page.waitForTimeout(READY_TIMEOUT_MS)]);
	await page.waitForTimeout(300);
	if (failed === 0) fault(where, 'the minute read no position top-up to fail');
	const after = await comparison(page);
	if (after.free !== before.free)
		fault(
			where,
			`a failed top-up changed the list from ${String(before.free)} to ${String(after.free)}`
		);
	if ((await page.locator('table.pool .go button').count()) === 0)
		fault(where, 'a failed top-up closed the open Add');
	if ((await page.locator('main p[role="alert"]').count()) > 0)
		fault(where, 'a failed top-up said a line over a list it kept');
	await page.unrouteAll({ behavior: 'wait' });
}

/** H2: a free agent at the chosen position claimed since; the minute's read (the page's clock moved a
 * minute on) brings an answer with him on the roster, and the chosen position's list reads again. */
async function claimedSince(page: Page, where: string): Promise<void> {
	const id = await page
		.locator('table.pool tbody:not(.yours) tr[data-player]')
		.first()
		.getAttribute('data-player');
	if (id === null) {
		fault(where, 'no free agent to claim');
		return;
	}
	const answers = '**/leagues/attached/*/waivers*';
	const swap = async (route: Route): Promise<void> => {
		const response = await route.fetch();
		const body = (await response.json()) as { data: Answer | null };
		const data = body.data === null ? null : claimed(body.data, id);
		await route.fulfill({ response, json: { ...body, data } });
	};
	await page.route(answers, swap);
	await page.clock.fastForward(60_000);
	const settled = await page
		.waitForFunction(
			(player) => {
				const mine = document.querySelector(`table.pool tbody.yours tr[data-player="${player}"]`);
				const free = document.querySelector(
					`table.pool tbody:not(.yours) tr[data-player="${player}"]`
				);
				return mine !== null && free === null;
			},
			id,
			{ timeout: READY_TIMEOUT_MS }
		)
		.then(
			() => true,
			() => false
		);
	if (!settled) fault(where, `the claimed ${id} is not his alone after the minute's read`);
	await page.unrouteAll({ behavior: 'wait' });
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
		if (c.text.includes('--')) fault(where, `a card prints "--": ${c.text.replace(/\n/g, ' ')}`);
	}
	if (width === 390 && !cards.some((c) => c.partial)) {
		fault(where, 'no card shows in part at the row edge, so nothing says the row scrolls');
	}
	if (width === 390) {
		const phone = await phoneFold(page);
		// A position's card is the head on a phone: the lead gives way to it (round 2 N3).
		if (await leadShown(page)) fault(where, 'the lead repeats the chosen card on a phone');
		if (!phone.explained) fault(where, "the rank's meaning is said nowhere on a phone");
		// The comparison starts above the pinned verb: its first row begins in view at landing.
		if (phone.rowTop > phone.pinTop) {
			fault(
				where,
				`the comparison's first row starts ${phone.rowTop.toFixed(0)} px, under the pin at ${phone.pinTop.toFixed(0)} px`
			);
		}
		process.stdout.write(
			`${where}: comparison's first row ${phone.rowTop.toFixed(0)}-${phone.rowBottom.toFixed(0)} px, pin at ${phone.pinTop.toFixed(0)} px\n`
		);
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
	await failedTopUp(page, where);
	await claimedSince(page, where);
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
	if (!(await leadShown(page))) fault(where, "All's lead is not drawn");
	await shoot(page, `after-${tag}-all`);
	process.stdout.write(
		`${where}: opens on ${opened?.key ?? '-'}, ${String(landed.yours)} yours, ${String(landed.free)} free; taps to an add: strip 1, opening position 2 (${LINES.add}, verb), another position 3\n`
	);
	await ctx.close();
}
await browser.close();
for (const f of faults) process.stderr.write(`FAULT ${f}\n`);
process.exit(faults.length > 0 ? 1 : 0);
