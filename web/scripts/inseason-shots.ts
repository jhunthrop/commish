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
// listed, the copy verb's confirm naming Sleeper's trade page, and that nothing says "host"; the
// builder's two boxes, its scoreboard's figures before and after once answered, and its answer naming
// its players with their points a game. On the Lineup and Matchup screens, box
// scores (Lane 66d), it asserts the column heads, every row's projection and points as one decimal or
// --, the projection's basis said once, no points a game on a row, no name cut and a defense drawn
// with its club's mark. On the Lineup table (Lane 66e) it asserts the evidence heads and cells,
// each swap's chip, arrow and evidence line, the bench arrow reading Sit, the copy verb with the
// platform's own line under it, and that no sentence on the Lineup or Matchup says "host" (the
// member's platform is named). Exits non-zero when a page scrolls sideways, a
// phone's first row is under the pin, or a figure or its sentence is missing.
//
//   node scripts/inseason-shots.ts [web origin] [out dir, from scripts/]
// with the site built against PUBLIC_API_URL=http://localhost:8799 and the fixture API running there.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const THEMES = ['light', 'dark'] as const;
const SHOT_WIDTHS = new Set([1440, 390]);
const WIDTHS = [1440, 1024, 800, 768, 390] as const;
const VIEWPORT_HEIGHT = 900;
/** A phone's screen: the first row must clear the pinned verb in it. */
const PHONE = { width: 390, height: 844 } as const;
const READY_TIMEOUT_MS = 30_000;
/** The CSRF cookie the site reads as signed in; the fixture API asks for nothing more. */
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };

const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? '../screenshots/inseason/', import.meta.url);
const id = FIXTURE_IDS.league;

const PAGES = [
	{ name: 'league', path: `/league/${id}`, ready: 'Waiver pool' },
	{ name: 'start', path: `/league/${id}/start`, ready: 'Copy the lineup' },
	{ name: 'matchup', path: `/league/${id}/matchup`, ready: 'Week 6' },
	{ name: 'waivers', path: `/league/${id}/waivers`, ready: 'Claim on Sleeper' },
	{ name: 'trades', path: `/league/${id}/trades`, ready: 'worth proposing' }
] as const;
/** The Trades screen's verb on every platform today: the offer copied, the trade page opened. */
const TRADE_VERB = 'Open Sleeper trades';

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light'
	});
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
const PER_GAME_SCREENS = new Set(['waivers']);
/** The screens drawn as a box score (Lane 66d): columns, the week's projection and points so far,
 * the projection's basis said once, no points a game on a row. */
const BOX_SCREENS = new Set(['start', 'matchup']);
const PROJ_BASIS =
	/Proj is this week's published projection in (PPR|half-PPR|standard) scoring, (this league's own|the closest match to this league's rules), read \w{3} \d+:\d\d [ap]m \w+\./g;
const BOX_NUMBER = /^(\d+\.\d|--)$/;
/** The Lineup's evidence cells: an ordinal rank, a figure, a signed change, or --. */
const EVIDENCE_CELL = /^(\d+(st|nd|rd|th)|\d+\.\d|[+−]\d+\.\d|--)$/;
/** The Lineup's heads at the desk and on a phone, the open column's own word read by a screen reader. */
const LINEUP_HEADS = [
	'Slot',
	'Player',
	'Game',
	'Proj',
	'Pts',
	'Opp rank',
	'Avg',
	'Last',
	'Δ Proj',
	'Why'
];
const PHONE_HEADS = ['Slot', 'Player', 'Proj', 'Pts', 'Why'];
/** Below 900 px the evidence folds under the name. */
const FOLDED_HEADS = ['Slot', 'Player', 'Game', 'Proj', 'Pts', 'Why'];
const EVIDENCE_FOLDS_AT = 900;

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
				.map((th) => (th as HTMLElement).innerText.trim()),
			numbers: rows.flatMap((tr) =>
				[...tr.querySelectorAll('td.proj, td.pts')].map((td) =>
					(td as HTMLElement).innerText.trim()
				)
			),
			basis: [...document.querySelectorAll('main p')].map((p) => p.textContent).join(' '),
			cut: names.flatMap((n) =>
				n.scrollWidth > n.clientWidth + 1 ||
				n.getBoundingClientRect().right > (n.closest('td')?.getBoundingClientRect().right ?? 0) + 1
					? [n.textContent.trim()]
					: []
			),
			perGame: rows.some((tr) => /\d a game/.test(tr.textContent)),
			defenseRows: rows.filter((tr) => tr.querySelector('.club') && !tr.querySelector('.club .pos'))
				.length,
			defenseMarks: rows.filter(
				(tr) =>
					tr.querySelector('.club') &&
					!tr.querySelector('.club .pos') &&
					tr.querySelector('img[alt$=" defense"]')
			).length,
			statuses: rows.flatMap((tr) =>
				[...tr.querySelectorAll('.club .pos, .club .chip')].map((el) => el.textContent.trim())
			),
			byeProj: rows
				.filter((tr) => tr.querySelector('td.game .bye') !== null)
				.map((tr) => tr.querySelector<HTMLElement>('td.proj')?.innerText.trim() ?? '?')
		};
	});
}
const PER_GAME_BASIS =
	/Points a game are our rest-of-season projection from week \d+ over the games his club has left, byes out\./;
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
const TRADE_HEADS_PHONE = ['Why this trade', 'You give', 'You, a week', 'Them, a week'];
const ROOM_FOLDS_AT = 1180;
/** Below it a trade folds as on a phone. */
const TRADES_FOLD_AT = 900;
/** A gain or a week's change as its cell prints it. */
const SIGNED = /^([+−]\d+\.\d|0\.0|--)$/;
const TRADE_BASIS_FIRST =
	"Trades where both lineups gain on our rest-of-season order. Each team's best trade, yours first, among those they gain at least 0.5 a week from, then the close calls for them. The other team decides.";
/** A trade's week in one line, from the API's two changes (review H2). */
const WEEK_LINE = /[+−]?\d+\.\d Proj for you this week, [+−]?\d+\.\d for them/;
const TRADE_BASIS_MOST = 5;

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
			basis: [...document.querySelectorAll('main .basis p')].map((p) => p.textContent.trim()),
			cards: [...document.querySelectorAll('main .card')].map((c) => (c as HTMLElement).innerText),
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
		if (
			!card.includes(TRADE_VERB) ||
			!/[+−]\d+\.\d a week for you/.test(card) ||
			!WEEK_LINE.test(card)
		)
			faults.push(`card ${card.replace(/\s+/g, ' ')}`);
	}
	if (seen.drops === 0) faults.push('no row says the drop');
	if (seen.basis.length > TRADE_BASIS_MOST)
		faults.push(`basis in ${String(seen.basis.length)} lines`);
	if (!(seen.basis[0] ?? '').startsWith(TRADE_BASIS_FIRST))
		faults.push(`basis opens ${seen.basis[0] ?? ''}`);
	const all = seen.basis.join(' ');
	if (!PER_GAME_BASIS.test(all)) faults.push('basis says no points a game');
	const proj = (all.match(PROJ_BASIS) ?? []).length;
	if (proj !== 1) faults.push(`projection basis said ${String(proj)} times`);
	for (const word of await hostWordsSaid(page)) faults.push(`says host: ${word}`);
	return faults;
}
const missing: string[] = [];
const rows = new Map<string, number>();
const under: string[] = [];
const firstRows = new Map<string, string>();
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
							'main .row, main table.box tbody tr, main table.lineup tbody tr'
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
			if (PER_GAME_SCREENS.has(name)) {
				const said = await page.evaluate(() => ({
					basis: document.querySelector('main p.basis')?.textContent ?? '',
					row: document.querySelector('main .row')?.textContent ?? ''
				}));
				if (!PER_GAME_BASIS.test(said.basis))
					missing.push(`${name} ${theme} ${String(width)} basis`);
				if (!PER_GAME.test(said.row)) missing.push(`${name} ${theme} ${String(width)} first row`);
			}
			if (name === 'trades') {
				for (const fault of await tradeFaults(page, width))
					missing.push(`${name} ${theme} ${String(width)} ${fault}`);
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
						? ['Slot', 'Player', 'Proj', 'Pts']
						: ['Slot', 'Player', 'Game', 'Proj', 'Pts'];
				const heads = name === 'start' ? lineupHeads : boxHeads;
				for (const word of await hostWordsSaid(page)) missing.push(`${at} says host: ${word}`);
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
					(wantsIR && !box.statuses.some((s) => s.endsWith(' IR')))
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
							'main .card, main .row, main table.box tbody tr, main table.lineup tbody tr'
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

/** A marked add and a narrowed trade list, at both widths in the dark theme. */
for (const width of SHOT_WIDTHS) {
	const ctx = await context('dark', width);
	const page = await ctx.newPage();
	await page.goto(`${web}/league/${id}/waivers`, { waitUntil: 'networkidle' });
	await ready(page, 'Claim on Sleeper');
	await page.getByRole('button', { name: 'Add', exact: true }).nth(2).click();
	await page.screenshot({ path: file(`waivers-marked-dark-${String(width)}`), fullPage: true });
	// A position chip reads the adds at that position again (?position=).
	await page.getByRole('button', { name: 'RB', exact: true }).click();
	await page.locator('.rows[aria-busy="false"]').waitFor({ timeout: READY_TIMEOUT_MS });
	await page.screenshot({ path: file(`waivers-rb-dark-${String(width)}`), fullPage: true });
	await page.goto(`${web}/league/${id}/trades`, { waitUntil: 'networkidle' });
	await ready(page, 'worth proposing');
	await page.getByRole('combobox').selectOption({ label: 'Patrick Mahomes' });
	await page.locator('.finder-wrap[aria-busy="false"]').waitFor({ timeout: READY_TIMEOUT_MS });
	await page.screenshot({ path: file(`trades-narrowed-dark-${String(width)}`), fullPage: true });
	await ctx.close();
}

/** An opened trade: its players in the box score's columns (Lane 66g), in both themes at both
 * widths, and every trade sorted by their week's change. */
const OPENED_HEADS = [
	'Give',
	'Player',
	'Game',
	'Proj',
	'Pts',
	'Opp rank',
	'Avg',
	'Last',
	'Rest of season'
];
const OPENED_HEADS_PHONE = ['Give', 'Player', 'Proj', 'Rest of season'];
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

/** Every sentence a member reads on a screen, checked for the word "host": the member's platform is
 * named instead (Lane 66e, founder 2026-10-17). */
async function hostWordsSaid(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll('main p, main td, main th, main li, main button, main a')]
			.map((el) => (el as HTMLElement).innerText)
			.filter((text) => /\bhosts?\b/i.test(text))
	);
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
	if ((seen.text.match(/Opp rank is where his opponent stands/g) ?? []).length !== 1)
		faults.push('the evidence basis not said once');
	if (!/Δ Proj is its change since the read before, \w{3} \d+:\d\d [ap]m \w+\./.test(seen.text))
		faults.push('the change basis');
	if (!seen.text.includes('We start the highest Proj at each slot'))
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
			await ready(page, 'Claim on ESPN');
			await page.getByRole('button', { name: 'Add', exact: true }).first().click();
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
/** The scoreboard's figures once answered: each a figure to the tenth. */
async function bugFaults(page: Page): Promise<string[]> {
	const figures = await page
		.locator(`${builder} .bug .fig b, ${builder} .bug .fig i`)
		.allInnerTexts();
	return figures.length === 8 && figures.every((f) => /^−?\d+\.\d$/.test(f.trim()))
		? []
		: [`scoreboard ${figures.join(' ')}`];
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
	{ name: 'league-playoffs', path: `/league/${FIXTURE_IDS.playoffs}`, ready: 'See the matchup' },
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
