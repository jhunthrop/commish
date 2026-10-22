// Screenshots of the board row as a box score (Lane 66n): the front door, the board (All, WR and K),
// ADP, a club, Compare and the schedule, in both themes at 1440 and 390, with what each must hold
// asserted at every width:
// - no page scrolls sideways (1440, 1024, 768 and 390), and no row's last cell runs past the row;
// - the basis is at most five rendered lines (the schedule's lead two on a desk; the in-season order
//   and the K tab's week eight on a phone);
// - a row's name is set larger than its figures but Projected, its biggest, at the name's size (B46),
//   the Gap head names its sum, a plus gap is green and
//   a minus gap rose, on the rows and on Compare;
// - in season the board is the order's (review 66n finding 3): built with the order's first line and
//   no run row, so the page before the script and the order after it never disagree;
// - the status chip is styled from the first paint, script off (review 66n finding 1);
// - Compare's head cell makes the call;
// - the copy passes the one guard (no em-dash, semicolon, betting, trading or platform word, "totals"
//   among them), the names and rows the run and the API handed the page skipped (copy-scan.ts);
// - the Floor to ceiling column is drawn only where a row carries a range.
// Exits non-zero on a miss. Against the built site served by serve-built.ts, built with
// PUBLIC_API_URL at the fixture API (scripts/inseason-fixture/serve.ts) so the order reads:
//   node scripts/board-row-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { copyFault, watchData } from './copy-scan.ts';
import { ORDER } from '../src/lib/order/words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { installFixtureApiClock, requireFixtureClock } from './inseason-fixture/clock.ts';

const THEMES = ['dark', 'light'] as const;
/** Shot widths, and the widths only checked for a sideways scroll. */
const SHOT_WIDTHS = [1440, 390] as const;
const CHECK_WIDTHS = [1024, 768] as const;
const VIEWPORT_HEIGHT = 900;
const PHONE_MAX = 760;
const MAX_BASIS_LINES = 5;
/** The in-season order's basis (Lane 66q): five lines at a desk, eight on a phone. */
const MAX_ORDER_BASIS_LINES = { desk: 5, phone: 8 } as const;
const MAX_SCHEDULE_DESK_LINES = 2;
/** The board row's figure size at its largest (--t-row-num on a desk, 17px). */
const ROW_FIGURE_MAX_PX = 17;
const GAP_TITLE = "Gap, drafters' ADP less our rank";
/** Shooting a run older than the Gap column (EXPECT_GAP=none): every check that the Gap is drawn turns
 * into a check that it is not. */
const GAPLESS = process.env.EXPECT_GAP === 'none';
/** A computed background that paints nothing. */
const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\))$/u;

/** What a page shows, and so what is checked on it. */
type Kind = 'rows' | 'order' | 'draft-order' | 'compare' | 'schedule';

interface Shot {
	name: string;
	path: string;
	kind: Kind;
}

const SHOTS: readonly Shot[] = [
	{ name: 'front', path: '/', kind: 'rows' },
	{ name: 'board-all', path: '/board/ppr-12', kind: 'order' },
	{ name: 'board-wr', path: '/board/ppr-12/wr', kind: 'order' },
	{ name: 'board-k', path: '/board/ppr-12/k', kind: 'draft-order' },
	{ name: 'adp', path: '/adp/ppr-12', kind: 'rows' },
	{ name: 'club-dal', path: '/clubs/dal', kind: 'rows' },
	{ name: 'compare', path: '/compare?a=puka-nacua&b=ja-marr-chase', kind: 'compare' },
	{ name: 'schedule', path: '/schedule', kind: 'schedule' }
];

const web = process.argv[2] ?? 'http://localhost:4173';
/** The fixture API the site was built against, on the fixture week's clock (FIXTURE_CLOCK=
 * 2026-10-17T17:00:00.000Z): the browser runs at its instant, never the day the script runs. */
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);
/** The dev server (npm run dev), where the dev-only system page draws the tier band. */
const DEV_ORIGIN = process.env.DEV_ORIGIN;
const NOT_FOUND = 404;
const out = new URL(process.argv[3] ?? '../screenshots/board-row/', import.meta.url);
const failures: string[] = [];

function fail(tag: string, what: string): void {
	failures.push(`${tag}: ${what}`);
}

/** How many lines an element renders, from its height and its line height. */
async function renderedLines(page: Page, selector: string): Promise<number | null> {
	return page.evaluate((query) => {
		const el = document.querySelector(query);
		if (!el) return null;
		const style = getComputedStyle(el);
		const visible = [...el.childNodes].length > 0 && el.getBoundingClientRect().height > 0;
		return visible
			? Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight))
			: 0;
	}, selector);
}

/** Every signed gap on the page in its tone: plus green, minus rose. */
async function checkGapTones(page: Page, tag: string, selector: string): Promise<void> {
	const tones = await page.evaluate(
		(query) =>
			[...document.querySelectorAll(query)].map((el) => ({
				text: el.textContent.trim(),
				gain: el.classList.contains('gain'),
				loss: el.classList.contains('loss')
			})),
		selector
	);
	for (const tone of tones) {
		if (tone.text.startsWith('+') && !tone.gain) fail(tag, `plus gap ${tone.text} not green`);
		if (tone.text.startsWith('−') && !tone.loss) fail(tag, `minus gap ${tone.text} not rose`);
	}
}

/** A run that carries no Gap draws none (re-review N1): no column, no sort, no Compare row and no
 * sentence about its colours. */
async function checkNoGap(page: Page, tag: string): Promise<void> {
	const drawn = await page.locator('.c-gap, .cmp tr[data-row="Gap"]').count();
	if (drawn > 0) fail(tag, `a run with no gap draws ${String(drawn)} Gap cells`);
	const basis = (await page.locator('.basis').allInnerTexts()).join(' ');
	if (basis.includes(GAP_TITLE)) fail(tag, 'a run with no gap says the Gap sentence');
}

async function checkRows(page: Page, tag: string): Promise<void> {
	// Projected is the row's biggest figure, set at the name's size (B46, 8fbac850); every other
	// figure sits under the name.
	const sizes = await page.evaluate(() => {
		const row = document.querySelector('.row');
		const name = row?.querySelector('.name');
		const size = (el: Element): number => parseFloat(getComputedStyle(el).fontSize);
		const figures = [...(row?.querySelectorAll('.n:not(.rk):not(.c-proj)') ?? [])].map(size);
		const proj = row?.querySelector('.n.c-proj');
		return name && figures.length > 0
			? { name: size(name), figure: Math.max(...figures), proj: proj ? size(proj) : null }
			: null;
	});
	if (!sizes) fail(tag, 'no board row with a name and a figure');
	else {
		if (sizes.name <= sizes.figure)
			fail(tag, `name ${String(sizes.name)}px not above figure ${String(sizes.figure)}px`);
		if (sizes.proj !== null && (sizes.proj > sizes.name || sizes.proj <= sizes.figure))
			fail(
				tag,
				`Projected ${String(sizes.proj)}px is not the biggest figure at most the name's ${String(sizes.name)}px`
			);
	}
	if (GAPLESS) {
		await checkNoGap(page, tag);
	} else {
		const gapTitle = await page.locator('.h.c-gap [title]').first().getAttribute('title');
		if (gapTitle !== GAP_TITLE) fail(tag, `Gap head title ${String(gapTitle)}`);
		await checkGapTones(page, tag, '.c-gap.n');
	}
	const overrun = await page.evaluate(() =>
		[...document.querySelectorAll('.row')].some((row) => {
			const cells = [...row.children].filter((cell) => cell.getBoundingClientRect().width > 0);
			const last = cells.at(-1);
			return (
				last !== undefined &&
				last.getBoundingClientRect().right > row.getBoundingClientRect().right + 1
			);
		})
	);
	if (overrun) fail(tag, "a row's last cell runs past the row");
}

async function checkPage(page: Page, shot: Shot, tag: string, width: number): Promise<void> {
	const words = await page.locator('main').innerText();
	// The one guard on the copy, the names and rows the run and the API handed the page skipped
	// ("Jadarian Price", "Las Vegas Raiders" are theirs, not copy; ruling R3).
	const banned = await copyFault(page);
	if (banned !== null) fail(tag, `rendered "${banned}"`);
	if (shot.kind === 'rows') {
		// The Floor to ceiling column is drawn only where a row carries a range (Lane 66x).
		const range = await page.evaluate(() => ({
			head: document.querySelectorAll('main .head .c-range').length,
			bars: document.querySelectorAll('main .c-range .inline').length
		}));
		if (range.head > 0 && range.bars === 0) fail(tag, 'Floor to ceiling heads a column no row has');
	}
	if (shot.kind === 'schedule') {
		const lines = await renderedLines(page, 'main .head p');
		if (lines === null || (width > PHONE_MAX && lines > MAX_SCHEDULE_DESK_LINES))
			fail(tag, `schedule lead ${String(lines)} lines`);
		if (!words.includes('expected wins')) fail(tag, 'the lead names no expected wins');
		return;
	}
	// The in-season board is the order, whose basis is its own paragraph (Lane 66q turned its check on).
	const lines = await renderedLines(page, shot.kind === 'order' ? 'main [data-basis] p' : '.basis');
	// In season the K tab is the week's kickers (Lane 66w), an in-season screen with the order's
	// budget: five lines at a desk, eight on a phone.
	const inSeason = shot.kind === 'order' || shot.kind === 'draft-order';
	const most = !inSeason
		? MAX_BASIS_LINES
		: width > PHONE_MAX
			? MAX_ORDER_BASIS_LINES.desk
			: MAX_ORDER_BASIS_LINES.phone;
	if (lines === null || lines === 0) fail(tag, 'no basis');
	else if (lines > most) fail(tag, `basis ${String(lines)} lines`);
	process.stdout.write(`${tag} basis ${String(lines)} lines\n`);
	if (shot.kind === 'rows') await checkRows(page, tag);
	if (shot.kind === 'compare') {
		const call = await page.locator('.call-words').first().innerText();
		if (!/^we would take nacua$/iu.test(call.trim())) fail(tag, `call "${call}"`);
		if ((await page.locator('.evidence').count()) !== 1) fail(tag, 'no single evidence line');
		if (GAPLESS) await checkNoGap(page, tag);
		else await checkGapTones(page, tag, '.cmp tr[data-row="Gap"] td');
	}
}

/** The prerendered page, script off: the in-season board carries the order's first line and no run
 * row, and a page with a listed player paints his chip styled. */
/** The pages pictured as they paint before any script: the chip styled on ADP (review 66n finding 1)
 * and the in-season board's one line (re-review N3). */
const PICTURED_SCRIPT_OFF: ReadonlySet<string> = new Set(['adp', 'board-all']);

/** The prerendered page, script off: the in-season board says only that the order needs JavaScript
 * and carries no run row, and a page with a listed player paints his chip styled. */
async function checkPrerendered(page: Page, shot: Shot, tag: string, file: string): Promise<void> {
	await page.goto(`${web}${shot.path}`, { waitUntil: 'networkidle' });
	if (shot.kind === 'order') {
		const rows = await page.locator('.row').count();
		const text = await page.locator('main').innerText();
		if (rows > 0) fail(tag, `the in-season board was built with ${String(rows)} run rows`);
		if (!text.includes(ORDER.needsScript))
			fail(tag, 'the in-season board does not say it needs JavaScript');
		if (text.includes(ORDER.reading))
			fail(tag, 'the in-season board says it is reading, with no script to read');
	}
	if (shot.kind === 'rows') {
		const chip = page.locator('.status-chip').first();
		if ((await chip.count()) > 0) {
			const paint = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
			if (TRANSPARENT.test(paint)) fail(tag, 'the status chip paints unstyled with script off');
		}
	}
	if (PICTURED_SCRIPT_OFF.has(shot.name)) await page.screenshot({ path: file });
}

/** The tier band (TierStrip) as the system page draws it: one row tall, its drop at a figure's size
 * (review 66n finding 5). In season the board's position views are the order, so no board draws it.
 * The system page is dev-only (ruling R4): the built site answers 404 there, checked here, and the
 * band is shot from the dev server at DEV_ORIGIN when one is given. */
async function shootTierStrip(page: Page, tag: string, file: string): Promise<void> {
	const built = await page.request.get(`${web}/system`);
	if (built.status() !== NOT_FOUND)
		fail(tag, `the built site serves /system (${String(built.status())})`);
	if (DEV_ORIGIN === undefined) {
		process.stdout.write(`${tag}: no DEV_ORIGIN, the tier band is not shot\n`);
		return;
	}
	await page.goto(`${DEV_ORIGIN}/system`, { waitUntil: 'networkidle' });
	const band = page.locator('.band').first();
	if ((await band.count()) === 0) {
		fail(tag, 'the system page draws no tier band');
		return;
	}
	// The specimen frame holds its parts at 520px and scrolls sideways on a phone; the band is laid
	// out at the page's own width here, as a board's position view draws it.
	await band.evaluate((el) => {
		const frame = el.closest('.inner');
		if (frame instanceof HTMLElement) frame.style.minWidth = '0';
	});
	const sizes = await band.evaluate((el) => {
		const drop = el.querySelector('.cliff b');
		return {
			height: el.getBoundingClientRect().height,
			drop: drop ? parseFloat(getComputedStyle(drop).fontSize) : 0
		};
	});
	if (sizes.drop > ROW_FIGURE_MAX_PX) fail(tag, `the band's drop is ${String(sizes.drop)}px`);
	await band.screenshot({ path: file });
}

async function contextFor(
	browser: Browser,
	theme: string,
	width: number,
	script: boolean
): Promise<BrowserContext> {
	const context = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: width <= PHONE_MAX ? 2 : 1,
		javaScriptEnabled: script
	});
	watchData(context);
	await installFixtureApiClock(context, API_ORIGIN);
	await context.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return context;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
	for (const theme of THEMES) {
		for (const width of [...SHOT_WIDTHS, ...CHECK_WIDTHS]) {
			const scripted = await contextFor(browser, theme, width, true);
			const prerendered = await contextFor(browser, theme, width, false);
			const page = await scripted.newPage();
			const bare = await prerendered.newPage();
			for (const shot of SHOTS) {
				const tag = `${shot.name} ${theme} ${String(width)}`;
				await page.goto(`${web}${shot.path}`, { waitUntil: 'networkidle' });
				await page.evaluate(() => document.fonts.ready);
				if (shot.kind === 'compare') await page.locator('.cmp').waitFor();
				if (shot.kind === 'order') await page.locator('table.order').waitFor();
				// The order's chip says a season-long status's start from the API's since (re-review N7).
				if (
					shot.name === 'board-all' &&
					!(await page.locator('main').innerText()).includes('IR since')
				)
					fail(tag, 'the order shows no "IR since" chip');
				const wide = await page.evaluate(
					() => document.documentElement.scrollWidth - window.innerWidth
				);
				if (wide > 0) fail(tag, `scrolls sideways by ${String(wide)}px`);
				if ((SHOT_WIDTHS as readonly number[]).includes(width)) {
					await checkPage(page, shot, tag, width);
					await checkPrerendered(
						bare,
						shot,
						`${tag} script off`,
						new URL(`${shot.name}-script-off-${theme}-${String(width)}.png`, out).pathname
					);
					await page.screenshot({
						path: new URL(`${shot.name}-${theme}-${String(width)}.png`, out).pathname,
						fullPage: true
					});
				}
			}
			if ((SHOT_WIDTHS as readonly number[]).includes(width)) {
				await shootTierStrip(
					page,
					`tier-strip ${theme} ${String(width)}`,
					new URL(`tier-strip-${theme}-${String(width)}.png`, out).pathname
				);
			}
			await scripted.close();
			await prerendered.close();
		}
	}
} finally {
	await browser.close();
}
if (failures.length > 0) throw new Error(`Lane 66n shots:\n${failures.join('\n')}`);
process.stdout.write('board-row shots: every check held\n');
