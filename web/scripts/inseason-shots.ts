// Screenshots of the in-season screens (start and sit, waivers, trades) and the league page with its
// tabs, against the fixture API (scripts/inseason-fixture/serve.ts) and the built site, in both themes
// at 1440 and 390. At 1440, 1024, 800, 768 and 390 it asserts the page never scrolls sideways, and it
// prints the tallest player row, the taps from the page to its verb, and the shots of the loading
// rows, the API's refusals and the site's not-found for an unknown screen. On a phone (390 by 844) it
// asserts the first player row sits whole above the pinned verb. On the waiver and trade screens it
// asserts the rows carry the rest-of-season points a game and the basis line says what they are (Lane
// 64), and the builder's answer names its players with them. On the Lineup and Matchup screens, box
// scores (Lane 66d), it asserts the column heads, every row's projection and points as one decimal or
// --, the projection's basis said once, no points a game on a row, no name cut and a defense drawn
// with its club's mark. On the Lineup table (Lane 66e) it asserts the evidence heads and cells,
// each swap's chip, arrow and evidence line, the bench arrow reading Sit, the copy verb with the
// platform's own line under it, and that no sentence on the Lineup or Matchup says "host" (the
// member's platform is named). On the League page (Lane 66i), for the Sleeper league and the ESPN
// fixture (its Sunday points a stand-in, named so), it asserts the scoreboard's six bugs, the side
// ahead bright once a game has started and both alike before, the standings' columns and twelve
// rows with the playoff rule drawn by record, the lineup's verb and bench link, a bid in Sleeper's
// moves and no moves on ESPN with the basis saying why, the basis drawn in at most five lines at a
// desk, the settings' stated rules counted with no figure for an unstated one, the tabs' arrow keys,
// and on a phone the first standings row clear of the pinned verb. Exits non-zero when a page scrolls sideways, a
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
	{ name: 'league', path: `/league/${id}`, ready: 'Set your lineup' },
	{ name: 'start', path: `/league/${id}/start`, ready: 'Copy the lineup' },
	{ name: 'matchup', path: `/league/${id}/matchup`, ready: 'Week 6' },
	{ name: 'waivers', path: `/league/${id}/waivers`, ready: 'Claim on Sleeper' },
	{ name: 'trades', path: `/league/${id}/trades`, ready: 'Propose on Sleeper' }
] as const;

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
const PER_GAME_SCREENS = new Set(['waivers', 'trades']);
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
/** The screens whose rows end on their own figure, not on a gain: every row's end names its basis. */
const OWN_END_SCREENS = new Set(['start', 'trades']);
/** A row's end on those screens: points a game, or words saying why it has none. */
const NAMED_END = /a game|No projection|Unranked/i;

/** Every row under root whose end is a bare number or names no basis we expect, by player name. */
async function unnamedEnds(page: Page, root: string): Promise<string[]> {
	return page.evaluate(
		([scope, pattern]) =>
			[...document.querySelectorAll(`${scope} .row`)].flatMap((row) => {
				const end = row.querySelector('.end');
				if (!end) return [];
				const bare = end.querySelector('.bare') !== null;
				const text = (end as HTMLElement).innerText;
				return bare || !new RegExp(pattern, 'i').test(text)
					? [row.querySelector('b')?.textContent ?? '?']
					: [];
			}),
		[root, NAMED_END.source] as const
	);
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
				if (OWN_END_SCREENS.has(name)) {
					for (const who of await unnamedEnds(page, 'main')) {
						missing.push(`${name} ${theme} ${String(width)} row end unnamed: ${who}`);
					}
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
				const fold = await page.evaluate(() => {
					const row = document
						.querySelector('main .row, main table.box tbody tr, main table.lineup tbody tr')
						?.getBoundingClientRect();
					const pin = document.querySelector('.pin')?.getBoundingClientRect();
					return { rowBottom: row?.bottom ?? Infinity, pinTop: pin?.top ?? 0 };
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
	await ready(page, 'Propose on Sleeper');
	await page.getByRole('combobox').selectOption({ label: 'Patrick Mahomes' });
	await page.locator('.teams[aria-busy="false"]').waitFor({ timeout: READY_TIMEOUT_MS });
	await page.screenshot({ path: file(`trades-narrowed-dark-${String(width)}`), fullPage: true });
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
		await ready(page, 'Propose on Sleeper');
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

/** The trade builder (Lane 61), in both themes at both widths: Build a trade opens it empty, a tap
 * a side reads the answer, a finder row's Build from this opens it with that trade and answers the
 * row's own two gains, one player changed reads it again, and giving both tight ends says the TE
 * would not be filled. Each must not scroll sideways. */
const builder = '#trade-builder';
/** The gains in an answer line: its figures before the players it names with their points a game. */
const gainsOf = (text: string): string[] =>
	[...(text.split(' You give ')[0] ?? '').matchAll(/\d+\.\d/g)].map((m) => m[0]);
async function answered(page: Page): Promise<string> {
	const line = page.locator(`${builder} .words[aria-busy="false"] .line`);
	await line.waitFor({ timeout: READY_TIMEOUT_MS });
	return (await line.textContent()) ?? '';
}
async function tapSide(page: Page, side: 'You give' | 'You get', name: string): Promise<void> {
	await page
		.locator(`${builder} section[aria-label="${side}"] button.pick`)
		.filter({ hasText: name })
		.first()
		.click();
}
const builderLines = new Map<string, string>();
for (const theme of THEMES) {
	for (const width of SHOT_WIDTHS) {
		const ctx = await context(theme, width);
		const page = await ctx.newPage();
		const shot = async (name: string): Promise<void> => {
			const wide = await page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth
			);
			if (wide) scrolls.push(`trades builder ${name} ${theme} ${String(width)}`);
			await page.screenshot({
				path: file(`trades-builder-${name}-${theme}-${String(width)}`),
				fullPage: name !== 'pinned'
			});
		};
		await page.goto(`${web}/league/${id}/trades`, { waitUntil: 'networkidle' });
		await ready(page, 'Propose on Sleeper');
		await page.getByRole('button', { name: 'Build a trade' }).click();
		await ready(page, 'Pick one or two of your players and one or two of theirs.');
		await shot('open');
		const yours = page.locator(`${builder} section[aria-label="You give"] button.pick`);
		const theirs = page.locator(`${builder} section[aria-label="You get"] button.pick`);
		await yours.nth(1).click();
		await theirs.first().click();
		for (const who of await unnamedEnds(page, builder)) {
			missing.push(`builder ${theme} ${String(width)} row end unnamed: ${who}`);
		}
		const picked = await answered(page);
		builderLines.set(`picked ${theme} ${String(width)}`, picked);
		if (!/You give .+ for .+\(\d+\.\d a game\)\./.test(picked)) {
			missing.push(`builder answer ${theme} ${String(width)}: ${picked}`);
		}
		await shot('picked');
		if (width === PHONE.width) {
			// The answer and its verb stay pinned while the member scrolls the rosters.
			await page.setViewportSize(PHONE);
			await theirs.last().scrollIntoViewIfNeeded();
			await shot('pinned');
			await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
		}
		// A finder row opens the builder with its trade, and answers the row's own gains.
		await page.getByRole('button', { name: 'Not now' }).click();
		const row = page.locator('.trade').first();
		const rowGains = gainsOf((await row.locator('.gains p').textContent()) ?? '');
		await row.getByRole('button', { name: 'Build from this' }).click();
		// Opened with both sides held, the line says it is checking, never to pick a player.
		const first = (await page.locator(`${builder} .words .line`).textContent()) ?? '';
		if (/pick one or two/i.test(first)) {
			throw new Error(`A filled builder asked to pick: ${first}`);
		}
		const fromRow = await answered(page);
		builderLines.set(`from a row ${theme} ${String(width)}`, fromRow);
		if (gainsOf(fromRow).join(' ') !== rowGains.join(' ')) {
			throw new Error(`The builder answered ${fromRow} for a finder row of ${rowGains.join(', ')}`);
		}
		await shot('from-row');
		// One player changed reads the trade again.
		const firstTheirs = page.locator(`${builder} section[aria-label="You get"] button.pick`);
		const pickedTheirs = firstTheirs.and(page.locator('[aria-pressed="true"]')).first();
		await pickedTheirs.click();
		await firstTheirs.and(page.locator('[aria-pressed="false"]')).first().click();
		builderLines.set(`changed ${theme} ${String(width)}`, await answered(page));
		await shot('changed');
		// Both tight ends given: the member's TE would not be filled.
		await page.getByRole('button', { name: 'Not now' }).click();
		await page.getByRole('button', { name: 'Build a trade' }).click();
		await tapSide(page, 'You give', 'Chig Okonkwo');
		await tapSide(page, 'You give', 'Sam LaPorta');
		await theirs.first().click();
		const short = await answered(page);
		builderLines.set(`short ${theme} ${String(width)}`, short);
		if (short !== 'Your roster would not fill TE.') {
			throw new Error(`Giving both tight ends answered ${short}`);
		}
		// Two given: the side says why its other rows wait, in words, not a tooltip.
		await page
			.locator(`${builder} section[aria-label="You give"] .full`)
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
const MAX_BASIS_LINES = 5;
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
		rules: 40
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
			bids: [...document.querySelectorAll('main table.feed td.det')].filter((td) =>
				/^FAAB \$\d/.test(text(td))
			).length,
			basisText: basis.map((p) => text(p)).join(' '),
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
	if (!lp.live && started.length > 0) faults.push('a bug before kickoff draws one side ahead');
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
	if (width !== PHONE.width && (seen.basisLines === 0 || seen.basisLines > MAX_BASIS_LINES))
		faults.push(`the basis draws ${String(seen.basisLines)} lines`);
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
			const ctx = await context(theme, width);
			const page = await ctx.newPage();
			await page.goto(`${web}/league/${lp.league}`, { waitUntil: 'networkidle' });
			await ready(page, 'Every game this week, yours first.');
			const at = `${lp.name} ${theme} ${String(width)}`;
			for (const fault of await leagueFaults(page, lp, width)) missing.push(`${at} ${fault}`);
			for (const word of await hostWordsSaid(page)) missing.push(`${at} says host: ${word}`);
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
					const pin = document.querySelector('main .roster .verb')?.getBoundingClientRect();
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
			for (const word of await hostWordsSaid(page))
				missing.push(`${at} settings say host: ${word}`);
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
