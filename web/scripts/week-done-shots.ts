// Screenshots of a locked lineup and a finished week (Lane 91, Lane 109): the front door's lineup card,
// the League page's lineup card and the Lineup's strip, dark at 1280 and 390. Three states of the
// fixture API:
//   STATE=kicked  on the Monday night clock (FIXTURE_CLOCK=2026-10-20T04:00:00.000Z): every starter of
//                 the member's has kicked off and Monday night's is still in play; the three say
//                 Locked from the last kickoff with "has kicked off";
//   STATE=locked  on the Tuesday clock (FIXTURE_CLOCK=2026-10-20T17:00:00.000Z), the API started with
//                 FIXTURE_LATE_FINAL=LV,BUF (inseason-fixture/game-state.ts): the capture has not held
//                 LV at BUF's final, so the member's starters are all final while the opponent's Cook
//                 still plays; the three say Locked, never Final, with "has played", and the score bug
//                 says who is still to play;
//   STATE=final   on the Tuesday clock, every week 6 game final: the three say Final with "has played".
// Each surface passes the one copy guard (copy-scan.ts) and nothing scrolls sideways. Exits non-zero
// on any fault.
//
//   STATE=kicked|locked|final node scripts/week-done-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API, started on the state's clock.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { BOX } from '../src/lib/league/box/box.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_TUESDAY_CLOCK,
	requireFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { WEEK_DONE, WEEK_DONE_KICKED_OFF } from './inseason-fixture/sunday.ts';

/** Each state's card title, the API's sentence beside it and the clock both run on. */
const STATES = {
	kicked: { title: BOX.locked, sentence: WEEK_DONE_KICKED_OFF, clock: FIXTURE_MONDAY_NIGHT_CLOCK },
	locked: { title: BOX.locked, sentence: WEEK_DONE, clock: FIXTURE_TUESDAY_CLOCK },
	final: { title: BOX.final, sentence: WEEK_DONE, clock: FIXTURE_TUESDAY_CLOCK }
} as const;
type State = keyof typeof STATES;
const isState = (s: string | undefined): s is State => s !== undefined && s in STATES;
const state: State = isState(process.env.STATE) ? process.env.STATE : 'final';
const { title, sentence, clock } = STATES[state];
const web = process.argv[2] ?? 'http://localhost:4291';
const out = new URL(process.argv[3] ?? `../screenshots/week-done/${state}/`, import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8891').origin;
const WIDTHS = [1280, 390] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const LEAGUE = `/league/${FIXTURE_IDS.league}`;

interface Surface {
	name: string;
	path: string;
	/** The card's title, the word under "Week 6". */
	title: string;
}
const SURFACES: readonly Surface[] = [
	{ name: 'front', path: '/', title: 'main .nudge .n-head b' },
	{ name: 'league', path: LEAGUE, title: 'main .roster .decide .what b' },
	{ name: 'lineup', path: `${LEAGUE}/start`, title: 'main .strip .head .title' }
];

await requireFixtureClock(API_ORIGIN, clock);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];
const fault = (at: string, what: string): void => {
	faults.push(`${at}: ${what}`);
};

async function context(width: number): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: 'dark',
		deviceScaleFactor: width < 500 ? 2 : 1
	});
	watchData(ctx);
	await ctx.clock.install({ time: new Date(clock) });
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, 'dark'] as const
	);
	return ctx;
}

async function check(page: Page, surface: Surface, at: string): Promise<void> {
	const card = page.locator(surface.title).filter({ visible: true }).first();
	await card.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
	// The card draws its title in capitals (CSS): the word itself is its text.
	const said = ((await card.textContent()) ?? '').trim();
	if (said !== title) fault(at, `the card reads "${said}", not ${title}`);
	const text = await page.locator('main').innerText();
	if (!text.includes(sentence)) fault(at, `the API sentence "${sentence}" is not said`);
	if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
		fault(at, 'scrolls sideways');
	const copy = await copyFault(page);
	if (copy !== null) fault(at, copy);
}

for (const surface of SURFACES) {
	for (const width of WIDTHS) {
		const ctx = await context(width);
		const page = await ctx.newPage();
		const at = `${state} ${surface.name} ${String(width)}`;
		try {
			await page.goto(`${web}${surface.path}`);
			await check(page, surface, at);
			await page.screenshot({
				path: new URL(`${surface.name}-${state}-${String(width)}.png`, out).pathname
			});
			process.stdout.write(`${at}: ${title}\n`);
		} catch (error) {
			fault(at, error instanceof Error ? error.message : String(error));
		} finally {
			await ctx.close();
		}
	}
}
await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`${state}: every surface holds\n`);
