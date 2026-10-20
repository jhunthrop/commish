// Screenshots of the in-season screens (start and sit, waivers, trades) and the league page with its
// tabs, against the fixture API (scripts/inseason-fixture/serve.ts) and the built site, in both themes
// at 1440 and 390. At 1440, 1024, 800, 768 and 390 it asserts the page never scrolls sideways, and it
// prints the tallest player row, the taps from the page to its verb, and the shots of the loading
// rows, the API's refusals and the site's not-found for an unknown screen. On a phone (390 by 844) it
// asserts the first player row sits whole above the pinned verb (or, where nothing is pinned at rest,
// the tab bar). On the waiver screen it asserts the rows carry the rest-of-season points a game and the
// basis line says what they are (Lane 64). On the Trades table (Lane 66g) it asserts the strip's cards
// and their verb, the finder's heads (the phone's naming the unit), every gain and week cell signed,
// an opened trade's box-score heads, the basis in five lines at most opening on which trades are
// listed, the copy verb's confirm naming Sleeper's trade page, and that its copy passes the one guard; the
// builder's two boxes, its scoreboard's figures before and after once answered, and its answer naming
// its players with their points a game. On the Lineup and Matchup screens, box
// scores (Lane 66d), it asserts the column heads, every row's projection and points as one decimal or
// --, the projection's basis said once, no points a game on a row, no name cut and a defense drawn
// with its club's mark. On the Lineup table (Lane 66e) it asserts the evidence heads and cells,
// each swap's chip, arrow and evidence line, the bench arrow reading Sit, the copy verb with the
// platform's own line under it, and that the copy on every screen passes the one guard, "host" among
// its words, with the names and rows the API handed it skipped (copy-scan.ts). On the Waivers table (Lane 66f) it asserts the heads, every Proj and Rest of
// season cell, the tint on the strip's pickups alone, the count of the free agents we rank with the
// platform named, the basis at five rendered lines at most at 1440 with the pickup rule first and
// Beats and Open spot said, the drop panel and the copy verb's confirm. On the League page (Lane 66i),
// for the Sleeper league and the ESPN
// fixture (its Sunday points a stand-in, named so), it asserts the scoreboard's six bugs, the side
// ahead bright once a game has started and both alike before, the standings' columns and twelve
// rows with the playoff rule drawn by record, the lineup's verb and bench link, a bid in Sleeper's
// moves and no moves on ESPN with the basis saying why, the basis drawn in at most five lines at a
// desk, the settings' stated rules counted with no figure for an unstated one, the tabs' arrow keys,
// and on a phone the first standings row clear of the pinned verb. Exits non-zero when a page scrolls sideways, a
// phone's first row is under the pin, or a figure or its sentence is missing.
//
//   node scripts/inseason-shots.ts [web origin] [out dir, from scripts/]
// with the site built against PUBLIC_API_URL=http://localhost:8799 and the fixture API running there
// on the fixture week's clock (FIXTURE_CLOCK=2026-10-17T17:00:00.000Z); API_ORIGIN names another
// port. The script stops before its first shot when the API's clock is not that week's.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_SUNDAY_CLOCK,
	FIXTURE_WEEK_CLOCK,
	installFixtureClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';
import { BUILDER_LINE, basisLines, basisReport, figureSentenceFaults } from './basis-lines.ts';
import { chromeFaults, chromeLine, chromeMeasures } from './chrome-measures.ts';
import { pageFaults, pageLine, pageMeasures } from './page-measures.ts';
import { UNCOUNTED_ANCHOR } from '../src/lib/league/uncounted.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { PER_GAME_BASIS, WAIVERS_BASIS } from './inseason-fixture/week.ts';

const THEMES = ['light', 'dark'] as const;
const SHOT_WIDTHS = new Set([1440, 390]);
const WIDTHS = [1440, 1024, 800, 768, 390] as const;
const VIEWPORT_HEIGHT = 900;
/** A phone's screen: the first row must clear the pinned verb in it. */
const PHONE = { width: 390, height: 844 } as const;
const READY_TIMEOUT_MS = 30_000;
/** ESPN's Pts sentence now that it gives each player's points (Lane 79, basis.ts ptsPart). */
const ESPN_PTS = "Pts are ESPN's points so far, Team adds the rows.";
/** ESPN's Matchup, whose Team is ESPN's own score (ruling (a)). */
const ESPN_MATCHUP_PTS =
	"Pts are ESPN's points by player so far, each to a tenth, and Team is ESPN's score.";
/** The team-totals sentence (Lane 79 fix 6). */
const YAHOO_PTS = "Pts are Yahoo's team points, none by player.";
/** Sleeper's Matchup, whose Team adds the rows (ruling (a)). */
const SLEEPER_MATCHUP_PTS = "Pts are Sleeper's points so far, Team adds the rows.";
/** The drafter's four starters under way on the Sunday, their points added (13.4, 8.1, 9.4, 8.2). */
const SLEEPER_SUNDAY_SUM = '39.1';
/** The Sunday's changes the engine would make: Kirk (Monday night) for Chase on bye at Flex. Dart,
 * Etienne and the Texans, Wednesday's changes, have kicked off and are locked (re-review N2). */
const SUNDAY_MOVES = { offered: ['Kirk'], locked: ['Dart', 'Etienne', 'Texans'] } as const;
/** The stand-in API's ask for the recorded league as Yahoo's (yahoo.ts). */
const YAHOO_PLATFORM = { name: 'fixture_platform', value: 'yahoo' };
/** The stand-in API's ask for an ESPN league's Sunday afternoon (sunday.ts). */
const SUNDAY_WEEK = { name: 'fixture_week', value: 'sunday' };
/** The drafter's side on that Sunday as ESPN totals it (scoreboard-live.json, roster 1). */
const ESPN_SUNDAY_TOTAL = '39.0';
/** The CSRF cookie the site reads as signed in; the fixture API asks for nothing more. */
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };

const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? '../screenshots/inseason/', import.meta.url);
const id = FIXTURE_IDS.league;

const PAGES = [
	{ name: 'league', path: `/league/${id}`, ready: 'Set your lineup' },
	{ name: 'start', path: `/league/${id}/start`, ready: 'Copy the lineup' },
	{ name: 'matchup', path: `/league/${id}/matchup`, ready: 'Week 6' },
	{ name: 'waivers', path: `/league/${id}/waivers`, ready: 'Open Sleeper waivers' },
	{ name: 'trades', path: `/league/${id}/trades`, ready: 'worth proposing' }
] as const;
/** The Trades screen's verb on every platform today: the offer copied, the trade page opened. */
const TRADE_VERB = 'Open Sleeper trades';

/** The fixture API the site was built against: it must run on the browser's clock, the fixture
 * week's, or every read stamp disagrees with the screens. */
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(
	theme: string,
	width: number,
	clock: string = FIXTURE_WEEK_CLOCK
): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light'
	});
	watchData(ctx);
	// The fixture week's clock, never the day the script runs (start the fixture API with
	// FIXTURE_CLOCK at the same instant): past its Sunday every game reads as played.
	await installFixtureClock(ctx, clock);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function ready(page: Page, text: string): Promise<void> {
	await page
		.getByText(text)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

function file(name: string): string {
	return new URL(`${name}.png`, out).pathname;
}

const scrolls: string[] = [];
/** The screens whose rows carry his rest-of-season points a game, and the basis sentence saying so. */
const PER_GAME_SCREENS = new Set<string>();
/** The screens drawn as a box score (Lane 66d): columns, the week's projection and points so far,
 * the projection's basis said once, no points a game on a row. */
const BOX_SCREENS = new Set(['start', 'matchup']);
const PROJ_BASIS =
	/Proj is this week's published projection(, (PPR|half-PPR|standard) nearest your rules| on your rules)(, defenses on default scoring)?, read \w{3} \d+:\d\d [ap]m\./g;
const BOX_NUMBER = /^(\d+\.\d|--)$/;
/** The Lineup's evidence cells: an ordinal rank, a figure, a signed change, or --. */
const EVIDENCE_CELL = /^(\d+(st|nd|rd|th)|\d+\.\d|[+−]\d+\.\d|--)$/;
/** The Lineup's heads at the desk and on a phone, the open column's own word read by a screen reader. */
const LINEUP_HEADS = [
	'Slot',
	'Player',
	'Our rank',
	'Game',
	'Proj',
	'Pts',
	'Opp rank',
	'Avg',
	'Last',
	'Δ Proj',
	'Why'
];
const PHONE_HEADS = ['Slot', 'Player', 'Our rank', 'Proj', 'Pts', 'Why'];
/** Below 900 px the evidence folds under the name. */
const FOLDED_HEADS = ['Slot', 'Player', 'Our rank', 'Game', 'Proj', 'Pts', 'Why'];
const EVIDENCE_FOLDS_AT = 900;
/** The Waivers table's heads at the desk, folded below 900 px, and on a phone (Lane 66f). */
const WAIVER_HEADS = [
	'Player',
	'Game',
	'Proj',
	'Opp rank',
	'Avg',
	'Last',
	'Δ Proj',
	'A game',
	'Beats',
	'Add'
];
const WAIVER_FOLDED = ['Player', 'Game', 'Proj', 'Beats', 'Add'];
const WAIVER_PHONE = ['Player', 'Proj', 'Beats', 'Add'];
/** The pickup rule and the figure a game's sentence, in the API's words as the fixture says them. */
const PICKUP_RULE = WAIVERS_BASIS;

/** What a box score screen draws, for the checks: its column heads, each row's two numbers, its
 * basis, any row cell whose name is cut, and whether a row says points a game. */
async function boxFacts(page: Page): Promise<{
	heads: string[];
	numbers: string[];
	basis: string;
	cut: string[];
	perGame: boolean;
	/** Defense rows (no position pill under the name), and how many of them draw the club mark. */
	defenseRows: number;
	defenseMarks: number;
	/** The status pills drawn: "Questionable", "RB IR". */
	statuses: string[];
	/** Each bye row's projection as printed: always "--". */
	byeProj: string[];
}> {
	return page.evaluate(() => {
		const box = [...document.querySelectorAll('main table.box, main table.lineup')];
		const rows = box.flatMap((t) => [...t.querySelectorAll('tbody tr')]);
		// Every row's name block (the line the name owns), measured for overflow: a name cut by its
		// cell, clipped or ellipsed, scrolls wider than the block shows (review L5).
		const names = rows.flatMap((tr) => [...tr.querySelectorAll('.nm')]);
		return {
			// A head the phone folds away keeps its place at no width: only the drawn heads count.
			heads: [...(box[0]?.querySelectorAll('thead tr.cols th') ?? [])]
				.filter((th) => th.getBoundingClientRect().width > 1)
				// A head's key under it (Opp rank's "1st fewest allowed", Lane 99) is not its name.
				.map((th) => ((th as HTMLElement).innerText.trim().split('\n')[0] ?? '').trim()),
			numbers: rows.flatMap((tr) =>
				[...tr.querySelectorAll('td.proj, td.pts')].map((td) =>
					(td as HTMLElement).innerText.trim()
				)
			),
			basis: [...document.querySelectorAll('main [data-basis]')]
				.map((p) => p.textContent)
				.join(' '),
			cut: names.flatMap((n) =>
				n.scrollWidth > n.clientWidth + 1 ||
				n.getBoundingClientRect().right > (n.closest('td')?.getBoundingClientRect().right ?? 0) + 1
					? [n.textContent.trim()]
					: []
			),
			perGame: rows.some((tr) => /\d a game/.test(tr.textContent)),
			// A defense row: its Our rank cell says D/ST (Lane 99), or with no such cell no position pill
			// under the name.
			defenseRows: rows.filter((tr) => {
				const rank = tr.querySelector('td.rank');
				return rank
					? rank.getAttribute('data-position') === 'D/ST'
					: tr.querySelector('.club') && !tr.querySelector('.club .pos');
			}).length,
			defenseMarks: rows.filter((tr) => {
				const rank = tr.querySelector('td.rank');
				const defense = rank
					? rank.getAttribute('data-position') === 'D/ST'
					: tr.querySelector('.club') && !tr.querySelector('.club .pos');
				return defense && tr.querySelector('img[alt$=" defense"]');
			}).length,
			// The position pill (under the name, or under Our rank, Lane 99) and the shared status chip
			// beside the club (StatusChip, Lane 66n).
			statuses: rows.flatMap((tr) =>
				[...tr.querySelectorAll('.club .pos, td.rank .pos, .club .status-chip')].map((el) =>
					el.textContent.trim()
				)
			),
			byeProj: rows
				.filter((tr) => tr.querySelector('td.game .bye') !== null)
				.map((tr) => tr.querySelector<HTMLElement>('td.proj')?.innerText.trim() ?? '?')
		};
	});
}
const PER_GAME = /\d+\.\d a game/;
/** The Trades table's heads (Lane 66g): at a desk, below the room's width, and on a phone, where the
 * gain heads name their unit. The open column's own words are read by a screen reader. */
const TRADE_HEADS = [
	'Why this trade',
	'You give',
	'You get',
	'With',
	'You',
	'Them',
	'You',
	'Them',
	'Room'
];
const TRADE_HEADS_NARROW = TRADE_HEADS.slice(0, -1);
const TRADE_HEADS_PHONE = ['Why this trade', 'You give', 'Your gain', 'Their gain'];
const ROOM_FOLDS_AT = 1180;
/** Below it a trade folds as on a phone. */
const TRADES_FOLD_AT = 900;
/** A gain or a week's change as its cell prints it. */
const SIGNED = /^([+−]\d+\.\d|0\.0|--)$/;
const TRADE_BASIS_FIRST =
	"Each team's best trade both lineups gain by, yours first. The other team decides. A player we rank first at his position goes only for 1.0 a week or more, or to fill a spot.";
/** What a Gain is, once under the finder's heads (Lane 103, B42). */
const GAIN_BASIS = /^points over replacement in each lineup, weeks? \d+/;
/** A card's gains in a player's words (Lane 103, B42). */
const CARD_GAINS = /[+−]\d+\.\d a week for your lineup, [+−]\d+\.\d for theirs/;
/** A trade's week in one line, from the API's two changes (review H2). */
const WEEK_LINE = /[+−]?\d+\.\d Proj this week for your lineup, [+−]?\d+\.\d for theirs/;

/** What the Trades table draws wrong at a width: its heads, its cells, its strip and its basis. */
async function tradeFaults(page: Page, width: number): Promise<string[]> {
	const seen = await page.evaluate(() => {
		const table = document.querySelector('main table.finder');
		const drawn = (el: Element): boolean => el.getBoundingClientRect().width > 1;
		return {
			heads: [...(table?.querySelectorAll(':scope > thead tr.cols > th') ?? [])]
				.filter(drawn)
				.map((th) => (th as HTMLElement).innerText.trim())
				.filter((h) => h !== ''),
			cells: [
				...(table?.querySelectorAll(
					':scope > tbody > tr.trade > td.g, :scope > tbody > tr.trade > td.w'
				) ?? [])
			]
				.filter(drawn)
				.map((td) => (td as HTMLElement).innerText.trim()),
			rows: table?.querySelectorAll(':scope > tbody > tr.trade').length ?? 0,
			basis: document.querySelector('main [data-basis]')?.textContent.trim() ?? '',
			cards: [...document.querySelectorAll('main .card')].map((c) => (c as HTMLElement).innerText),
			// Each card's verb as it draws (Lane 103, B65): one look for the one verb.
			verbLooks: [...document.querySelectorAll('main .card .act .action')].map((a) => a.className),
			gainBasis: [...(table?.querySelectorAll(':scope > thead tr.gain-basis td.gb') ?? [])]
				.filter((td) => (td as HTMLElement).offsetParent !== null)
				.map((td) => (td as HTMLElement).innerText.trim()),
			// The member's drop as each row says it where it is drawn (review M3).
			drops: [...(table?.querySelectorAll(':scope > tbody > tr.trade') ?? [])].filter((tr) =>
				[...tr.querySelectorAll<HTMLElement>('td.room span, .drop-mid, .ph-with')].some(
					(el) => el.offsetParent !== null && /you drop /i.test(el.innerText)
				)
			).length
		};
	});
	const faults: string[] = [];
	const heads =
		width <= TRADES_FOLD_AT
			? TRADE_HEADS_PHONE
			: width <= ROOM_FOLDS_AT
				? TRADE_HEADS_NARROW
				: TRADE_HEADS;
	if (seen.heads.join('|').toLowerCase() !== heads.join('|').toLowerCase())
		faults.push(`finder heads ${seen.heads.join('|')}`);
	if (seen.rows === 0) faults.push('no trade rows');
	if (seen.cells.length === 0 || !seen.cells.every((c) => SIGNED.test(c)))
		faults.push(`finder cells ${seen.cells.join(' ')}`);
	if (seen.cards.length === 0 || seen.cards.length > 2)
		faults.push(`${String(seen.cards.length)} cards`);
	for (const card of seen.cards) {
		if (!card.includes(TRADE_VERB) || !CARD_GAINS.test(card) || !WEEK_LINE.test(card))
			faults.push(`card ${card.replace(/\s+/g, ' ')}`);
	}
	if (new Set(seen.verbLooks).size > 1)
		faults.push(`card verbs drawn ${String(new Set(seen.verbLooks).size)} ways`);
	if (seen.cards.length > 1 && !/^Best\b/i.test(seen.cards[0] ?? ''))
		faults.push('the first card does not say Best');
	if (seen.gainBasis.length !== 1 || !GAIN_BASIS.test(seen.gainBasis[0] ?? ''))
		faults.push(`gain basis ${seen.gainBasis.join(' | ')}`);
	if (seen.drops === 0) faults.push('no row says the drop');
	if (!seen.basis.startsWith(TRADE_BASIS_FIRST)) faults.push(`basis opens ${seen.basis}`);
	const all = seen.basis;
	// Closed, no player's columns are drawn, so the basis says none of them (Lane 66t).
	if (all.includes(PER_GAME_BASIS) || /Opp rank|Which five/.test(all))
		faults.push(`the closed basis names an opened column: ${all}`);
	const proj = (all.match(PROJ_BASIS) ?? []).length;
	if (proj !== 1) faults.push(`projection basis said ${String(proj)} times`);
	for (const word of await bannedSaid(page)) faults.push(`says ${word}`);
	return faults;
}
const missing: string[] = [];
/** Each screen's basis lines at 1440 and 390, the sweep's before beside them. */
const basisCounts: string[] = [];
const rows = new Map<string, number>();
const under: string[] = [];
const firstRows = new Map<string, string>();
/** The phone chrome's measures (Lane 83), each page's line for the report. */
const chromeLines: string[] = [];
for (const { name, path, ready: text } of PAGES) {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await context(theme, width);
			const page = await ctx.newPage();
			await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
			await ready(page, text);
			const wide = await page.evaluate(() => ({
				scroll: document.documentElement.scrollWidth,
				inner: window.innerWidth,
				tallest: Math.max(
					0,
					...[
						...document.querySelectorAll(
							'main .row, main table.box tbody tr, main table.lineup tbody tr, main table.pool tbody tr'
						)
					].map((r) => r.getBoundingClientRect().height)
				)
			}));
			if (wide.scroll > wide.inner) {
				scrolls.push(
					`${name} ${theme} ${String(width)}: ${String(wide.scroll)} > ${String(wide.inner)}`
				);
			}
			rows.set(`${name} ${String(width)}`, wide.tallest);
			if (SHOT_WIDTHS.has(width)) {
				const chrome = await chromeMeasures(page);
				const at = `${name} ${theme} ${String(width)}`;
				if (theme === 'dark') chromeLines.push(chromeLine(at, chrome));
				for (const fault of chromeFaults(chrome, width === PHONE.width))
					missing.push(`${at} ${fault}`);
				// A league's page passes the bar no parts: the one row led by the mark (Lane 87).
				const measured = await pageMeasures(page);
				if (theme === 'dark') chromeLines.push(pageLine(at, measured));
				for (const fault of pageFaults(measured, width === PHONE.width, 1))
					missing.push(`${at} ${fault}`);
			}
			if (PER_GAME_SCREENS.has(name)) {
				const said = await page.evaluate(() => ({
					basis: document.querySelector('main p.basis')?.textContent ?? '',
					row: document.querySelector('main .row')?.textContent ?? ''
				}));
				if (!said.basis.includes(PER_GAME_BASIS))
					missing.push(`${name} ${theme} ${String(width)} basis`);
				if (!PER_GAME.test(said.row)) missing.push(`${name} ${theme} ${String(width)} first row`);
			}
			const basisName = name === 'start' ? 'lineup' : name;
			const report = basisReport(basisName, width, await basisLines(page));
			if (name !== 'league')
				for (const fault of await figureSentenceFaults(page))
					missing.push(`${basisName} ${theme} ${String(width)} ${fault}`);
			if (report !== null && name !== 'league') {
				if (theme === 'dark') basisCounts.push(report.line);
				if (report.fault !== null) missing.push(`${theme} ${report.fault}`);
			}
			if (name === 'trades') {
				for (const fault of await tradeFaults(page, width))
					missing.push(`${name} ${theme} ${String(width)} ${fault}`);
			}
			if (name === 'waivers') {
				for (const fault of await waiverFaults(page, width)) {
					missing.push(`waivers ${theme} ${String(width)} ${fault}`);
				}
			}
			if (BOX_SCREENS.has(name)) {
				const box = await boxFacts(page);
				const at = `${name} ${theme} ${String(width)}`;
				const lineupHeads =
					width <= PHONE.width
						? PHONE_HEADS
						: width <= EVIDENCE_FOLDS_AT
							? FOLDED_HEADS
							: LINEUP_HEADS;
				const boxHeads =
					width <= PHONE.width
						? ['Slot', 'Player', 'Our rank', 'Proj', 'Pts']
						: ['Slot', 'Player', 'Our rank', 'Game', 'Proj', 'Pts'];
				const heads = name === 'start' ? lineupHeads : boxHeads;
				for (const word of await bannedSaid(page)) missing.push(`${at} says ${word}`);
				// Sleeper adds its players' points: the bug and Totals one figure, the rows' sum (ruling (a)).
				if (name === 'matchup') {
					const { bug, row } = await bugAgainstTotals(page);
					if (bug !== row) missing.push(`${at} the bug reads ${bug}, its Totals ${row}`);
				}
				if (name === 'start') {
					for (const fault of await lineupFaults(page)) missing.push(`${at} ${fault}`);
				}
				if (
					box.heads
						.filter((h) => h !== '')
						.join(' ')
						.toLowerCase() !== heads.join(' ').toLowerCase()
				)
					missing.push(`${at} box heads ${box.heads.join(' ')}`);
				if (box.numbers.length === 0 || !box.numbers.every((n) => BOX_NUMBER.test(n)))
					missing.push(`${at} box numbers ${box.numbers.join(' ')}`);
				if (!box.numbers.some((n) => n !== '--')) missing.push(`${at} no projection shown`);
				const said = (box.basis.match(PROJ_BASIS) ?? []).length;
				if (said !== 1) missing.push(`${at} projection basis said ${String(said)} times`);
				if (box.perGame) missing.push(`${at} a row says points a game`);
				if (box.cut.length > 0) missing.push(`${at} names cut: ${box.cut.join(', ')}`);
				if (box.defenseRows === 0 || box.defenseMarks !== box.defenseRows)
					missing.push(
						`${at} ${String(box.defenseRows - box.defenseMarks)} defense rows without a club mark`
					);
				// The injured reserve spot is the Lineup's own section: the Matchup, like the API, draws the
				// active roster alone (Lane 66e).
				const wantsIR = name === 'start';
				if (
					!box.statuses.includes('Questionable') ||
					// A season-long list is his status chip ("IR since Sep 22"), never his rank (Lane 99).
					(wantsIR && !box.statuses.some((s) => /^IR\b/.test(s)))
				)
					missing.push(
						`${at} the status pills: ${box.statuses.filter((s) => !/ \d+$/.test(s)).join(', ')}`
					);
				if (box.byeProj.length === 0) missing.push(`${at} no bye row to check`);
				if (box.byeProj.some((p) => p !== '--')) missing.push(`${at} a bye row with a projection`);
			}
			if (width === PHONE.width && name !== 'league' && name !== 'matchup') {
				await page.setViewportSize(PHONE);
				// The Trades screen's first row is its first trade, the strip's first card; nothing is pinned
				// there at rest (Lane 66g), so the card must clear the tab bar.
				const fold = await page.evaluate(() => {
					const row = document
						.querySelector(
							'main .card, main .row, main table.box tbody tr, main table.lineup tbody tr, main table.pool tbody tr'
						)
						?.getBoundingClientRect();
					const pin = [...document.querySelectorAll<HTMLElement>('.pin')]
						.find((p) => p.offsetParent !== null)
						?.getBoundingClientRect();
					const tabBar = parseFloat(
						getComputedStyle(document.documentElement).getPropertyValue('--tab-bar-h')
					);
					return { rowBottom: row?.bottom ?? Infinity, pinTop: pin?.top ?? innerHeight - tabBar };
				});
				firstRows.set(
					`${name} ${theme}`,
					`first row ends ${fold.rowBottom.toFixed(0)}px, pin starts ${fold.pinTop.toFixed(0)}px`
				);
				if (fold.rowBottom > fold.pinTop) under.push(`${name} ${theme}`);
				await page.screenshot({ path: file(`${name}-phone-${theme}`) });
				await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
			}
			if (SHOT_WIDTHS.has(width)) {
				await page.screenshot({ path: file(`${name}-${theme}-${String(width)}`), fullPage: true });
				await page.screenshot({ path: file(`${name}-first-${theme}-${String(width)}`) });
			}
			await ctx.close();
		}
	}
}

/** The bases on ESPN, which gives each player's points (Lane 79): the Lineup says Pts once and still
 * holds its budget (Lane 66t review 2); Waivers, which draws no Pts, holds it too. */
for (const width of SHOT_WIDTHS) {
	const ctx = await context('dark', width);
	const page = await ctx.newPage();
	for (const [screen, basisName] of [
		['start', 'lineup ESPN'],
		['waivers', 'waivers ESPN']
	] as const) {
		await page.goto(`${web}/league/${FIXTURE_IDS.espnDone}/${screen}`, {
			waitUntil: 'networkidle'
		});
		await page.locator('main [data-basis]').first().waitFor({ timeout: READY_TIMEOUT_MS });
		await page.evaluate(() => document.fonts.ready);
		const report = basisReport(basisName, width, await basisLines(page));
		for (const fault of await figureSentenceFaults(page))
			missing.push(`${basisName} ${String(width)} ${fault}`);
		if (report !== null) {
			basisCounts.push(report.line);
			if (report.fault !== null) missing.push(report.fault);
		}
		const said = (await page.locator('main').textContent()) ?? '';
		const pts = said.split(ESPN_PTS).length - 1;
		if (screen === 'start' && pts !== 1)
			missing.push(`${basisName} ${String(width)}: Pts said ${String(pts)} times`);
		await page.screenshot({ path: file(`${screen}-espn-dark-${String(width)}`), fullPage: true });
	}
	await ctx.close();
}

/** One screen of a platform's pass: its basis name, the Pts sentence it must say once, and whether
 * players' points must be drawn. */
interface PlatformScreen {
	screen: 'matchup' | 'start';
	basisName: string;
	sentence: string;
	points: boolean;
}

/** The Matchup's score bug and its Totals row print one figure, the side's score (ruling (a), Lane
 * 79): the drafter's side, bug against row. */
async function bugAgainstTotals(page: Page): Promise<{ bug: string; row: string }> {
	return page.evaluate(() => ({
		bug: document.querySelector<HTMLElement>('main .bug .sd .big')?.innerText.trim() ?? '',
		row:
			document.querySelector<HTMLElement>('main table.box tr.totals td.pts')?.innerText.trim() ?? ''
	}));
}

/** A platform's Matchup and Lineup in the dark at both widths (Lane 79): the Pts sentence once, the
 * basis in budget, players' points drawn where the platform gives them, the bug and Totals one
 * figure, and the bug at the platform's own score where `bugIs` names it. */
async function platformPass(
	league: string,
	cookies: { name: string; value: string }[],
	clock: string,
	screens: readonly PlatformScreen[],
	bugIs: string | null,
	shot: string
): Promise<void> {
	for (const width of SHOT_WIDTHS) {
		const ctx = await context('dark', width, clock);
		await ctx.addCookies(cookies.map((c) => ({ ...c, domain: 'localhost', path: '/' })));
		const page = await ctx.newPage();
		for (const { screen, basisName, sentence, points } of screens) {
			const at = `${basisName} ${String(width)}`;
			await page.goto(`${web}/league/${league}/${screen}`, { waitUntil: 'networkidle' });
			await page.locator('main [data-basis]').first().waitFor({ timeout: READY_TIMEOUT_MS });
			await page.evaluate(() => document.fonts.ready);
			const report = basisReport(basisName, width, await basisLines(page));
			for (const fault of await figureSentenceFaults(page)) missing.push(`${at} ${fault}`);
			if (report !== null) {
				basisCounts.push(report.line);
				if (report.fault !== null) missing.push(report.fault);
			}
			const said = (await page.locator('main').textContent()) ?? '';
			if (said.split(sentence).length - 1 !== 1) missing.push(`${at}: "${sentence}" not said once`);
			const drawn = await page.evaluate(() =>
				[
					...document.querySelectorAll(
						'main table.box tbody tr:not(.totals) td.pts, main table.lineup tbody tr:not(.totals) td.pts'
					)
				]
					.map((td) => (td as HTMLElement).innerText.trim())
					.filter((t) => /^-?\d+\.\d$/.test(t))
			);
			if (points !== drawn.length > 0)
				missing.push(`${at}: ${String(drawn.length)} players' points drawn`);
			if (screen === 'matchup') {
				const { bug, row } = await bugAgainstTotals(page);
				if (bug !== row) missing.push(`${at}: the bug reads ${bug}, its Totals ${row}`);
				if (bugIs !== null && bug !== bugIs)
					missing.push(`${at}: the bug reads ${bug}, not ${bugIs}`);
				basisCounts.push(`${at}: bug ${bug}, Totals ${row}`);
			}
			await page.screenshot({
				path: file(`${screen}-${shot}-dark-${String(width)}`),
				fullPage: true
			});
		}
		await ctx.close();
	}
}

/** ESPN's league on its Sunday afternoon (sunday.ts): its points by player, its Matchup's bug and
 * Totals ESPN's own score, its Lineup's Team the rows, no change offered on a locked player. */
await platformPass(
	FIXTURE_IDS.espnDone,
	[SUNDAY_WEEK],
	FIXTURE_SUNDAY_CLOCK,
	[
		{
			screen: 'matchup',
			basisName: 'matchup ESPN Sunday',
			sentence: ESPN_MATCHUP_PTS,
			points: true
		},
		{ screen: 'start', basisName: 'lineup ESPN Sunday', sentence: ESPN_PTS, points: true }
	],
	ESPN_SUNDAY_TOTAL,
	'espn-sunday'
);
{
	const ctx = await context('dark', 1440, FIXTURE_SUNDAY_CLOCK);
	await ctx.addCookies([{ ...SUNDAY_WEEK, domain: 'localhost', path: '/' }]);
	const page = await ctx.newPage();
	await page.goto(`${web}/league/${FIXTURE_IDS.espnDone}/start`, { waitUntil: 'networkidle' });
	await page.locator('main [data-basis]').first().waitFor({ timeout: READY_TIMEOUT_MS });
	// A change offered on a player whose game has kicked off would be refused: ESPN locks him.
	const moved = await page.evaluate(() =>
		[...document.querySelectorAll('main table.lineup tbody tr')]
			.filter((tr) => tr.querySelector('.mark.in, .mark.out') !== null)
			.map((tr) => tr.textContent)
	);
	for (const row of moved)
		if (/\bFinal\b|Sun 12:00 pm/.test(row))
			missing.push(`ESPN Sunday Lineup moves a locked player: ${row.slice(0, 60)}`);
	await ctx.close();
}

/** The Matchup after kickoff on the two other kinds of platform (re-review N3): Sleeper's score is
 * its rows added (39.1, the four starters under way), Yahoo's its own total (39.0), each the bug's
 * figure and its Totals row's. */
await platformPass(
	id,
	[SUNDAY_WEEK],
	FIXTURE_SUNDAY_CLOCK,
	[
		{
			screen: 'matchup',
			basisName: 'matchup Sleeper Sunday',
			sentence: SLEEPER_MATCHUP_PTS,
			points: true
		}
	],
	SLEEPER_SUNDAY_SUM,
	'sleeper-sunday'
);
await platformPass(
	id,
	[SUNDAY_WEEK, YAHOO_PLATFORM],
	FIXTURE_SUNDAY_CLOCK,
	[{ screen: 'matchup', basisName: 'matchup Yahoo Sunday', sentence: YAHOO_PTS, points: false }],
	ESPN_SUNDAY_TOTAL,
	'yahoo-sunday'
);

/** A platform that sends each team's total alone (Yahoo, yahoo.ts): its team-totals sentence once in
 * budget, no player's points, the bug and Totals its total. */
await platformPass(
	id,
	[YAHOO_PLATFORM],
	FIXTURE_WEEK_CLOCK,
	[
		{ screen: 'matchup', basisName: 'matchup Yahoo', sentence: YAHOO_PTS, points: false },
		{ screen: 'start', basisName: 'lineup Yahoo', sentence: YAHOO_PTS, points: false }
	],
	null,
	'yahoo'
);

/** "Which five" lands on the league's Settings with the rules our stats lack in view (Lane 66t review
 * 4): from Waivers on a phone, the card under the top bar, five rules listed. */
{
	const ctx = await context('dark', PHONE.width);
	const page = await ctx.newPage();
	await page.setViewportSize(PHONE);
	await page.goto(`${web}/league/${id}/waivers`, { waitUntil: 'networkidle' });
	await ready(page, 'Open Sleeper waivers');
	await page.locator('main [data-basis] a', { hasText: 'Which five' }).click();
	const card = page.locator(`#${UNCOUNTED_ANCHOR}`);
	await card.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.waitForTimeout(400);
	const landed = await page.evaluate((anchor: string) => {
		const box = document.getElementById(anchor)?.getBoundingClientRect();
		const bar = document.querySelector('header.top')?.getBoundingClientRect();
		return {
			url: location.pathname + location.search + location.hash,
			top: box?.top ?? -1,
			bottom: box?.bottom ?? -1,
			barBottom: bar?.bottom ?? 0,
			rules: document.querySelectorAll(`#${anchor} li`).length
		};
	}, UNCOUNTED_ANCHOR);
	if (
		!landed.url.endsWith(`?view=settings#${UNCOUNTED_ANCHOR}`) ||
		landed.top < landed.barBottom - 1 ||
		landed.top > PHONE.height ||
		landed.rules !== 5
	)
		missing.push(`Which five lands ${JSON.stringify(landed)}`);
	await page.screenshot({ path: file('which-five-landed-dark-390') });
	await ctx.close();
}

/** A marked add and a narrowed trade list, at both widths in the dark theme. */
for (const width of SHOT_WIDTHS) {
	const ctx = await context('dark', width);
	const page = await ctx.newPage();
	// The copy verb puts his name on the clipboard and opens the platform's page, kept off the network.
	await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
	await ctx.route('https://sleeper.com/**', (route) => route.abort());
	await page.goto(`${web}/league/${id}/waivers`, { waitUntil: 'networkidle' });
	await ready(page, 'Open Sleeper waivers');
	// Add opens the players he could replace, the advice's drop first.
	await page.locator('main button.add').first().click();
	await ready(page, 'Drop one for');
	await page.screenshot({ path: file(`waivers-drops-dark-${String(width)}`), fullPage: true });
	await page.locator('main tr.dgo').getByRole('button', { name: 'Open Sleeper waivers' }).click();
	await ready(page, "Add him on Sleeper's waiver page");
	const confirmed = await page.locator('main tr.dgo .why').innerText();
	if (!/^Copied \S+\. Add him on Sleeper's waiver page\.$/.test(confirmed.trim()))
		missing.push(`waivers copy confirm ${String(width)}: ${confirmed}`);
	await page.screenshot({ path: file(`waivers-copied-dark-${String(width)}`), fullPage: true });
	// A position chip reads the adds at that position again (?position=).
	await page.getByRole('button', { name: 'WR', exact: true }).click();
	await page.locator('.rows[aria-busy="false"]').waitFor({ timeout: READY_TIMEOUT_MS });
	await page.screenshot({ path: file(`waivers-wr-dark-${String(width)}`), fullPage: true });
	await page.goto(`${web}/league/${id}/trades`, { waitUntil: 'networkidle' });
	await ready(page, 'worth proposing');
	await page.getByRole('combobox').selectOption({ label: 'Patrick Mahomes' });
	await page.locator('.finder-wrap[aria-busy="false"]').waitFor({ timeout: READY_TIMEOUT_MS });
	await page.screenshot({ path: file(`trades-narrowed-dark-${String(width)}`), fullPage: true });
	await ctx.close();
}

/** An opened trade: its players in the box score's columns (Lane 66g), in both themes at both
 * widths, and every trade sorted by their week's change. */
const OPENED_HEADS = ['Give', 'Player', 'Game', 'Proj', 'Pts', 'Opp rank', 'Avg', 'Last', 'A game'];
const OPENED_HEADS_PHONE = ['Give', 'Player', 'Proj', 'A game'];
/** A name on a phone keeps to one line, and the game under it to one (review H2). */
const ONE_LINE_PX = 24;
for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		const ctx = await context(theme, width);
		const page = await ctx.newPage();
		await page.goto(`${web}/league/${id}/trades`, { waitUntil: 'networkidle' });
		await ready(page, 'worth proposing');
		await page.locator('table.finder button.why').first().click();
		await page.getByText('Build from this').first().waitFor({ timeout: READY_TIMEOUT_MS });
		const opened = await page.evaluate(() => ({
			heads: [...document.querySelectorAll('table.inner thead th')]
				.filter((th) => th.getBoundingClientRect().width > 1)
				.map((th) => (th as HTMLElement).innerText.trim()),
			sides: [...document.querySelectorAll('table.inner tbody td.slot')].map((td) =>
				(td as HTMLElement).innerText.trim()
			),
			week: document.querySelector<HTMLElement>('main .week-line')?.innerText.trim() ?? '',
			tallest: Math.max(
				0,
				...[...document.querySelectorAll('table.inner .nm, table.inner .phone-game .opp')].map(
					(el) => el.getBoundingClientRect().height
				)
			),
			// Each name as drawn, and whether its cell cuts it (rereview N2).
			names: [...document.querySelectorAll<HTMLElement>('table.inner .nm')].map((nm) => ({
				said: nm.innerText.trim(),
				cut: nm.scrollWidth > nm.clientWidth + 1
			}))
		}));
		if (width <= PHONE.width) {
			for (const { said, cut } of opened.names) {
				if (cut || !/^[A-Z]\. \S/.test(said))
					missing.push(
						`trades opened ${theme} ${String(width)} name "${said}"${cut ? ' cut' : ''}`
					);
			}
		}
		const want = width <= PHONE.width ? OPENED_HEADS_PHONE : OPENED_HEADS;
		if (opened.heads.join('|').toLowerCase() !== want.join('|').toLowerCase())
			missing.push(`trades opened ${theme} ${String(width)} heads ${opened.heads.join('|')}`);
		if (!opened.sides.includes('Give') || !opened.sides.includes('Get'))
			missing.push(`trades opened ${theme} ${String(width)} sides ${opened.sides.join('|')}`);
		if (!WEEK_LINE.test(opened.week))
			missing.push(`trades opened ${theme} ${String(width)} week "${opened.week}"`);
		// Opened, the basis adds the players' columns, each once, and stays in its budget (Lane 66t).
		const openedBasis = (await page.locator('main [data-basis]').first().textContent()) ?? '';
		if (!openedBasis.includes(PER_GAME_BASIS) || !openedBasis.includes('Which five'))
			missing.push(`trades opened ${theme} ${String(width)} basis ${openedBasis}`);
		const openedReport = basisReport('trades opened', width, await basisLines(page));
		for (const fault of await figureSentenceFaults(page))
			missing.push(`trades opened ${theme} ${String(width)} ${fault}`);
		if (openedReport !== null) {
			if (theme === 'dark') basisCounts.push(openedReport.line);
			if (openedReport.fault !== null) missing.push(`${theme} ${openedReport.fault}`);
		}
		if (opened.tallest > ONE_LINE_PX)
			missing.push(
				`trades opened ${theme} ${String(width)} a name or game wraps (${String(opened.tallest)}px)`
			);
		await page.screenshot({
			path: file(`trades-opened-${theme}-${String(width)}`),
			fullPage: true
		});
		// The opened trade's verb copies the offer and opens the platform's trade page, as the card's
		// does (review H1).
		await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
		const tab = ctx.waitForEvent('page');
		await page.locator('tr.opened .acts').getByText(TRADE_VERB).click();
		const opens = await tab;
		if (!opens.url().includes('sleeper.com'))
			missing.push(`trades opened ${theme} ${String(width)} verb opened ${opens.url()}`);
		await opens.close();
		await ready(page, 'Propose it on');
		if (width !== PHONE.width) {
			await page.locator('table.finder thead button.sort').nth(3).click();
			await page.screenshot({ path: file(`trades-sorted-${theme}-${String(width)}`) });
		}
		await ctx.close();
	}
}

/** A trade whose drop starts this week (Lane 66u, the fixture's one stand-in): its folded row says
 * "a starter" beside the drop at every width, and the opened trade says the API's whole sentence. */
const STARTER_DROP = /, a starter\b/;
const DROP_REASON =
	/^\S+ starts at [\w ]+ for you this week(, and \S+ takes that spot after the trade\.|\. After the trade \S+ starts at [\w ]+ and your lineup stays full\.)$/;
for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		const ctx = await context(theme, width);
		const page = await ctx.newPage();
		await page.goto(`${web}/league/${id}/trades`, { waitUntil: 'networkidle' });
		await ready(page, 'worth proposing');
		const row = page.locator('table.finder tr.trade').filter({ hasText: STARTER_DROP });
		if ((await row.count()) !== 1) {
			missing.push(
				`trades starter drop ${theme} ${String(width)}: ${String(await row.count())} rows say a starter`
			);
			await ctx.close();
			continue;
		}
		await row.locator('button.why').click();
		const why = (await page.locator('tr.opened .drop-why').first().innerText()).trim();
		if (!DROP_REASON.test(why))
			missing.push(`trades starter drop ${theme} ${String(width)} reason "${why}"`);
		await row.scrollIntoViewIfNeeded();
		await page.screenshot({ path: file(`trades-starter-drop-${theme}-${String(width)}`) });
		await ctx.close();
	}
}

/** The trade verb copies the offer and says where to propose it (Lane 66g), at both widths. */
for (const width of SHOT_WIDTHS) {
	const ctx = await context('dark', width);
	await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
	const page = await ctx.newPage();
	await page.goto(`${web}/league/${id}/trades`, { waitUntil: 'networkidle' });
	await ready(page, 'worth proposing');
	const tab = ctx.waitForEvent('page');
	await page.locator('main .card').first().getByText(TRADE_VERB).click();
	await (await tab).close();
	await ready(page, 'Propose it on');
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	if (!/^Trade with .+: .+ for .+\.$/.test(copied))
		missing.push(`trades copy ${String(width)}: ${copied}`);
	const said = await page.evaluate(
		() => document.querySelector<HTMLElement>('main .card .said')?.innerText.trim() ?? ''
	);
	if (said !== "Copied. Propose it on Sleeper's trade page.")
		missing.push(`trades copied ${String(width)}: "${said}"`);
	await page.screenshot({ path: file(`trades-copied-dark-${String(width)}`) });
	await ctx.close();
}

/** The loading rows and the API's refusal, in the light theme. */
for (const width of SHOT_WIDTHS) {
	const ctx = await context('light', width);
	const page = await ctx.newPage();
	await page.goto(`${web}/league/${FIXTURE_IDS.slow}/start`);
	await page.locator('.reserve').waitFor({ timeout: READY_TIMEOUT_MS });
	await page.screenshot({ path: file(`start-loading-light-${String(width)}`) });
	await page.goto(`${web}/league/${FIXTURE_IDS.outOfSeason}/waivers`, { waitUntil: 'networkidle' });
	await ready(page, 'no games this week');
	await page.screenshot({ path: file(`waivers-refused-light-${String(width)}`) });
	// A 404 for a team missing from the league's last read prints the API's sentence.
	await page.goto(`${web}/league/${FIXTURE_IDS.noTeam}/start`, { waitUntil: 'networkidle' });
	await ready(page, 'could not find your team');
	await page.screenshot({ path: file(`start-no-team-light-${String(width)}`) });
	// Any other segment under a league is the site's own not-found.
	await page.goto(`${web}/league/${id}/pool`, { waitUntil: 'networkidle' });
	await ready(page, 'Nothing lives at this address');
	await page.screenshot({ path: file(`unknown-screen-light-${String(width)}`) });
	await ctx.close();
}

/** The lineup move on an ESPN league (Lane 35), in both themes at both widths: the confirmation
 * naming the exact changes, then each answer (done, refused in ESPN's words, pending). On a phone the
 * pinned verb opens it. Each must not scroll sideways. */
const MOVES = [
	{ name: 'done', id: FIXTURE_IDS.espnDone, ready: 'Set on ESPN.' },
	{ name: 'refused', id: FIXTURE_IDS.espnRefused, ready: 'ESPN said:' },
	{ name: 'pending', id: FIXTURE_IDS.espnPending, ready: 'Check your lineup on ESPN' }
] as const;
for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		for (const move of MOVES) {
			const ctx = await context(theme, width);
			const page = await ctx.newPage();
			await page.goto(`${web}/league/${move.id}/start`, { waitUntil: 'networkidle' });
			await ready(page, 'Make these changes');
			await page
				.getByRole('button', { name: 'Make these changes' })
				.filter({ visible: true })
				.first()
				.click();
			await ready(page, 'on ESPN now.');
			if (move.name === 'done') {
				await page.screenshot({ path: file(`start-move-confirm-${theme}-${String(width)}`) });
			}
			await page.locator('#lineup-move').getByRole('button', { name: 'Set it on ESPN' }).click();
			await ready(page, move.ready);
			const wide = await page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth
			);
			if (wide) scrolls.push(`start move ${move.name} ${theme} ${String(width)}`);
			await page.screenshot({ path: file(`start-move-${move.name}-${theme}-${String(width)}`) });
			await ctx.close();
		}
	}
}

/** Every word a member reads on a screen against the site's one copy guard, "host" among its words
 * (the member's platform is named instead, Lane 66e), with the names and rows the API handed the
 * page skipped (ruling R3): the banned word found, or none. */
async function bannedSaid(page: Page): Promise<string[]> {
	const fault = await copyFault(page);
	return fault === null ? [] : [fault];
}

/** What is wrong with the Waivers table at a width, as sentences; none when it holds. */
async function waiverFaults(page: Page, width: number): Promise<string[]> {
	const seen = await page.evaluate(() => {
		const table = document.querySelector('main table.pool');
		const text = (el: Element): string => (el as HTMLElement).innerText.trim();
		const rows = [...(table?.querySelectorAll('tbody tr:not(.dsect):not(.dgo)') ?? [])];
		return {
			heads: [...(table?.querySelectorAll('thead th') ?? [])].map(text).filter((h) => h !== ''),
			proj: rows.map((tr) => text(tr.querySelector('td.proj') ?? tr)),
			rest: rows.map((tr) => tr.querySelector('td.rest')?.textContent.trim() ?? ''),
			tinted: rows.filter((tr) => tr.classList.contains('moved-in')).length,
			cards: document.querySelectorAll('main .pickups .pickup').length,
			count: document.querySelector('main .count')?.textContent ?? '',
			basis: document.querySelector('main [data-basis]')?.textContent.trim() ?? '',
			phoneRest: rows.some((tr) => /A game (\d+\.\d|--)/.test(text(tr)))
		};
	});
	const faults: string[] = [];
	const heads =
		width <= PHONE.width ? WAIVER_PHONE : width <= EVIDENCE_FOLDS_AT ? WAIVER_FOLDED : WAIVER_HEADS;
	if (seen.heads.join(' ').toLowerCase() !== heads.join(' ').toLowerCase())
		faults.push(`heads ${seen.heads.join(' ')}`);
	if (seen.proj.length === 0 || !seen.proj.every((n) => BOX_NUMBER.test(n)))
		faults.push(`proj ${seen.proj.join(' ')}`);
	if (width > EVIDENCE_FOLDS_AT && !seen.rest.every((n) => BOX_NUMBER.test(n)))
		faults.push(`rest of season ${seen.rest.join(' ')}`);
	if (width <= EVIDENCE_FOLDS_AT && !seen.phoneRest) faults.push('no A game under a name');
	if (seen.cards === 0 || seen.tinted !== seen.cards)
		faults.push(`${String(seen.tinted)} rows tinted for ${String(seen.cards)} cards`);
	if (
		width > PHONE.width &&
		!/^\d+ free agents? we rank on Sleeper, \d+ beats? a player of yours$/.test(seen.count)
	)
		faults.push(`count ${seen.count}`);
	// Beats and Open spot say themselves in their cells (Lane 66t); Gain and A game are said once.
	if (/Beats is|Open spot is/.test(seen.basis)) faults.push('basis explains Beats');
	if (!seen.basis.includes(PER_GAME_BASIS) || !seen.basis.includes('Which five'))
		faults.push(`basis ${seen.basis}`);
	if (!seen.basis.startsWith(PICKUP_RULE)) faults.push(`basis first ${seen.basis}`);
	for (const word of await bannedSaid(page)) faults.push(`says ${word}`);
	return faults;
}

/** What the Lineup table must hold (Lane 66e): every evidence cell printed as its column prints, a
 * swap's chip for every row moved in, each with its arrow and its button, its evidence line opening
 * on a tap, the bench arrow reading Sit, the evidence basis said once, and the copy verb with the
 * platform's line under it. */
async function lineupFaults(page: Page): Promise<string[]> {
	const faults: string[] = [];
	const seen = await page.evaluate(() => {
		const table = document.querySelector('main table.lineup');
		const rows = [...(table?.querySelectorAll('tbody tr') ?? [])];
		const cell = (el: Element) => (el as HTMLElement).innerText.trim();
		return {
			evidence: rows
				.flatMap((tr) => [...tr.querySelectorAll('td.ev')].map(cell))
				.filter((t) => t !== ''),
			movedIn: rows.filter((tr) => tr.classList.contains('moved-in')).length,
			arrowsIn: rows.filter((tr) => tr.querySelector('td.slot .mark.in')).length,
			whyButtons: rows.filter((tr) => tr.querySelector('button.why')).length,
			outSlots: rows
				.filter((tr) => tr.classList.contains('moved-out'))
				.map((tr) => cell(tr.querySelector('td.slot') ?? tr)),
			chips: document.querySelectorAll('main .swaps .swap:not(.idle)').length,
			idleChips: [...document.querySelectorAll('main .swaps .swap.idle')].map(
				(el) => (el as HTMLElement).innerText
			),
			idleRows: rows.filter((tr) => tr.classList.contains('idle')).length,
			firstChipIdle:
				document.querySelector('main .swaps .swap')?.classList.contains('idle') ?? false,
			reason: [...document.querySelectorAll('main .verb .verb-line')]
				.map((el) => (el as HTMLElement).innerText)
				.join(' '),
			second: document.querySelector('main .verb a.second[href^="http"]') !== null,
			reserve: rows.some((tr) => tr.textContent.includes('Injured reserve')),
			// The phone draws no Δ Proj column, so its basis says nothing of it.
			wide: window.innerWidth > 760,
			text: document.querySelector<HTMLElement>('main')?.innerText ?? ''
		};
	});
	const visible = seen.evidence.filter((t) => t !== '');
	if (visible.length > 0 && !visible.every((t) => EVIDENCE_CELL.test(t)))
		faults.push(`evidence cells ${visible.join(' ')}`);
	if (seen.movedIn === 0) faults.push('no row moved in');
	if (seen.chips !== seen.movedIn)
		faults.push(`${String(seen.chips)} chips for ${String(seen.movedIn)} rows moved in`);
	if (seen.arrowsIn !== seen.movedIn) faults.push('a row moved in without its arrow');
	if (seen.whyButtons !== seen.movedIn) faults.push('a row moved in without its evidence button');
	if (seen.outSlots.length === 0 || seen.outSlots.some((s) => s !== 'Sit'))
		faults.push(`the bench arrows read ${seen.outSlots.join(', ')}`);
	if (!seen.reserve) faults.push('no injured reserve section');
	// The fixture's TE spot has no one who can play (review N1 to N4): its chip first, its row kept.
	if (
		seen.idleChips.length !== 1 ||
		!seen.idleChips.every((c) => c.endsWith('no one on your roster can play this week'))
	)
		faults.push(`the no one can play chips: ${seen.idleChips.join(', ')}`);
	if (!seen.firstChipIdle) faults.push('the no one can play chip is not first');
	if (seen.idleRows !== 1) faults.push(`${String(seen.idleRows)} rows marked no one can play`);
	// Our rank and Opp rank share one sentence on the Lineup (Lane 99 fix round 1).
	if ((seen.text.match(/Opp rank the points allowed to it, 1st fewest/g) ?? []).length !== 1)
		faults.push('the evidence basis not said once');
	if (!/Δ Proj is its change since \w{3} \d+:\d\d [ap]m\./.test(seen.text) && seen.wide)
		faults.push('the change basis');
	if (!seen.text.includes('Which five')) faults.push('no link to the rules our stats lack');
	// The rule for our pick is said under the rows at a desk; the phone's strip says whose lineup it
	// is (Lane 99 fix round 1).
	if (seen.wide && !seen.text.includes('Our pick starts the highest Proj at each slot.'))
		faults.push('the advice basis');
	// The line under the copy verb is the API's reason: only that it names the platform is checked, so
	// a change in the API's words changes nothing here (review H1).
	if (!seen.reason.includes('Sleeper')) faults.push(`the copy verb's line: ${seen.reason}`);
	if (!seen.second) faults.push("no link to the platform's lineup page beside the copy verb");
	if (/\bpaste\b/i.test(seen.text)) faults.push('a paste no platform takes');
	await page.locator('button.why').filter({ visible: true }).first().click();
	const why = await page.locator('tr.whyline').first().innerText();
	if (!/Proj against \S+'s \d+\.\d|is on bye\.|is listed /.test(why))
		faults.push(`the evidence line: ${why}`);
	await page.locator('button.why').filter({ visible: true }).first().click();
	return faults;
}

/** The copy verb, in the dark theme at both widths: once pressed it says to set the lineup on the
 * platform's lineup page, the page its link (review H2). */
for (const width of SHOT_WIDTHS) {
	const ctx = await context('dark', width);
	await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
	const page = await ctx.newPage();
	await page.goto(`${web}/league/${id}/start`, { waitUntil: 'networkidle' });
	await ready(page, 'Copy the lineup');
	await page.locator('button.why').filter({ visible: true }).first().click();
	await page.screenshot({ path: file(`start-why-dark-${String(width)}`) });
	await page
		.getByRole('button', { name: 'Copy the lineup' })
		.filter({ visible: true })
		.first()
		.click();
	await ready(page, 'Copied.');
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	if (!copied.startsWith('Week 6 lineup\nQB '))
		missing.push(`start copy ${String(width)}: ${copied}`);
	const after = await page.evaluate(() => {
		const foot = [...document.querySelectorAll('main .verb-line')].find(
			(el) => (el as HTMLElement).offsetParent !== null
		);
		return {
			text: (foot as HTMLElement | undefined)?.innerText ?? '',
			link: foot?.querySelector('a[href^="http"]')?.textContent ?? ''
		};
	});
	if (!/^Copied\. Set it on .*Sleeper.*\.$/.test(after.text) || !after.link.includes('Sleeper'))
		missing.push(`start copied ${String(width)}: "${after.text}" link "${after.link}"`);
	await page.screenshot({ path: file(`start-copied-dark-${String(width)}`) });
	await ctx.close();
}

/** The claim on an ESPN league (Lane 39), in both themes at both widths: the row's Add opens the
 * confirmation naming the add and the drop (with the bid field where the league bids), then each
 * answer (done, refused in ESPN's words, pending with when ESPN runs it). Each must not scroll
 * sideways. */
const CLAIMS = [
	{ name: 'done', id: FIXTURE_IDS.espnDone, plan: 'a free agent', ready: 'Done on ESPN.' },
	{ name: 'refused', id: FIXTURE_IDS.espnRefused, plan: 'on waivers', ready: 'ESPN said:' },
	{
		name: 'pending',
		id: FIXTURE_IDS.espnPending,
		plan: 'Your bid in waiver dollars',
		ready: 'Claim submitted.'
	}
] as const;
for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		for (const claim of CLAIMS) {
			const ctx = await context(theme, width);
			const page = await ctx.newPage();
			await page.goto(`${web}/league/${claim.id}/waivers`, { waitUntil: 'networkidle' });
			await ready(page, 'Add on ESPN');
			await page
				.getByRole('button', { name: 'Add on ESPN' })
				.filter({ visible: true })
				.first()
				.click();
			await ready(page, claim.plan);
			await page.screenshot({
				path: file(`waivers-claim-confirm-${claim.name}-${theme}-${String(width)}`)
			});
			await page.locator('#claim-move').getByRole('button', { name: 'Claim on ESPN' }).click();
			await ready(page, claim.ready);
			const wide = await page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth
			);
			if (wide) scrolls.push(`waivers claim ${claim.name} ${theme} ${String(width)}`);
			await page.screenshot({
				path: file(`waivers-claim-${claim.name}-${theme}-${String(width)}`)
			});
			await ctx.close();
		}
	}
}

/** The trade picker with a player of yours no trade holds, and the no-team state with its verb that
 * reads the host again, in both themes at both widths. */
for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		const ctx = await context(theme, width);
		const page = await ctx.newPage();
		await page.goto(`${web}/league/${id}/trades`, { waitUntil: 'networkidle' });
		await ready(page, 'worth proposing');
		const kicker = await page.locator('optgroup[label="Your players"] option').last().textContent();
		await page.getByRole('combobox').selectOption({ label: kicker ?? '' });
		await ready(page, 'No trade we found includes');
		await page.screenshot({ path: file(`trades-no-trade-${theme}-${String(width)}`) });
		await page.goto(`${web}/league/${FIXTURE_IDS.noTeam}/waivers`, { waitUntil: 'networkidle' });
		await ready(page, 'Read Sleeper now');
		await page.screenshot({ path: file(`waivers-no-team-${theme}-${String(width)}`) });
		await ctx.close();
	}
}

/** The trade builder (Lane 61) as two box scores (Lane 66g), in both themes at both widths: Build a
 * trade opens it empty, a tick a side reads the answer and lights the scoreboard's figures, a finder
 * row's Build from this opens it with that trade and answers the row's own two gains, one player
 * changed reads it again, and giving both tight ends says the TE would not be filled. Each must not
 * scroll sideways. */
const builder = '#trade-builder';
/** The gains in an answer line: its figures before the players it names with their points a game. */
const gainsOf = (text: string): string[] =>
	[...(text.split(' You give ')[0] ?? '').matchAll(/\d+\.\d/g)].map((m) => m[0]);
async function answered(page: Page): Promise<string> {
	const line = page.locator(`${builder} .words[aria-busy="false"] .line`);
	await line.waitFor({ timeout: READY_TIMEOUT_MS });
	return (await line.textContent()) ?? '';
}
/** A side's box: the member's first, theirs second. */
const sideBox = (page: Page, side: 'give' | 'get') =>
	page.locator(`${builder} table.box`).nth(side === 'give' ? 0 : 1);
async function tapSide(page: Page, side: 'give' | 'get', name: string): Promise<void> {
	await sideBox(page, side)
		.locator('tbody tr')
		.filter({ hasText: name })
		.locator('button.tick')
		.first()
		.click();
}
/** The scoreboard's figures once answered: each a figure to the tenth, the week's (each side's Proj
 * before and after, the first figure of the two) "--" exactly when a ticked player's game has kicked off
 * or is final, the trade counting from next week (Lane 85). */
async function bugFaults(page: Page): Promise<string[]> {
	const figures = (
		await page.locator(`${builder} .bug .fig b, ${builder} .bug .fig i`).allInnerTexts()
	).map((f) => f.trim());
	const ticked = await page
		.locator(`${builder} table.box tbody tr`)
		.filter({ has: page.locator('button.tick.on') })
		.allInnerTexts();
	const past = ticked.some((row) => /\b(Final|Kicked off)\b/.test(row));
	const tenth = (f: string): boolean => /^−?\d+\.\d$/.test(f);
	// Each side draws Proj before and after, then the season's before and after.
	const week = (i: number): boolean => i % 4 < 2;
	const fine =
		figures.length === 8 && figures.every((f, i) => (week(i) && past ? f === '--' : tenth(f)));
	return fine ? [] : [`scoreboard ${figures.join(' ')}${past ? ' (a ticked game is past)' : ''}`];
}
const builderLines = new Map<string, string>();
for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		const ctx = await context(theme, width);
		const page = await ctx.newPage();
		const at = `${theme} ${String(width)}`;
		const shot = async (name: string): Promise<void> => {
			const wide = await page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth
			);
			if (wide) scrolls.push(`trades builder ${name} ${at}`);
			await page.screenshot({
				path: file(`trades-builder-${name}-${theme}-${String(width)}`),
				fullPage: name !== 'pinned'
			});
		};
		await page.goto(`${web}/league/${id}/trades`, { waitUntil: 'networkidle' });
		await ready(page, 'worth proposing');
		await page.getByRole('button', { name: 'Build a trade' }).click();
		await ready(page, 'Pick one or two of your players and one or two of theirs.');
		await shot('open');
		const yours = sideBox(page, 'give').locator('button.tick');
		const theirs = sideBox(page, 'get').locator('button.tick');
		await yours.nth(1).click();
		await theirs.first().click();
		const picked = await answered(page);
		builderLines.set(`picked ${at}`, picked);
		if (!/You give .+ for .+\(\d+\.\d a game\)\./.test(picked)) {
			missing.push(`builder answer ${at}: ${picked}`);
		}
		for (const fault of await bugFaults(page)) missing.push(`builder ${at} ${fault}`);
		await shot('picked');
		// The builder's own line, then the page's basis with its players' columns (Lane 66t).
		const builderReport = basisReport('trades builder', width, await basisLines(page));
		for (const fault of await figureSentenceFaults(page)) missing.push(`builder ${at} ${fault}`);
		const ownLines = await basisLines(page, BUILDER_LINE);
		const ownLine = (await page.locator(BUILDER_LINE).textContent()) ?? '';
		if (builderReport !== null) {
			if (theme === 'dark')
				basisCounts.push(`${builderReport.line}, its own line ${String(ownLines)}`);
			if (builderReport.fault !== null) missing.push(`${theme} ${builderReport.fault}`);
		}
		if (ownLines === 0 || ownLines > 2 || !ownLine.includes('What the figures are'))
			missing.push(`builder ${at} own line ${String(ownLines)} lines: ${ownLine}`);
		if (width === PHONE.width) {
			// The gains and the verb stay pinned while the member scrolls the rosters.
			await page.setViewportSize(PHONE);
			await theirs.last().scrollIntoViewIfNeeded();
			const pinned = await page.locator(`${builder} .pin`).isVisible();
			if (!pinned) missing.push(`builder ${at} nothing pinned`);
			await shot('pinned');
			await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
		}
		// A finder row opens the builder with its trade, and answers the row's own gains.
		await page.getByRole('button', { name: 'Not now' }).click();
		const row = page.locator('table.finder tr.trade').first();
		const rowGains = (await row.locator('td.g').allInnerTexts()).map((g) =>
			g.trim().replace(/^[+−]/, '')
		);
		await row.locator('button.why').click();
		await page.getByRole('button', { name: 'Build from this' }).first().click();
		// Opened with both sides held, the line says it is checking, never to pick a player.
		const first = (await page.locator(`${builder} .words .line`).textContent()) ?? '';
		if (/pick one or two/i.test(first)) {
			throw new Error(`A filled builder asked to pick: ${first}`);
		}
		const fromRow = await answered(page);
		builderLines.set(`from a row ${at}`, fromRow);
		if (gainsOf(fromRow).join(' ') !== rowGains.join(' ')) {
			throw new Error(`The builder answered ${fromRow} for a finder row of ${rowGains.join(', ')}`);
		}
		await shot('from-row');
		// One player changed reads the trade again.
		await theirs.and(page.locator('[aria-pressed="true"]')).first().click();
		await theirs.and(page.locator('[aria-pressed="false"]:not([disabled])')).first().click();
		builderLines.set(`changed ${at}`, await answered(page));
		await shot('changed');
		// Both tight ends given: the member's TE would not be filled.
		await page.getByRole('button', { name: 'Not now' }).click();
		await page.getByRole('button', { name: 'Build a trade' }).click();
		await tapSide(page, 'give', 'Chig Okonkwo');
		await tapSide(page, 'give', 'Sam LaPorta');
		await theirs.first().click();
		const short = await answered(page);
		builderLines.set(`short ${at}`, short);
		if (short !== 'Your roster would not fill TE.') {
			throw new Error(`Giving both tight ends answered ${short}`);
		}
		// Two given: the side says why its other rows wait, in words, not a tooltip.
		await sideBox(page, 'give')
			.locator('.holds')
			.getByText('Two picked, tap one to put him back')
			.waitFor({ timeout: READY_TIMEOUT_MS });
		await shot('short');
		await ctx.close();
	}
}

/** The league page in each season phase (spec 2026-10-16 §3), the follow page a rail item opens
 * with no league, and the account's Next draft rows in season, in both themes at both widths. */
const STATES = [
	{
		name: 'league-pre-draft',
		path: `/league/${FIXTURE_IDS.preDraft}`,
		ready: 'The site turns to your season'
	},
	{ name: 'league-draft-day', path: `/league/${FIXTURE_IDS.draftDay}`, ready: 'Open the Advisor' },
	{
		name: 'league-playoffs',
		path: `/league/${FIXTURE_IDS.playoffs}`,
		ready: 'Every game this week, yours first.'
	},
	{ name: 'league-offseason', path: `/league/${FIXTURE_IDS.offseason}`, ready: 'finished' },
	{
		name: 'follow-for-lineup',
		path: '/league/new?screen=start',
		ready: 'to see your lineup each week'
	},
	{ name: 'account-next-draft', path: '/account', ready: 'Next draft' }
] as const;
for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		for (const state of STATES) {
			const ctx = await context(theme, width);
			const page = await ctx.newPage();
			await page.goto(`${web}${state.path}`, { waitUntil: 'networkidle' });
			await ready(page, state.ready);
			const wide = await page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth
			);
			if (wide) scrolls.push(`${state.name} ${theme} ${String(width)}`);
			await page.screenshot({
				path: file(`${state.name}-${theme}-${String(width)}`),
				fullPage: true
			});
			await ctx.close();
		}
	}
}

/** The League page (Lane 66i): the recorded Sleeper league before kickoff, and the ESPN fixture on
 * a Sunday afternoon whose points are a stand-in (league.ts makes them up so the played states can be
 * drawn; its shots say so in their names), the week and the settings, both themes at both widths. */
/** The basis's drawn lines at most: five at a desk, eight in a hand. */
const MAX_BASIS_LINES = 5;
const MAX_BASIS_LINES_PHONE = 8;
const LEAGUE_PAGES = [
	{
		name: 'league-week',
		league: id,
		live: false,
		platform: 'Sleeper',
		waiver: 'FAAB',
		moves: true,
		rules: 41
	},
	{
		name: 'league-sunday-standin',
		league: FIXTURE_IDS.espnDone,
		live: true,
		platform: 'ESPN',
		waiver: 'Waiver',
		moves: false,
		rules: 39
	}
] as const;
type LeaguePage = (typeof LEAGUE_PAGES)[number];
const STANDIN_CAPTION =
	'league-sunday-standin: the ESPN fixture on a Sunday afternoon. Its points so far are a stand-in, made up from the projection.';

async function leagueFaults(page: Page, lp: LeaguePage, width: number): Promise<string[]> {
	const seen = await page.evaluate(() => {
		const text = (el: Element | null): string => el?.textContent.trim() ?? '';
		const bugs = [...document.querySelectorAll('main .bug')];
		const visible = (el: Element): boolean => getComputedStyle(el).display !== 'none';
		const basis = [...document.querySelectorAll('main .basis p')];
		return {
			bugs: bugs.length,
			mineFirst: bugs[0]?.classList.contains('mine') ?? false,
			bugHeads: bugs.map((b) => text(b.querySelector('.st'))),
			stands: bugs.map((b) =>
				[...b.querySelectorAll('.bt')].map((s) =>
					s.classList.contains('ahead')
						? 'ahead'
						: s.classList.contains('behind')
							? 'behind'
							: 'level'
				)
			),
			heads: [...document.querySelectorAll('main table.standings thead th')]
				.filter(visible)
				.map((th) => text(th)),
			teams: document.querySelectorAll('main table.standings tbody tr:not(.rule)').length,
			rule: text(document.querySelector('main table.standings tr.rule')),
			verb: [...document.querySelectorAll('main a')].some((a) => text(a) === 'Set your lineup'),
			bench: [...document.querySelectorAll('main a.bench')].map(
				(a) => a.getAttribute('href') ?? ''
			),
			feed: document.querySelector('main table.feed') !== null,
			nobody: (document.querySelector('main')?.textContent ?? '').includes('Nobody in your league'),
			// The recorded league's name anywhere on the page, the switch included.
			recordedName: document.body.textContent.includes('S.U.C.K.'),
			bids: [...document.querySelectorAll('main table.feed td.det')].filter((td) =>
				/^FAAB \$\d/.test(text(td))
			).length,
			basisText: basis.map((p) => text(p)).join(' '),
			// The lineup card's changes, each a chip naming the player it starts.
			chips: [...document.querySelectorAll('main .swaps li:not(.idle)')].map((c) => text(c)),
			// The basis's rendered lines: each paragraph's height over its line height.
			basisLines: basis.reduce((n, p) => {
				const style = getComputedStyle(p);
				return n + Math.round(p.getBoundingClientRect().height / parseFloat(style.lineHeight));
			}, 0)
		};
	});
	const faults: string[] = [];
	if (seen.bugs !== 6 || !seen.mineFirst)
		faults.push(`${String(seen.bugs)} bugs, yours first ${String(seen.mineFirst)}`);
	const started = seen.stands.filter((s) => s.some((x) => x !== 'level'));
	if (lp.live && started.length === 0)
		faults.push('no bug draws the side ahead once its game started');
	// A bug before its first kickoff draws both sides alike; one kicked off (Thursday's games on the
	// Saturday, Lane 85) may draw a side ahead.
	const before = seen.stands.filter((_, i) => !/^(Kicked off|Final)$/.test(seen.bugHeads[i] ?? ''));
	if (before.some((s) => s.some((x) => x !== 'level')))
		faults.push('a bug before kickoff draws one side ahead');
	if (lp.live && started.some((s) => !(s.includes('ahead') && s.includes('behind'))))
		faults.push('a started bug without one side ahead and one behind');
	const want =
		width === PHONE.width
			? ['#', 'Team', 'W-L-T', 'PF', 'Proj']
			: ['#', 'Team', 'W-L-T', 'PF', 'PA', 'Streak', 'Proj', lp.waiver];
	if (seen.heads.join(' ') !== want.join(' '))
		faults.push(`standings heads ${seen.heads.join(' ')}`);
	if (seen.teams !== 12) faults.push(`${String(seen.teams)} standings rows`);
	if (seen.rule !== 'Top 6 by record, playoffs weeks 15 to 17')
		faults.push(`playoff rule "${seen.rule}"`);
	if (!lp.live && !seen.verb) faults.push('no Set your lineup verb');
	if (seen.bench.length !== 1 || !seen.bench[0]?.endsWith('/start#bench'))
		faults.push(`bench link ${seen.bench.join(' ')}`);
	if (lp.moves && (!seen.feed || seen.bids === 0)) faults.push('no moves with a bid');
	if (!lp.moves && seen.feed) faults.push('a moves feed where the platform gives none');
	if (!lp.moves && !seen.basisText.includes(`${lp.platform} gives no move history to us.`))
		faults.push('the basis does not say the moves are not read');
	if (!lp.moves && seen.nobody) faults.push('says nobody moved where moves are not read');
	if (!seen.basisText.startsWith(`Standings follow ${lp.platform}'s record, then points for.`))
		faults.push(`basis "${seen.basisText.slice(0, 60)}"`);
	const most = width === PHONE.width ? MAX_BASIS_LINES_PHONE : MAX_BASIS_LINES;
	if (seen.basisLines === 0 || seen.basisLines > most)
		faults.push(`the basis draws ${String(seen.basisLines)} lines, at most ${String(most)}`);
	if (lp.live && seen.recordedName)
		faults.push('the ESPN stand-in names the recorded Sleeper league');
	if (lp.live) {
		// No move offered on a player whose game has kicked off: ESPN would refuse it.
		for (const name of SUNDAY_MOVES.locked)
			if (seen.chips.some((c) => c.includes(name))) faults.push(`offers a move on ${name}, locked`);
		for (const name of SUNDAY_MOVES.offered)
			if (!seen.chips.some((c) => c.includes(name))) faults.push(`does not offer ${name}`);
	}
	return faults;
}

async function settingsFaults(page: Page, lp: LeaguePage): Promise<string[]> {
	const seen = await page.evaluate(() => ({
		lead: document.querySelector('main .settings .lead p')?.textContent.trim() ?? '',
		notes: [...document.querySelectorAll('main .settings .note')].map((n) => n.textContent.trim()),
		unstatedFigures: [...document.querySelectorAll('main .settings .unstated .fig')].length,
		unstated: document.querySelectorAll('main .settings tr.unstated').length
	}));
	const faults: string[] = [];
	if (!seen.lead.startsWith(`${String(lp.rules)} rules as ${lp.platform} states them.`))
		faults.push(`settings say "${seen.lead}"`);
	if (seen.unstated === 0) faults.push('no unstated rule drawn');
	if (seen.unstatedFigures > 0) faults.push('an unstated rule prints a figure');
	if (!seen.notes.some((n) => n.startsWith(`${lp.platform} does not state`)))
		faults.push('no note on the unstated rules');
	return faults;
}

for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		for (const lp of LEAGUE_PAGES) {
			const ctx = await context(theme, width, lp.live ? FIXTURE_SUNDAY_CLOCK : FIXTURE_WEEK_CLOCK);
			// The live page is the Sunday's throughout: its scoreboard, its read and its lineup advice
			// (re-review N2).
			if (lp.live) await ctx.addCookies([{ ...SUNDAY_WEEK, domain: 'localhost', path: '/' }]);
			const page = await ctx.newPage();
			await page.goto(`${web}/league/${lp.league}`, { waitUntil: 'networkidle' });
			await ready(page, 'Every game this week, yours first.');
			const at = `${lp.name} ${theme} ${String(width)}`;
			for (const fault of await leagueFaults(page, lp, width)) missing.push(`${at} ${fault}`);
			for (const word of await bannedSaid(page)) missing.push(`${at} says ${word}`);
			if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
				scrolls.push(at);
			await page.screenshot({ path: file(`${lp.name}-${theme}-${String(width)}`), fullPage: true });
			await page.screenshot({ path: file(`${lp.name}-first-${theme}-${String(width)}`) });
			if (width === PHONE.width && !lp.live) {
				await page.setViewportSize(PHONE);
				const fold = await page.evaluate(() => {
					const row = document
						.querySelector('main table.standings tbody tr')
						?.getBoundingClientRect();
					const pin = document.querySelector('main .roster .pinned')?.getBoundingClientRect();
					return { rowBottom: row?.bottom ?? Infinity, pinTop: pin?.top ?? 0 };
				});
				firstRows.set(
					`league ${theme}`,
					`first row ends ${fold.rowBottom.toFixed(0)}px, pin starts ${fold.pinTop.toFixed(0)}px`
				);
				if (fold.rowBottom > fold.pinTop) under.push(`league ${theme}`);
				await page.screenshot({ path: file(`league-phone-${theme}`) });
				await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
			}
			// The tabs move with the arrow keys, as tabs do.
			await page.getByRole('tab', { selected: true }).focus();
			await page.keyboard.press('ArrowRight');
			await ready(page, `rules as ${lp.platform} states them`);
			for (const fault of await settingsFaults(page, lp)) missing.push(`${at} ${fault}`);
			for (const word of await bannedSaid(page)) missing.push(`${at} settings say ${word}`);
			if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
				scrolls.push(`${at} settings`);
			await page.screenshot({
				path: file(`${lp.name.replace('league-', 'league-settings-')}-${theme}-${String(width)}`),
				fullPage: true
			});
			await ctx.close();
		}
	}
}
/** The phone's way home (Lane 66t): on a league page the site mark leads the top bar and opens the
 * front door, and the bottom bar keeps its five on one row. */
for (const theme of THEMES) {
	const ctx = await context(theme, PHONE.width);
	const page = await ctx.newPage();
	await page.setViewportSize(PHONE);
	await page.goto(`${web}/league/${id}/trades`, { waitUntil: 'networkidle' });
	await ready(page, 'worth proposing');
	const bar = await page.evaluate(() => {
		const home = document.querySelector<HTMLAnchorElement>('header.top a.home');
		const account = document.querySelector('header.top a.account')?.getBoundingClientRect();
		const box = home?.getBoundingClientRect();
		const items = [...document.querySelectorAll('nav.rail a.item')].filter(
			(a) => a.getBoundingClientRect().width > 1
		);
		return {
			href: home?.getAttribute('href') ?? null,
			sameRow: box !== undefined && account !== undefined && Math.abs(box.top - account.top) < 4,
			target: box === undefined ? 0 : Math.min(box.width, box.height),
			items: items.length,
			rows: new Set(items.map((a) => Math.round(a.getBoundingClientRect().top))).size
		};
	});
	if (bar.href !== '/' || !bar.sameRow || bar.target < 44)
		missing.push(`the phone's mark ${theme}: ${JSON.stringify(bar)}`);
	if (bar.items !== 5 || bar.rows !== 1)
		missing.push(
			`the phone's bottom bar ${theme}: ${String(bar.items)} items on ${String(bar.rows)} rows`
		);
	await page.screenshot({
		path: file(`topbar-${theme}-390`),
		clip: { x: 0, y: 0, width: 390, height: 200 }
	});
	await ctx.close();
}

/** A league name long enough for three lines at 390 (the first-timer's note, Lane 83): it draws two,
 * cut on the second, on every league page. The fixture's answers carry it in place of the
 * recorded name. */
const RECORDED_NAME = 'S.U.C.K. - Severely Underrated Carolina Keepers';
const LONG_NAME = `${RECORDED_NAME} of the Piedmont and the Lowcountry Dynasty Association`;
for (const width of SHOT_WIDTHS) {
	const ctx = await context('dark', width);
	await ctx.route(`${API_ORIGIN}/**`, async (route) => {
		const response = await route.fetch();
		const body = (await response.text()).replaceAll(RECORDED_NAME, LONG_NAME);
		await route.fulfill({ response, body });
	});
	const page = await ctx.newPage();
	for (const { name, path, ready: text } of PAGES) {
		await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
		await ready(page, text);
		const chrome = await chromeMeasures(page);
		const at = `${name} long name dark ${String(width)}`;
		chromeLines.push(chromeLine(at, chrome));
		for (const fault of chromeFaults(chrome, width === PHONE.width, width === PHONE.width))
			missing.push(`${at} ${fault}`);
		if (width === PHONE.width)
			await page.screenshot({ path: file(`${name}-long-name-first-dark-390`) });
	}
	await ctx.close();
}

/** In season with no league (Lane 83): signed out, the season's rail with no league selected draws
 * League first and none of the four screens, on the phone's five and at a desk. */
const NO_LEAGUE_LABELS = ['League', 'Rest of season', 'Players', 'Mock draft', 'Our record'];
for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		const ctx = await context(theme, width);
		await ctx.clearCookies();
		const page = await ctx.newPage();
		await page.goto(`${web}/mock/new`, { waitUntil: 'networkidle' });
		await page.evaluate(() => document.fonts.ready);
		const chrome = await chromeMeasures(page);
		const at = `no league ${theme} ${String(width)}`;
		if (theme === 'dark') chromeLines.push(chromeLine(at, chrome));
		const labels = width === PHONE.width ? NO_LEAGUE_LABELS : [...NO_LEAGUE_LABELS, 'Account'];
		if (chrome.rail !== 'in_season' || chrome.league)
			missing.push(`${at}: the rail is ${String(chrome.rail)}, a league ${String(chrome.league)}`);
		if (chrome.railLabels.join('|') !== labels.join('|'))
			missing.push(`${at}: the rail draws ${chrome.railLabels.join(', ')}`);
		const measured = await pageMeasures(page);
		if (theme === 'dark') chromeLines.push(pageLine(at, measured));
		for (const fault of pageFaults(measured, width === PHONE.width, 1))
			missing.push(`${at} ${fault}`);
		await page.screenshot({ path: file(`no-league-mock-${theme}-${String(width)}`) });
		await ctx.close();
	}
}

for (const said of basisCounts) process.stdout.write(`${said}\n`);
for (const said of chromeLines) process.stdout.write(`${said}\n`);
process.stdout.write(`${STANDIN_CAPTION}\n`);

await browser.close();
for (const [where, height] of rows)
	process.stdout.write(`tallest row ${where}: ${height.toFixed(1)}px\n`);
for (const [where, fold] of firstRows) process.stdout.write(`phone ${where}: ${fold}\n`);
for (const [where, said] of builderLines) process.stdout.write(`builder ${where}: ${said}\n`);
process.stdout.write(`shots in ${out.pathname}\n`);
if (scrolls.length > 0) throw new Error(`Pages scroll sideways:\n${scrolls.join('\n')}`);
if (missing.length > 0)
	throw new Error(`A figure, its basis or a box's columns are wrong:\n${missing.join('\n')}`);
if (under.length > 0)
	throw new Error(`A phone's first row is under the pinned verb:\n${under.join('\n')}`);
process.stdout.write('No page scrolls sideways at 1440, 1024, 800, 768 or 390.\n');
