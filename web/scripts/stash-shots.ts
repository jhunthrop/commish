// Screenshots of Lane 118's screens against the fixture API and the built site, light and dark at
// 1280 and 390, on the clock the fixture API runs at (inseason-fixture/clock.ts):
//   Waivers   the Stash group (B79): with FIXTURE_IR_DROP=1 its two rows under their own divider,
//             each with its back week, and its line; without it no group at all. STASH=absent says
//             which the run expects.
//   Lineup    the strip (B88): while a starter as set still plays (the Monday night clock), "Proj
//             final" beside the moving Pts; on any other clock no Proj final in the strip.
//   front     the heading's run words as the signed-out front page prints them (B96, a check).
// Every page: nothing scrolls sideways and the copy passes the one guard (copy-scan.ts). Exits
// non-zero on any fault.
//
// Lane 121 (B99): the Stash line says A game in the heads' words, and with the fixture API started with
// FIXTURE_SEASON_TAKEN=1 (a league stating no regular season's end) "Regular season taken as weeks 1 to
// 14.", never without it.
//
//   [STASH=present|absent] [FIXTURE_SEASON_TAKEN=1] node scripts/stash-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { BOX } from '../src/lib/league/box/box.ts';
import { STASH, WAIVERS } from '../src/lib/league/box/waivers.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_MONDAY_NIGHT_CLOCK,
	fixtureApiClock,
	installFixtureApiClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { SEASON_TAKEN_VARIABLE } from './inseason-fixture/waiver-beats.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8799';
const out = new URL(process.argv[3] ?? '../screenshots/stash/', import.meta.url);
const expectStash = (process.env.STASH ?? 'present') === 'present';
/** The fixture API answers as for a league stating no regular season's end (Lane 121, B99). */
const expectTaken = process.env[SEASON_TAKEN_VARIABLE] === '1';
/** The recorded league's last regular week, as the API takes it there. */
const TAKEN_LAST = 14;
const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const HEIGHTS = { 1280: 900, 390: 844 } as const;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const LEAGUE = `/league/${FIXTURE_IDS.league}`;
/** The fixture case's stashes (waiver-beats.ts STAMPED) and the week each is back. */
const STASHED: Readonly<Record<string, number>> = { "De'Von Achane": 9, 'Tyquan Thornton': 8 };

const running = (await fixtureApiClock(API_ORIGIN)).clock;
const playing = running === FIXTURE_MONDAY_NIGHT_CLOCK;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];
const fault = (where: string, what: string): number => faults.push(`${where}: ${what}`);

async function settle(page: Page, path: string, text: string): Promise<void> {
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
	await page
		.getByText(text)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
}

async function common(page: Page, where: string): Promise<void> {
	const sideways = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	if (sideways > 0) fault(where, `scrolls sideways by ${String(sideways)} px`);
	const copy = await copyFault(page);
	if (copy !== null) fault(where, copy);
}

async function checkStash(page: Page, where: string): Promise<void> {
	const group = page.locator('main table.pool tr.divider', { hasText: STASH.head });
	const drawn = (await group.count()) > 0;
	const stashed = await page
		.locator('main table.pool tr', {
			hasText: new RegExp(`${STASH.backNow}|Back week \\d+`)
		})
		.count();
	if (!expectStash) {
		// The capture the stand-in run is marked with lists free agents on IR with no return date
		// (Lane 128): the group may say they are left out, and holds no stash of its own.
		if (stashed > 0) fault(where, `${String(stashed)} stash rows drawn`);
		if (drawn) {
			const said = await page.locator('main table.pool tr.stash-basis').innerText();
			if (said.includes(STASH.line) || !said.includes(STASH.undated))
				fault(where, `the Stash group with no stash reads "${said}"`);
		}
		return;
	}
	if (!drawn) fault(where, 'the Stash group is not drawn');
	const line = await page.locator('main table.pool tr.stash-basis').innerText();
	if (!line.includes(STASH.line)) fault(where, `the Stash line reads "${line}"`);
	if (line.includes(STASH.taken(TAKEN_LAST)) !== expectTaken)
		fault(where, `the Stash line ${expectTaken ? 'lacks' : 'says'} the season taken: "${line}"`);
	for (const [name, week] of Object.entries(STASHED)) {
		const row = page.locator('main table.pool tr', { hasText: name }).first();
		const said = await row.innerText();
		if (!said.includes(STASH.back(week))) fault(where, `${name}'s row reads "${said}"`);
	}
	const verb = page.locator('main table.pool .add.word', { hasText: STASH.verb });
	if ((await verb.count()) !== 1 || !(await verb.first().isVisible()))
		fault(where, 'the Stash verb is not drawn once with its word');
	const cut = await verb.first().evaluate((el) => {
		const cell = el.closest('td')?.getBoundingClientRect();
		const box = el.getBoundingClientRect();
		const table = el.closest('table')?.getBoundingClientRect();
		return (
			el.scrollWidth > el.clientWidth + 1 ||
			(cell !== undefined && box.right > cell.right + 1) ||
			(table !== undefined && box.right > table.right - 1)
		);
	});
	if (cut) fault(where, 'the Stash verb runs past its cell');
}

async function checkStrip(page: Page, where: string): Promise<void> {
	const strip = await page.locator('main .strip').first().innerText();
	if (playing !== strip.includes(BOX.projFinal))
		fault(where, `the strip ${playing ? 'lacks' : 'says'} ${BOX.projFinal}: "${strip}"`);
}

for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const ctx = await browser.newContext({
			viewport: { width, height: HEIGHTS[width] },
			colorScheme: theme,
			deviceScaleFactor: width < 500 ? 2 : 1
		});
		watchData(ctx);
		await installFixtureApiClock(ctx, API_ORIGIN);
		await ctx.addInitScript(
			([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
			[THEME_STORAGE_KEY, theme] as const
		);
		const page = await ctx.newPage();
		const at = `${theme} ${String(width)}`;
		const file = (name: string): string =>
			new URL(`${name}-${at.replace(' ', '-')}.png`, out).pathname;

		// The front door signed out: the heading's run words (B96).
		await page.goto(`${web}/`, { waitUntil: 'networkidle' });
		await page.locator('main').first().waitFor({ timeout: READY_TIMEOUT_MS });
		await common(page, `front ${at}`);
		await page.screenshot({ path: file('front') });

		await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
		await settle(page, `${LEAGUE}/waivers`, WAIVERS.beats);
		await common(page, `waivers ${at}`);
		await checkStash(page, `waivers ${at}`);
		await page.screenshot({
			path: file(expectStash ? 'waivers-stash' : 'waivers-no-stash'),
			fullPage: true
		});

		await settle(page, `${LEAGUE}/start`, BOX.proj);
		await common(page, `lineup ${at}`);
		await checkStrip(page, `lineup ${at}`);
		await page.screenshot({ path: file('lineup') });
		await ctx.close();
	}
}

await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`stash shots in ${out.pathname}\n`);
