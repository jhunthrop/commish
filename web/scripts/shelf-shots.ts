// The player shelf (Lane 113) against the fixture API and the built site, on the fixture week's clock:
// on the Lineup, Waivers and Players screens a tap on the first row's name opens his card over the
// screen, shot in both themes at 390 (a bottom sheet about nine tenths of the phone) and 1280 (a side
// shelf 480 px wide at the right). Each asserts what it shows and how it behaves: the address carries
// ?card=<slug> and keeps the screen's own fields, the dialog holds the focus, the tiles and the read
// are drawn, the one verb is the screen's (Open your lineup or the held row's words on the Lineup, the
// add on Waivers, Compare on Players), the copy passes the one guard (copy-scan.ts), nothing scrolls
// sideways, Escape closes it and gives the focus back to the name, the back button closes it, a reload
// reopens it and the close button then clears the address. It prints each screen's script on load,
// gzipped, before any tap (the shelf's script waits for the first). Exits non-zero on any fault.
//
//   [BYTES_ONLY=1] node scripts/shelf-shots.ts [web origin] [out dir]
// BYTES_ONLY prints the screens' script and stops, for a build from before the shelf.
// with the site built against PUBLIC_API_URL naming the fixture API, which runs on the fixture week's
// clock (FIXTURE_CLOCK=2026-10-17T17:00:00.000Z) at API_ORIGIN.
import { mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { CARD } from '../src/lib/player/card.ts';
import { SHELF } from '../src/lib/player/shelf.ts';
import { SHELF_PARAM } from '../src/lib/player/shelf-state.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
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
		ready: 'worth proposing',
		verb: /./,
		shot: false
	}
];

await requireFixtureClock(API_ORIGIN);
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
	await installFixtureClock(ctx, FIXTURE_WEEK_CLOCK);
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

/** The first row's name that opens the shelf. */
function opener(page: Page): ReturnType<Page['locator']> {
	return page.locator('a[aria-haspopup="dialog"]').filter({ visible: true }).first();
}

const shelf = (page: Page): ReturnType<Page['locator']> => page.locator('dialog.shelf[open]');

/** Opens the first row's card. By the pointer it is a click; for the script's measure it is the
 * click alone, so no link the shelf draws under a resting pointer is preloaded on hover. */
async function openShelf(page: Page, by: 'pointer' | 'event' = 'pointer'): Promise<string> {
	const name = opener(page);
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

/** The rank the first row draws, its digits alone, null when it draws none (Waivers, Trades). */
async function rowRank(page: Page): Promise<string | null> {
	const row = opener(page).locator('xpath=ancestor::tr[1]');
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
for (const screen of SCREENS) {
	const { load, tap } = await scriptBytes(screen);
	const first = tap === null ? 'no shelf' : `first tap adds ${String(tap)} B gz`;
	bytes.push(
		`${screen.name.padEnd(9)} ${String(load).padStart(7)} B gz (${(load / KB).toFixed(1)} KB), ${first}`
	);
}

const shotScreens = process.env.BYTES_ONLY ? [] : SCREENS.filter((s) => s.shot);
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
await browser.close();

process.stdout.write(`Script on load (390, gzipped):\n${bytes.join('\n')}\n`);
if (faults.length > 0) {
	process.stdout.write(`\n${String(faults.length)} faults:\n${faults.join('\n')}\n`);
	process.exitCode = 1;
} else process.stdout.write('\nNo faults.\n');
