// Screenshots of the league screens during a live game (Lane 92), at 1280 and 390, dark and light at a
// desk and dark in a hand, on Monday night of week 6 (FIXTURE_LIVE_CLOCK): every Sunday game final by
// the hourly status, the Monday game under way. The front door and the ESPN fixture league's home,
// Lineup and Matchup show the score bug's read beside the live score, each side's count ("1 playing"),
// the Pts big with the projected final under it, and the basis saying once that a game past kickoff
// keeps its Proj (the phone Matchup leaves that clause to the desk, Lane 124, and must not draw it);
// Players and Rest of season head the week column "Wk 6" with Pts once final (Rest of season's phone
// in a league says it with what its Proj is in one sentence, Lane 115, B92). It asserts each of those
// words is drawn where its width draws it and exits non-zero on any fault.
//
//   node scripts/live-truth-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API, and the fixture API running there on
// the same clock (FIXTURE_CLOCK=2026-10-20T00:40:00.000Z).
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { AS_OF_KICKOFF, PROJ_FINAL_PART, weekProjPart } from '../src/lib/league/box/basis.ts';
import { BOX } from '../src/lib/league/box/box.ts';
import { weekColumnPart } from '../src/lib/order/order.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import {
	FIXTURE_LIVE_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const web = process.argv[2] ?? 'http://localhost:4192';
const out = new URL(process.argv[3] ?? '../screenshots/live-truth/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8892').origin;
const SHOTS: readonly (readonly ['dark' | 'light', number])[] = [
	['dark', 1280],
	['light', 1280],
	['dark', 390]
];
const PHONE_MAX = 760;
const HEIGHT = 900;
const PHONE_HEIGHT = 844;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const league = FIXTURE_IDS.espnDone;
const READ_CELL = /\b(ESPN|Sleeper) (just now|\d+ min ago)\b/;
/** The week Monday night is in. */
const LIVE_WEEK = 6;

/** The week column's key (order.ts weekColumnPart), and a league's phone order's one sentence for it
 * and its Proj (basis.ts weekProjPart, its scoring and read left to the page's head and the desk). */
const WEEK_KEY = weekColumnPart(LIVE_WEEK);
const WEEK_PHONE = weekProjPart(
	`Wk ${String(LIVE_WEEK)}`,
	{ readAt: null, scoring: { format: 'ppr', league_own: false }, defense: false, league: true },
	{ zone: 'America/Chicago', zoned: false }
);

type Word = string | RegExp;
/** Each screen, the words it must draw while the game is live: at every width, at a desk alone and
 * on a phone alone; and the words a phone must not draw. */
interface Screen {
	name: string;
	path: string;
	must: readonly Word[];
	desk?: readonly Word[];
	phone?: readonly Word[];
	notOnPhone?: readonly Word[];
}
const SCREENS: readonly Screen[] = [
	{ name: 'front', path: '/', must: [BOX.projFinal, READ_CELL] },
	{
		name: 'league',
		path: `/league/${league}`,
		must: [BOX.projFinal, READ_CELL, /\d+ playing|\d+ to play/]
	},
	{ name: 'lineup', path: `/league/${league}/start`, must: [BOX.projFinal, AS_OF_KICKOFF] },
	{
		name: 'matchup',
		path: `/league/${league}/matchup`,
		must: [BOX.projFinal, READ_CELL, PROJ_FINAL_PART],
		desk: [AS_OF_KICKOFF],
		notOnPhone: [AS_OF_KICKOFF]
	},
	{ name: 'players', path: '/players', must: [WEEK_KEY] },
	{ name: 'rest', path: '/board/ppr-12/rb', must: [], desk: [WEEK_KEY], phone: [WEEK_PHONE] }
];

const drawnIn = (text: string, word: Word): boolean =>
	typeof word === 'string' ? text.includes(word) : word.test(text);

await requireFixtureClock(API_ORIGIN, FIXTURE_LIVE_CLOCK);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

async function context(theme: string, width: number): Promise<BrowserContext> {
	const phone = width <= PHONE_MAX;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? PHONE_HEIGHT : HEIGHT },
		colorScheme: theme as 'light',
		deviceScaleFactor: phone ? 2 : 1
	});
	// The API's own instant now, so every read stamp is as old to the page as to the API.
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle', { timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
}

for (const [theme, width] of SHOTS) {
	const ctx = await context(theme, width);
	const page = await ctx.newPage();
	for (const screen of SCREENS) {
		await page.goto(`${web}${screen.path}`);
		await settle(page);
		const text = await page.locator('main').innerText();
		const phone = width <= PHONE_MAX;
		const where = `${screen.name} ${theme} ${String(width)}`;
		const wants = [...screen.must, ...((phone ? screen.phone : screen.desk) ?? [])];
		for (const word of wants) {
			if (!drawnIn(text, word)) faults.push(`${where}: missing ${String(word)}`);
		}
		for (const word of phone ? (screen.notOnPhone ?? []) : []) {
			if (drawnIn(text, word)) faults.push(`${where}: draws ${String(word)}`);
		}
		const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
		if (wide) faults.push(`${screen.name} ${theme} ${String(width)}: scrolls sideways`);
		await page.screenshot({
			path: new URL(`${screen.name}-${theme}-${String(width)}.png`, out).pathname,
			fullPage: true
		});
	}
	await ctx.close();
}
await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`Live truth shots in ${out.pathname}\n`);
