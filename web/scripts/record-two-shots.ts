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
// page the Worker draws: one name, "Rankings", on the rail, the bar's crumb after Players, the
// page's head, its rank column keeping our rest-of-season order (Lane 164). Lane 143 (B126): the week item is drawn with that one name from the
// first paint, never another first, on the run's page, the account page (its shell prerendered) and the
// league page the Worker draws; and the week's projection column beside it heads the same week, "Wk 7"
// (the fixture's order re-dated to the board's week, inseason-fixture/serve.ts orderWeek).
// The held week item keeps the named label's room at 390 as well as at the desk (Lane 148, B127): a
// signed-out room page the Worker draws, opened in a new tab after a prerendered page, measures it.
// A missing page, at the root and inside a section, is the prerendered not-found page with a 404, its
// week item named once from the build, its scripts loaded and its rail navigating in the page.
//
//   node scripts/record-two-shots.ts <upcoming|graded|published> [web origin] [api origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { RECORDS_WORDS } from '../src/lib/run/records.ts';
import { ERROR_WORDS } from '../src/lib/site/error-words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { PAGE_BASIS, basisLines, basisReport } from './basis-lines.ts';
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
const NOT_FOUND = 404;
const SETTLE_MS = 600;
const READY_TIMEOUT_MS = 30_000;
/** A 3G-like round trip, added to each API answer on the league page's waterfall (Lane 143). */
const API_LATENCY_MS = 300;
/** How many round trips late the season answers on that waterfall (fix round 1). */
const SEASON_LATE = 2;

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

async function open(
	who: Who,
	width: number,
	path: string,
	theme: Theme = 'light',
	blank = false
): Promise<Page> {
	const ctx = await browser.newContext({
		viewport: { width, height: width <= PHONE_MAX ? 844 : 900 },
		deviceScaleFactor: width <= PHONE_MAX ? 2 : 1,
		colorScheme: theme
	});
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addInitScript(watchWeekItem);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	if (who === 'espn')
		await ctx.addCookies([SIGNED_IN, ESPN].map((c) => ({ ...c, domain: 'localhost', path: '/' })));
	const page = await ctx.newPage();
	// A blank page is navigated by the caller, once it watches the page's requests.
	if (blank) return page;
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle', timeout: READY_TIMEOUT_MS });
	await page.waitForTimeout(SETTLE_MS);
	return page;
}

/** Every label the rail's week item is drawn with, in order, from the first parsed node on (Lane 143,
 * B126): a page that paints one name and then another shows two. Runs in the page before its HTML. */
function watchWeekItem(): void {
	const drawn: string[] = [];
	// The week item's heights, held and named: the held room is the named label's (fix round 1).
	const heights: { held: number[]; named: number[] } = { held: [], named: [] };
	Object.assign(window, { weekItemDrawn: drawn, weekItemHeights: heights });
	// Each frame, while the label is held and once it is named, the item's height as drawn (a
	// slot the rail holds blank draws none).
	const sample = (): void => {
		const span = document.querySelector('nav.rail .item[data-k="week"] span');
		const height = span?.closest('a')?.getBoundingClientRect().height ?? 0;
		if (span && height > 0)
			heights[span.classList.contains('held') ? 'held' : 'named'].push(height);
		requestAnimationFrame(sample);
	};
	requestAnimationFrame(sample);
	const read = (): void => {
		const span = document.querySelector('nav.rail .item[data-k="week"] span');
		// A label held unpainted while the season is read (Shell's held) is not drawn.
		if (span === null || span.classList.contains('held')) return;
		const label = span.textContent.trim();
		if (label !== '' && drawn.at(-1) !== label) drawn.push(label);
	};
	new MutationObserver(read).observe(document, {
		subtree: true,
		childList: true,
		characterData: true,
		attributes: true,
		attributeFilter: ['class']
	});
}

/** When a read was asked and answered, in ms from the page's navigation (an elapsed timer, not the clock). */
interface Span {
	start: number;
	end: number;
}

/** Records the request spans of the URLs a test names, from the navigation on. */
function waterfall(page: Page, names: Readonly<Record<string, RegExp>>): Map<string, Span> {
	const spans = new Map<string, Span>();
	const from = performance.now();
	page.on('request', (request) => {
		for (const [name, pattern] of Object.entries(names))
			if (pattern.test(request.url()) && !spans.has(name))
				spans.set(name, { start: Math.round(performance.now() - from), end: Number.NaN });
	});
	page.on('requestfinished', (request) => {
		for (const [name, pattern] of Object.entries(names)) {
			const span = spans.get(name);
			if (pattern.test(request.url()) && span && Number.isNaN(span.end))
				spans.set(name, { ...span, end: Math.round(performance.now() - from) });
		}
	});
	return spans;
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
	// The page's footers together, printed for the report (Lane 163, D07), and Order matched and
	// Places off defined once on the page, never again in the draft's.
	const total = await basisLines(page, PAGE_BASIS);
	process.stdout.write(
		`basis record ${mode} page ${who} ${String(width)}: ${String(total)} lines\n`
	);
	const said = (await page.locator(PAGE_BASIS).allTextContents()).join(' ');
	for (const lead of ['Order matched is', 'Places off is']) {
		const times = said.split(lead).length - 1;
		if (times !== 1)
			faults.push(`record ${mode} ${who} ${String(width)}: "${lead}" ${String(times)} times`);
	}
}

async function record(who: Who, width: number, theme: Theme): Promise<void> {
	const page = await open(who, width, '/record', theme);
	const where = `record ${mode} ${who} ${theme} ${String(width)}`;
	const weekly = (await page.locator('section#weekly').textContent()) ?? '';
	const draft = (await page.locator('section#draft').textContent()) ?? '';
	has(weekly, 'Weekly record', where);
	has(
		weekly,
		"Our rest-of-season order, graded week by week against ESPN and the week's published projection",
		where
	);
	has(weekly, 'Weeks 1 to 6', where);
	has(weekly, 'Before that the site shipped the draft board, graded under Draft record.', where);
	has(weekly, "Each week's order is set before its first kickoff and graded as set", where);
	// On a phone the weeks before the weekly record are a chip a week, never a paragraph (Lane 209).
	if (width <= PHONE_MAX) {
		const chips = await page.locator('section#weekly tr.before .wk-chips li:visible').count();
		if (chips !== 6) faults.push(`${where}: ${String(chips)} week chips before the weekly record`);
		// The set rule said once on the phone too, read as drawn (review M3), not from hidden cells.
		const seen = await page.locator('section#weekly').innerText();
		if (!seen.includes(RECORDS_WORDS.setRulePhone))
			faults.push(`${where}: the phone does not say the set rule`);
	}
	lacks(weekly, /Yahoo|weekly experts|\bADP\b|FantasyPros|froze|freeze/iu, where);
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
	// Order matched and Places off are the weekly basis's, said once (Lane 163, D07).
	lacks(draft, /Order matched is|Places off is/u, where);
	// Week 7's ESPN sentence (Lane 147): drawn once under its row when the run carries it, nothing
	// on a run without it.
	const notes = await page.locator('section#weekly table.weeks tr.note td:visible').allInnerTexts();
	if (mode === 'upcoming') {
		if (notes.length > 0) faults.push(`${where}: draws a week's note on a run without one`);
		lacks(weekly, /ESPN's projection this week was read/u, where);
		has(weekly, 'Week 7 not graded yet', where);
		has(weekly, "Grades once every game's stats are in, after Monday's game.", where);
		has(weekly, 'Set before kickoff Thu Oct 22', where);
		lacks(weekly, /ESPN 0\.|Order matched by week/u, where);
	} else {
		has(weekly, 'Set Thu Oct 22, ', where);
		has(weekly, 'Our rest-of-season order, set Oct 22', where);
		has(weekly, 'Order matched by week, 1 week graded', where);
		has(weekly, RECORDS_WORDS.espnBasis, where);
		// The weekly pairs name the leader, ESPN's where it leads (fix round 1, HIGH-1).
		has(weekly, 'ESPN by 2', where);
		if (notes.join('|') !== RECORDS_WORDS.espnReadAfter)
			faults.push(`${where}: week 7's note reads ${JSON.stringify(notes)}`);
		const after = await page
			.locator('section#weekly table.weeks tbody tr')
			.evaluateAll((rows): string[] =>
				rows.map((row) =>
					row.classList.contains('note')
						? 'note'
						: (row.querySelector('td.wk')?.firstChild?.textContent?.trim() ?? '')
				)
			);
		const at = after.indexOf('Week 7');
		if (at < 0) faults.push(`${where}: the weekly table draws no Week 7 row`);
		else if (after[at + 1] !== 'note') faults.push(`${where}: week 7's note is not under its row`);
		if (after.filter((name) => name === 'note').length !== 1)
			faults.push(`${where}: more than one week carries a note`);
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
			"Our rest-of-season order is graded week by week from week 7, against ESPN and the week's published projection.",
			where
		);
		has(card, 'ADP by 4', where);
		lacks(card, /below it the reverse/u, where);
	} else {
		has(card, 'Weekly record', where);
		has(card, 'Order matched is how closely an order ranked the players', where);
		has(card, 'Our rest-of-season order, graded over week 7', where);
		has(card, 'ESPN by 2', where);
		lacks(card, /\bADP\b/u, where);
		// The front card says nothing of a week's ESPN read (Lane 147).
		lacks(card, /ESPN's projection this week was read/u, where);
		// Both yardsticks once the published projection is graded, the leader named per pair (Lane 142).
		if (mode === 'published') {
			has(card, 'Published', where);
			has(card, 'Published by 2', where);
			has(card, 'ours by 0.05', where);
		} else lacks(card, /Published/u, where);
	}
	has(card, 'Rankings', where);
	// The link lands on a page headed as the link promised (fix round 1, MEDIUM-3).
	const target = await open('signed-out', width, '/players');
	has(
		(await target.locator('main h1, main h2').first().textContent()) ?? '',
		'Rankings',
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

/** The rail's week item is "Rankings" as drawn, and shown wherever its rail shows it: every
 * desk, and the phone's five without a league (a followed league's five are its own pages). No
 * shown item says Players in season. */
async function weekItemFaults(page: Page, who: Who, width: number, where: string): Promise<void> {
	const drawn = await page.evaluate(
		() => document.querySelector('nav.rail .item[data-k="week"] span')?.textContent.trim() ?? ''
	);
	if (drawn !== 'Rankings') faults.push(`${where}: the week item reads "${drawn}"`);
	// One name from the first paint: never Players first and renamed once the season answers.
	const history = await page.evaluate(
		() => (window as unknown as { weekItemDrawn: string[] }).weekItemDrawn
	);
	if (history.join() !== 'Rankings')
		faults.push(`${where}: the week item was drawn as ${history.join(', then ')}`);
	// Nothing below it moves when the label lands: every held height is the named label's.
	const heights = await page.evaluate(
		() =>
			(window as unknown as { weekItemHeights: { held: number[]; named: number[] } })
				.weekItemHeights
	);
	const named = heights.named.at(-1);
	const moved = heights.held.filter((height) => named !== undefined && height !== named);
	if (heights.held.length > 0)
		process.stdout.write(
			`held ${where}: ${String(heights.held.length)} held frames at ${[...new Set(heights.held)].join(', ')} px, named ${String(named)} px\n`
		);
	if (moved.length > 0)
		faults.push(
			`${where}: the held week item is ${[...new Set(moved)].join(', ')} px, named ${String(named)} px`
		);
	const labels = await railLabels(page);
	const shown = width > PHONE_MAX || who === 'signed-out';
	if (shown && !labels.includes('Rankings'))
		faults.push(`${where}: the rail shows ${labels.join(', ')}`);
	if (labels.includes('Players')) faults.push(`${where}: the rail still says Players`);
}

/** The week's rankings under one name (Lane 142, ruling 1): the rail on the run's page and on a league
 * page the Worker draws, the bar's crumb, the page's head and its rank column; no rail item says
 * Players in season. */
async function rail(who: Who, width: number): Promise<void> {
	const page = await open(who, width, '/players');
	const where = `rail ${who} ${String(width)}`;
	const head = page.locator('table.order th.g-order');
	// The group row over # folds away on a phone, so the head is read as drawn, not as shown.
	await head
		.waitFor({ state: 'attached', timeout: READY_TIMEOUT_MS })
		.catch(() => faults.push(`${where}: the order table never drew`));
	await weekItemFaults(page, who, width, where);
	has((await page.locator('main h1, main h2').first().textContent()) ?? '', 'Rankings', where);
	has((await head.textContent()) ?? '', 'Our rest-of-season order', where);
	// The week's projection column is the same week's (Lane 143, B126: the fixture re-dated to week 7).
	has((await page.locator('table.order th.proj').textContent()) ?? '', 'Wk 7', where);
	if (width > PHONE_MAX)
		has((await page.locator('header.top h1').textContent()) ?? '', 'Players / Rankings', where);
	await page.screenshot({
		path: new URL(`rail-players-${who}-${String(width)}.png`, out).pathname
	});
	await page.context().close();
	// A user page whose shell is prerendered names the week from its build, as the run's pages do.
	const account = await open(who, width, '/account');
	await weekItemFaults(account, who, width, `${where} account`);
	await account.screenshot({
		path: new URL(`rail-account-${who}-${String(width)}.png`, out).pathname
	});
	await account.context().close();
	await notFound(who, width, where);
	if (who === 'signed-out') {
		// The phone's five without a league draw the week item as a tab, so its held room is
		// measured at 390 on a page the Worker draws as well as at the desk (Lane 148, B127).
		// A visitor who has read a prerendered page keeps its build's rail (context/boot.ts), so the
		// room's rail draws the week item, held, while its season is read.
		const { page: mock } = await lateSeason(who, width, '/mock/new', {}, '/players');
		await weekItemFaults(mock, who, width, `${where} mock`);
		await heldMeasured(mock, `${where} mock`);
		await mock.screenshot({
			path: new URL(`rail-mock-${who}-${String(width)}.png`, out).pathname
		});
		await mock.context().close();
		return;
	}
	// A league page the Worker draws names the week from the API's season, read before its first
	// render (context/first-season.ts), so it never paints another name first.
	// The season read runs alongside the league's own first read, never before it (Lane 143): the
	// two spans overlap, so the season adds no round trip before the page paints.
	const { page: league, spans } = await lateSeason(who, width, `/league/${FIXTURE_IDS.espnDone}`, {
		season: /\/season$/u,
		sync: /\/leagues\/attached\/[^/]+\/sync$/u
	});
	const season = spans.get('season');
	const sync = spans.get('sync');
	const line = (span: Span | undefined): string =>
		span ? `${String(span.start)} to ${String(span.end)} ms` : 'never asked';
	process.stdout.write(
		`waterfall league ${String(width)}: season ${line(season)}, sync ${line(sync)}\n`
	);
	if (!season || !sync || !(season.start < sync.end && sync.start < season.end))
		faults.push(`${where} league: the season read and the league's read do not overlap`);
	await weekItemFaults(league, who, width, `${where} league`);
	// The desk rail shows the item while the season is read, so its held room was measured above; a
	// followed league's phone five are its own pages, so at 390 the item is not drawn to measure.
	if (width > PHONE_MAX) await heldMeasured(league, `${where} league`);
	await league.screenshot({
		path: new URL(`rail-league-${who}-${String(width)}.png`, out).pathname
	});
	await league.context().close();
}

/** Missing pages at the root and inside a prerendered section (Lane 148, fix round 1): the not-found
 * page is one file served at any depth, so its asset paths must be absolute. */
const MISSING = [
	{ path: '/no-such-page', name: 'root' },
	{ path: '/players/no-such-player', name: 'nested' }
] as const;

/** A page that does not exist (Lane 148): the Worker answers the prerendered not-found page with a
 * 404, its words from the word table and its week item named at build, once, never renamed; its
 * scripts load and the rail navigates in the page, with no document load (it hydrated). */
async function notFound(who: Who, width: number, where: string): Promise<void> {
	for (const missing of MISSING) {
		const page = await open(who, width, 'about:blank', 'light', true);
		const at = `${where} not found ${missing.name}`;
		page.on('response', (response) => {
			if (response.url().includes('/_app/') && response.status() >= 400)
				faults.push(`${at}: ${response.url()} answered ${String(response.status())}`);
		});
		page.on('requestfailed', (request) => {
			if (request.url().includes('/_app/')) faults.push(`${at}: ${request.url()} failed`);
		});
		const answer = await page.goto(`${web}${missing.path}`, {
			waitUntil: 'networkidle',
			timeout: READY_TIMEOUT_MS
		});
		await page.waitForTimeout(SETTLE_MS);
		if (answer?.status() !== NOT_FOUND)
			faults.push(`${at}: answered ${String(answer?.status())}, not ${String(NOT_FOUND)}`);
		const main = (await page.locator('main').textContent()) ?? '';
		has(main, ERROR_WORDS.notFound.head, at);
		has(main, ERROR_WORDS.notFound.lead, at);
		has(main, ERROR_WORDS.toBoard, at);
		await weekItemFaults(page, who, width, at);
		await page.screenshot({
			path: new URL(`not-found-${missing.name}-${who}-${String(width)}.png`, out).pathname
		});
		await railNavigates(page, at);
		await page.context().close();
	}
}

/** A tap on the rail's week item (on a phone with a league, the first item it draws) navigates in
 * the page: the router took it, so the page hydrated. A page whose scripts never loaded falls back
 * to a document load, which drops the marker set before the tap. */
async function railNavigates(page: Page, at: string): Promise<void> {
	const week = page.locator('nav.rail .item[data-k="week"]');
	const item = (await week.isVisible())
		? week
		: page.locator('nav.rail .item[data-k]:visible').first();
	const href = await item.getAttribute('href');
	if (href === null) {
		faults.push(`${at}: the rail draws no item to tap`);
		return;
	}
	await page.evaluate(() => Object.assign(window, { stayedInPage: true }));
	await item.click();
	await page
		.waitForURL((url) => url.pathname === new URL(href, web).pathname, {
			timeout: READY_TIMEOUT_MS
		})
		.catch(() => faults.push(`${at}: a tap on the rail did not reach ${href}`));
	const stayed = await page.evaluate(
		() => (window as unknown as { stayedInPage?: boolean }).stayedInPage === true
	);
	if (!stayed) faults.push(`${at}: the rail's tap loaded a new document, the page never hydrated`);
}

/** A page the Worker draws, opened with every API answer a 3G-like round trip late and the season's
 * twice that, so the rail draws the held label after /me answers and its room is measured. `read`
 * is a page opened first in the same browser, closed before the page the Worker draws opens in a
 * new tab. The named reads' spans are kept. */
async function lateSeason(
	who: Who,
	width: number,
	path: string,
	names: Readonly<Record<string, RegExp>> = {},
	read: string | null = null
): Promise<{ page: Page; spans: Map<string, Span> }> {
	const page = await open(who, width, read ?? 'about:blank', 'light', read === null);
	// The page read first keeps only what a new tab keeps (localStorage), never this tab's session copy.
	if (read !== null) await page.close();
	const late = read === null ? page : await page.context().newPage();
	await late.route(`${API_ORIGIN}/**`, async (route) => {
		const times = route.request().url().endsWith('/season') ? SEASON_LATE : 1;
		await new Promise((done) => setTimeout(done, API_LATENCY_MS * times));
		await route.continue();
	});
	const spans = waterfall(late, names);
	await late.goto(`${web}${path}`, { waitUntil: 'networkidle', timeout: READY_TIMEOUT_MS });
	await late.waitForTimeout(SETTLE_MS);
	await late
		.locator('nav.rail .item[data-k="week"] span')
		.waitFor({ state: 'attached', timeout: READY_TIMEOUT_MS })
		.catch(() => faults.push(`${path}: the rail never drew`));
	return { page: late, spans };
}

/** The held label was drawn at least once, so weekItemFaults measured its room against the named. */
async function heldMeasured(page: Page, where: string): Promise<void> {
	const held = await page.evaluate(
		() => (window as unknown as { weekItemHeights: { held: number[] } }).weekItemHeights.held
	);
	if (held.length === 0)
		faults.push(`${where}: the held label was never drawn, its room not measured`);
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
