// The player shelf (Lane 113) against the fixture API and the built site, on the fixture week's clock:
// on the Lineup, Waivers and Players screens a tap on the first row's name opens his card over the
// screen, shot in both themes at 390 (a bottom sheet about nine tenths of the phone) and 1280 (a side
// shelf 480 px wide at the right). Each asserts what it shows and how it behaves: the address carries
// ?card=<slug> and keeps the screen's own fields, the dialog holds the focus, the tiles and the read
// are drawn, the one verb is the screen's (Open your lineup or the held row's words on the Lineup, the
// add on Waivers, Compare on Players), the copy passes the one guard (copy-scan.ts), nothing scrolls
// sideways, Escape closes it and gives the focus back to the name, the back button closes it, a reload
// reopens it and the close button then clears the address. A player with a written read, opened from
// the address on Players, shows the read in the UI face at the rows' body size (Lane 126). The Lineup's
// IR case (Lane 128) opens a player on injured reserve: no rank on his row, "QB IR" on the shelf. It prints each screen's script on load,
// gzipped, before any tap (the shelf's script waits for the first). Lane 274: a player whose read
// quotes a projection the card does not print shows the read before his kickoff, never the moved caption
// or "not written yet"; with SHELF_IN_PLAY=1 the case runs alone on the fixture's Sunday clock
// (FIXTURE_SUNDAY_CLOCK, his noon game under way), where the read written for the week is shown too.
// Lane 160 (B140): CeeDee Lamb's read the run withheld for his status says its due time alone before his
// Sunday night kickoff; with SHELF_AFTER_GAMES=1 the case runs alone on the fixture's Monday clock
// (FIXTURE_MONDAY_CLOCK, his game final), where it says the read for this game was not written.
// Exits non-zero on any fault.
//
//   [BYTES_ONLY=1] [SHELF_IN_PLAY=1 | SHELF_AFTER_GAMES=1] node scripts/shelf-shots.ts [web origin] [out dir]
// BYTES_ONLY prints the screens' script and stops, for a build from before the shelf.
// with the site built against PUBLIC_API_URL naming the fixture API, which runs on the fixture week's
// clock (FIXTURE_CLOCK=2026-10-17T17:00:00.000Z) at API_ORIGIN.
// The site is built from the one stand-in run `npm run standin` writes, marked with the recorded
// injury capture (scripts/standin-designations.json, Lane 128), the run player-card-shots.ts uses.
import { mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { CARD, NONE, onListWords } from '../src/lib/player/card.ts';
import { SHELF } from '../src/lib/player/shelf.ts';
import { SHELF_PARAM } from '../src/lib/player/shelf-state.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { readFace } from './read-face.ts';
import {
	FIXTURE_MONDAY_CLOCK,
	FIXTURE_SUNDAY_CLOCK,
	FIXTURE_WEEK_CLOCK,
	installFixtureClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const THEMES = ['dark', 'light'] as const;
const PHONE = { width: 390, height: 844 } as const;
const DESK = { width: 1280, height: 800 } as const;
const SIZES = [PHONE, DESK] as const;
/** The side shelf's width at a desk, and the sheet's share of a phone's height. */
const SHELF_WIDTH = 480;
const SHEET_SHARE = 0.9;
/** How far a measured edge may sit from its rule, in px (borders, rounding). */
const SLACK = 2;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const KB = 1024;

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/shelf/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
const id = FIXTURE_IDS.league;
/** Lane 158's in-play case alone, on the Sunday clock, or Lane 160's after-the-games case alone, on
 * the Monday clock: every other case is shot on the week's. */
const AFTER_GAMES = process.env.SHELF_AFTER_GAMES === '1';
const IN_PLAY = process.env.SHELF_IN_PLAY === '1' || AFTER_GAMES;
const CLOCK = AFTER_GAMES
	? FIXTURE_MONDAY_CLOCK
	: IN_PLAY
		? FIXTURE_SUNDAY_CLOCK
		: FIXTURE_WEEK_CLOCK;

interface Screen {
	name: string;
	path: string;
	signedIn: boolean;
	/** Text on the screen once its rows are drawn. */
	ready: string;
	/** The shelf's verb, or the held row's words, as the screen gives it on the first row. */
	verb: RegExp;
	/** The screen is shot with the shelf open (else only its script is measured). */
	shot: boolean;
}

const SCREENS: readonly Screen[] = [
	{
		name: 'lineup',
		path: `/league/${id}/start`,
		signedIn: true,
		ready: 'Copy the lineup',
		verb: new RegExp(`^(${SHELF.backToLineup}|${CARD.kickedOff}|${CARD.gameFinal})$`),
		shot: true
	},
	{
		name: 'waivers',
		path: `/league/${id}/waivers`,
		signedIn: true,
		ready: 'Open Sleeper waivers',
		verb: /^(Open Sleeper waivers|Add on Sleeper|Find him on Waivers)$/,
		shot: true
	},
	{
		name: 'players',
		path: '/players',
		signedIn: false,
		ready: 'Find a player',
		verb: new RegExp(`^${CARD.compare}$`),
		shot: true
	},
	{
		name: 'league',
		path: `/league/${id}`,
		signedIn: true,
		ready: 'Set your lineup',
		verb: /./,
		shot: false
	},
	{
		name: 'matchup',
		path: `/league/${id}/matchup`,
		signedIn: true,
		ready: 'Week 6',
		verb: /./,
		shot: false
	},
	{
		name: 'trades',
		path: `/league/${id}/trades`,
		signedIn: true,
		ready: 'Our ideas',
		verb: /./,
		shot: false
	}
];

await requireFixtureClock(API_ORIGIN, CLOCK);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

async function context(
	theme: string,
	size: { width: number; height: number },
	signedIn: boolean
): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: size,
		colorScheme: theme as 'light',
		deviceScaleFactor: size.width === PHONE.width ? 2 : 1
	});
	watchData(ctx);
	await installFixtureClock(ctx, CLOCK);
	if (signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function ready(page: Page, screen: Screen): Promise<void> {
	await page
		.getByText(screen.ready)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

/** A screen's script, gzipped: what it fetches before the network goes quiet with no tap, and what
 * the first tap on a name adds (the shelf's own, null on a build without it). */
interface Bytes {
	load: number;
	tap: number | null;
}

async function scriptBytes(screen: Screen): Promise<Bytes> {
	const ctx = await context('dark', PHONE, screen.signedIn);
	const page = await ctx.newPage();
	let sizes: Promise<number>[] = [];
	page.on('response', (response) => {
		if (response.request().resourceType() === 'script')
			sizes.push(response.body().then((body) => gzipSync(body).length));
	});
	const sum = async (all: Promise<number>[]): Promise<number> =>
		(await Promise.all(all)).reduce((a, b) => a + b, 0);
	await page.goto(`${web}${screen.path}`);
	await ready(page, screen);
	const load = await sum(sizes);
	sizes = [];
	let tap: number | null = null;
	if ((await opener(page).count()) > 0) {
		await openShelf(page, 'event');
		tap = await sum(sizes);
	}
	await ctx.close();
	return { load, tap };
}

/** The name that opens the shelf: the first row's, or the row of the player named by his slug. */
function opener(page: Page, slug?: string): ReturnType<Page['locator']> {
	const names = page.locator(
		slug === undefined
			? 'a[aria-haspopup="dialog"]'
			: `a[aria-haspopup="dialog"][href*="/players/${slug}#"]`
	);
	return names.filter({ visible: true }).first();
}

const shelf = (page: Page): ReturnType<Page['locator']> => page.locator('dialog.shelf[open]');

/** Opens the first row's card. By the pointer it is a click; for the script's measure it is the
 * click alone, so no link the shelf draws under a resting pointer is preloaded on hover. */
async function openShelf(
	page: Page,
	by: 'pointer' | 'event' = 'pointer',
	slug?: string
): Promise<string> {
	const name = opener(page, slug);
	const href = (await name.getAttribute('href')) ?? '';
	if (by === 'pointer') await name.click();
	else await name.dispatchEvent('click');
	await shelf(page).waitFor({ timeout: READY_TIMEOUT_MS });
	await shelf(page).locator('.tiles').first().waitFor({ timeout: READY_TIMEOUT_MS });
	await page.waitForLoadState('networkidle');
	// The spring has settled: the shelf is measured where it rests.
	await page.waitForFunction(() =>
		document.getAnimations().every((animation) => animation.playState !== 'running')
	);
	return href;
}

const cardOf = (page: Page): string | null => new URL(page.url()).searchParams.get(SHELF_PARAM);

/** A rank the rest-of-season caption names: "QB12 in our order". */
const CAPTION_RANK = /[A-Z]{1,3}(\d+) in our order/;

/** The rank the first row (or the named player's) draws, its digits alone, null when it draws none
 * (Waivers, Trades, a season-long list's row). */
async function rowRank(page: Page, slug?: string): Promise<string | null> {
	const row = opener(page, slug).locator('xpath=ancestor::tr[1]');
	const cell = row.locator('.rank-n, .pos').first();
	if ((await cell.count()) === 0) return null;
	return (await cell.innerText()).replace(/\D/g, '') || null;
}

async function check(
	page: Page,
	screen: Screen,
	label: string,
	width: number,
	rank: string | null
): Promise<void> {
	const fault = (said: string): void => {
		faults.push(`${label}: ${said}`);
	};
	// One player, one rank (fix round 1, HIGH-1): the card's pill says the row's.
	const pill = (await shelf(page).locator('.pos').first().innerText()).replace(/\D/g, '');
	if (rank !== null && pill !== rank) fault(`the row ranks him ${rank}, the card ${pill}`);
	// The rest-of-season tile's caption, rewritten to the row's rank (shelf.ts rankedTiles), names the
	// pill's rank or none, never the build's beside it (Lane 115, B93).
	const restLabel = new RegExp(`^(${CARD.rest}|${CARD.projected})$`);
	const caption = await shelf(page)
		.locator('.tile')
		.filter({ has: page.locator('.lb', { hasText: restLabel }) })
		.locator('.cap')
		.first()
		.innerText()
		.catch(() => '');
	const named = CAPTION_RANK.exec(caption)?.[1] ?? null;
	if (caption === '') fault('no rest-of-season caption');
	else if (named !== (pill === '' ? null : pill))
		fault(`the caption "${caption}" names rank ${named ?? 'none'}, the pill ${pill || 'none'}`);
	const slug = cardOf(page);
	if (slug === null) fault(`the address has no ?${SHELF_PARAM}=`);
	const box = await shelf(page).boundingBox();
	if (box === null) {
		fault('the shelf is not drawn');
		return;
	}
	if (width === PHONE.width) {
		if (Math.abs(box.width - PHONE.width) > SLACK) fault(`the sheet is ${String(box.width)} wide`);
		const share = box.height / PHONE.height;
		if (Math.abs(share - SHEET_SHARE) > 0.02)
			fault(`the sheet is ${share.toFixed(2)} of the height`);
		if (Math.abs(box.y + box.height - PHONE.height) > SLACK)
			fault('the sheet does not sit on the bottom');
	} else {
		if (Math.abs(box.width - SHELF_WIDTH) > SLACK) fault(`the shelf is ${String(box.width)} wide`);
		if (Math.abs(box.x + box.width - width) > SLACK) fault('the shelf does not sit at the right');
	}
	const focusIn = await page.evaluate(() => document.activeElement?.closest('dialog') !== null);
	if (!focusIn) fault('the focus is not in the shelf');
	const full = shelf(page).getByRole('link', { name: SHELF.fullPage });
	if ((await full.count()) !== 1) fault('no Full page link');
	const tiles = await shelf(page).locator('.tile').count();
	if (tiles < 6) fault(`${String(tiles)} tiles`);
	if ((await shelf(page).getByText(CARD.ourRead).count()) === 0) fault('no read');
	for (const said of (await readFace(page, 'dialog.shelf[open]')).faults) fault(said);
	const verb = (
		(
			await shelf(page)
				.locator('.foot')
				.innerText()
				.catch(() => '')
		).split('\n')[0] ?? ''
	).trim();
	if (!screen.verb.test(verb)) fault(`the verb reads "${verb}"`);
	const copy = await copyFault(page, undefined, 'dialog.shelf');
	if (copy !== null) fault(`copy: ${copy}`);
	const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	if (over > 0) fault(`scrolls sideways by ${String(over)}`);
}

/** Escape, back, reload and the close button, once per screen. */
async function behave(page: Page, screen: Screen, label: string): Promise<void> {
	const fault = (said: string): void => {
		faults.push(`${label}: ${said}`);
	};
	const screenUrl = page.url();
	await openShelf(page);
	await page.keyboard.press('Escape');
	await shelf(page).waitFor({ state: 'detached', timeout: READY_TIMEOUT_MS });
	if (cardOf(page) !== null) fault('Escape left the card in the address');
	const backOnName = await page.evaluate(
		() => document.activeElement?.getAttribute('aria-haspopup') === 'dialog'
	);
	if (!backOnName) fault('Escape did not give the focus back to the name');

	await openShelf(page);
	await page.goBack();
	await shelf(page).waitFor({ state: 'detached', timeout: READY_TIMEOUT_MS });
	if (page.url() !== screenUrl) fault(`back left ${page.url()}`);

	await openShelf(page);
	const opened = page.url();
	await page.reload();
	await ready(page, screen);
	await shelf(page).waitFor({ timeout: READY_TIMEOUT_MS });
	if (page.url() !== opened) fault('the reload lost the card');
	await shelf(page).getByRole('button', { name: SHELF.close }).click();
	await shelf(page).waitFor({ state: 'detached', timeout: READY_TIMEOUT_MS });
	if (cardOf(page) !== null) fault('the close button left the card in the address');
}

const bytes: string[] = [];
for (const screen of IN_PLAY ? [] : SCREENS) {
	const { load, tap } = await scriptBytes(screen);
	const first = tap === null ? 'no shelf' : `first tap adds ${String(tap)} B gz`;
	bytes.push(
		`${screen.name.padEnd(9)} ${String(load).padStart(7)} B gz (${(load / KB).toFixed(1)} KB), ${first}`
	);
}

const shotScreens = process.env.BYTES_ONLY || IN_PLAY ? [] : SCREENS.filter((s) => s.shot);
for (const screen of shotScreens) {
	for (const theme of THEMES) {
		for (const size of SIZES) {
			const label = `${screen.name} ${theme} ${String(size.width)}`;
			const ctx = await context(theme, size, screen.signedIn);
			const page = await ctx.newPage();
			try {
				await page.goto(`${web}${screen.path}`);
				await ready(page, screen);
				const rank = await rowRank(page);
				await openShelf(page);
				await check(page, screen, label, size.width, rank);
				await page.screenshot({
					path: new URL(`shelf-${screen.name}-${theme}-${String(size.width)}.png`, out).pathname
				});
				if (theme === 'dark') {
					await page.keyboard.press('Escape');
					await shelf(page).waitFor({ state: 'detached', timeout: READY_TIMEOUT_MS });
					await behave(page, screen, label);
				}
			} catch (error: unknown) {
				faults.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				await ctx.close();
			}
		}
	}
}
// The Lineup's IR case (Lane 128, B106): Jaxson Dart is on injured reserve on the capture the run is
// marked with and the fixture league reads, so his row draws no rest-of-season rank and the shelf's
// pill says "QB IR" where the rank would be, its rest tile naming none.
const IR_CASE = {
	slug: 'jaxson-dart',
	pill: 'QB IR',
	rest: 'unranked while on a season-long list',
	week: onListWords('IR'),
	weekTiles: 3
};
const lineupScreen = SCREENS.find((s) => s.name === 'lineup');
if (!process.env.BYTES_ONLY && !IN_PLAY && lineupScreen !== undefined) {
	for (const theme of THEMES) {
		for (const size of SIZES) {
			const label = `lineup IR ${theme} ${String(size.width)}`;
			const ctx = await context(theme, size, lineupScreen.signedIn);
			const page = await ctx.newPage();
			try {
				await page.goto(`${web}${lineupScreen.path}`);
				await ready(page, lineupScreen);
				const rank = await rowRank(page, IR_CASE.slug);
				if (rank !== null) faults.push(`${label}: his row ranks him ${rank}`);
				const proj = opener(page, IR_CASE.slug).locator('xpath=ancestor::tr[1]').locator('td.proj');
				// His row draws its Proj cell, and it is "--" (review LOW-2: never passing with no cell).
				if ((await proj.count()) === 0) faults.push(`${label}: his row draws no Proj cell`);
				else if ((await proj.first().innerText()).trim() !== NONE)
					faults.push(`${label}: his row's Proj reads "${await proj.first().innerText()}"`);
				await openShelf(page, 'pointer', IR_CASE.slug);
				await check(page, lineupScreen, label, size.width, rank);
				const head = await shelf(page).locator('.sub').first().innerText();
				if (!head.includes(IR_CASE.pill)) faults.push(`${label}: the pill reads "${head}"`);
				const card = await shelf(page).locator('.tiles').first().innerText();
				if (!card.includes(IR_CASE.rest)) faults.push(`${label}: the rest tile reads "${card}"`);
				// His week is not his (fix round 1): Proj, Opp rank and the change say his list.
				const listed = await shelf(page).locator('.tile').filter({ hasText: IR_CASE.week }).count();
				if (listed !== IR_CASE.weekTiles)
					faults.push(`${label}: ${String(listed)} tiles say "${IR_CASE.week}"`);
				// His basis says only what his card shows (fix round 2).
				const basis = await shelf(page).locator('.basis').innerText();
				if (!basis.startsWith(CARD.listedWeek) || /published projection|Opp rank is/u.test(basis))
					faults.push(`${label}: the basis reads "${basis}"`);
				await page.screenshot({
					path: new URL(`shelf-lineup-ir-${theme}-${String(size.width)}.png`, out).pathname
				});
			} catch (error: unknown) {
				faults.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				await ctx.close();
			}
		}
	}
}
// The return case (Lane 153): Travis Etienne is designated to return Sunday Oct 18 on the capture the
// run is marked with and the fixture league reads, so on the Lineup and on Players his row ranks him as
// playing and its chip says his day, and his shelf draws his week, no tile saying a list.
const RETURN_CASE = {
	slug: 'travis-etienne-jr',
	chip: 'Due back Sun Oct 18',
	listed: onListWords('IR'),
	statusCaption: 'His status changed since this read was written.',
	body: 'does not play'
};
// Shot on the week's clock alone, as the IR case: the in-play and after-games cases run their read alone.
for (const screen of SCREENS.filter((s) => s.name === 'lineup' || s.name === 'players')) {
	if (process.env.BYTES_ONLY || IN_PLAY) break;
	for (const theme of THEMES) {
		for (const size of SIZES) {
			const label = `${screen.name} returning ${theme} ${String(size.width)}`;
			const ctx = await context(theme, size, screen.signedIn);
			const page = await ctx.newPage();
			try {
				await page.goto(`${web}${screen.path}`);
				await ready(page, screen);
				const row = opener(page, RETURN_CASE.slug).locator('xpath=ancestor::tr[1]');
				const rank = await rowRank(page, RETURN_CASE.slug);
				if (rank === null) faults.push(`${label}: his row draws no rank`);
				const said = await row.innerText();
				if (!said.includes(RETURN_CASE.chip)) faults.push(`${label}: his row reads "${said}"`);
				if (/\bIR\b/u.test(said)) faults.push(`${label}: his row still says IR: "${said}"`);
				await openShelf(page, 'pointer', RETURN_CASE.slug);
				await check(page, screen, label, size.width, rank);
				const listed = await shelf(page)
					.locator('.tile')
					.filter({ hasText: RETURN_CASE.listed })
					.count();
				if (listed > 0)
					faults.push(`${label}: ${String(listed)} tiles say "${RETURN_CASE.listed}"`);
				// His read, written while he was on IR, stands under the status caption (Lane 162, D01; Lane
				// 274): the caption over the read, never in place of it.
				const shelfText = await shelf(page).innerText();
				if (!shelfText.includes(RETURN_CASE.statusCaption) || !shelfText.includes(RETURN_CASE.body))
					faults.push(`${label}: his read is not under the status caption: "${shelfText}"`);
				await page.screenshot({
					path: new URL(`shelf-${screen.name}-returning-${theme}-${String(size.width)}.png`, out)
						.pathname
				});
			} catch (error: unknown) {
				faults.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				await ctx.close();
			}
		}
	}
}
// A player with a written week read (the stand-in run's, scripts/standin-week-reads.json), opened from
// the address on Players: the read is drawn, in the UI face at the rows' body size (Lane 126). Lane
// 158: Rome Odunze's read quotes 12.4, a projection his card does not print; before his kickoff the
// shelf says the moved caption alone, from it (SHELF_IN_PLAY) the read written for the week. Lane 160:
// CeeDee Lamb's read, withheld for his status, says its due time before his kickoff and, once his game
// is final (SHELF_AFTER_GAMES), that the read for this game was not written.
interface ReadCase {
	slug: string;
	shot: string;
	/** The read is drawn, else the one sentence its place says alone. */
	shown: boolean;
	says?: string;
}
const MOVED = 'The published projection moved since this read was written.';
const DUE = 'His status changed since this read was written. A new read is due by';
const READ_CASES: readonly ReadCase[] = AFTER_GAMES
	? [{ slug: 'ceedee-lamb', shot: 'read-withheld-final', shown: false, says: CARD.readNotWritten }]
	: IN_PLAY
		? [{ slug: 'rome-odunze', shot: 'read-in-play', shown: true }]
		: [
				{ slug: 'puka-nacua', shot: 'read', shown: true },
				{ slug: 'rome-odunze', shot: 'read-moved', shown: true },
				{ slug: 'ceedee-lamb', shot: 'read-withheld', shown: false, says: DUE }
			];

/** The read's place says one thing: the read, or its one sentence alone; "not written" only when that
 * is the sentence, and never a due time once his game is under way or final. */
async function checkRead(page: Page, read: ReadCase, label: string): Promise<void> {
	const text = await shelf(page).locator('section.read').innerText();
	const unwritten = read.says === CARD.readNotWritten;
	if (text.includes(CARD.readNotYet) || (!unwritten && text.includes(CARD.readNotWritten)))
		faults.push(`${label}: the read's place says it is not written: "${text}"`);
	for (const words of [MOVED, DUE, CARD.readNotWritten]) {
		if (text.includes(words) !== (read.says === words))
			faults.push(`${label}: "${words}" ${read.says === words ? 'missing' : 'said'}: "${text}"`);
	}
	if (read.shown) {
		const face = await readFace(page, 'dialog.shelf[open]');
		for (const said of face.faults) faults.push(`${label}: ${said}`);
		process.stdout.write(`${label}: the read's lines ${face.lines.join(', ')} characters\n`);
	}
}

const playersScreen = SCREENS.find((s) => s.name === 'players');
if (!process.env.BYTES_ONLY && playersScreen !== undefined) {
	for (const read of READ_CASES) {
		for (const theme of THEMES) {
			for (const size of SIZES) {
				const label = `${read.shot} ${theme} ${String(size.width)}`;
				const ctx = await context(theme, size, playersScreen.signedIn);
				const page = await ctx.newPage();
				try {
					await page.goto(`${web}${playersScreen.path}?${SHELF_PARAM}=${read.slug}`);
					await ready(page, playersScreen);
					await shelf(page)
						.locator(read.shown ? '.prose.week' : 'section.read .unwritten')
						.waitFor({ timeout: READY_TIMEOUT_MS });
					// The week's figures are read: the read's place is judged against them.
					await page.waitForLoadState('networkidle');
					await page.evaluate(() => document.fonts.ready);
					await checkRead(page, read, label);
					await page.screenshot({
						path: new URL(`shelf-${read.shot}-${theme}-${String(size.width)}.png`, out).pathname
					});
				} catch (error: unknown) {
					faults.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
				} finally {
					await ctx.close();
				}
			}
		}
	}
}
// Lane 160: the full player page says the same of Lamb's withheld read once his game is final, by the
// same function (week-read.ts shownWeekRead) at the page's clock.
if (!process.env.BYTES_ONLY && AFTER_GAMES) {
	for (const theme of THEMES) {
		for (const size of SIZES) {
			const label = `page read-withheld-final ${theme} ${String(size.width)}`;
			const ctx = await context(theme, size, false);
			const page = await ctx.newPage();
			try {
				await page.goto(`${web}/players/ceedee-lamb`);
				const place = page.locator('article.read').first();
				await place.getByText(CARD.readNotWritten).first().waitFor({ timeout: READY_TIMEOUT_MS });
				await page.waitForLoadState('networkidle');
				const said = await place.innerText();
				if (said.includes(DUE))
					faults.push(`${label}: the page still says the due time: "${said}"`);
				await page.screenshot({
					fullPage: true,
					path: new URL(`page-read-withheld-final-${theme}-${String(size.width)}.png`, out).pathname
				});
			} catch (error: unknown) {
				faults.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				await ctx.close();
			}
		}
	}
}
await browser.close();

process.stdout.write(`Script on load (390, gzipped):\n${bytes.join('\n')}\n`);
if (faults.length > 0) {
	process.stdout.write(`\n${String(faults.length)} faults:\n${faults.join('\n')}\n`);
	process.exitCode = 1;
} else process.stdout.write('\nNo faults.\n');
