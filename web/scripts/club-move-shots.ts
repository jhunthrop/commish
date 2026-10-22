// Screenshots of a player page whose club is not the one his newest game line was for (Lane 120, B100),
// at 1280 and 390 in both themes, signed out, on the fixture API's clock. Each asserts what it shows:
// the card names his club now, the line under it says which club his newest game was for, his weeks
// before his first line say he did not play with no opponent, and the page's copy passes the one guard
// (copy-scan.ts).
// STAND-IN, named here and in the lane's report: Jahmyr Gibbs as a constructed mover. The in-season
// contract fixture's page rewritten by the research writer's rules (`season_block`, `last_game_club`):
// his week 5 and 6 lines for LAC, the provider's list read two days after his week 6 game naming DET.
// That run is written by `node scripts/inseason-fixture/mover-run.ts mover` (2026-10-21T12-mover). Build
// the site from it (PUBLIC_RUN_ID=2026-10-21T12-mover PUBLIC_RUN_BASE_URL=.runs) and start the fixture
// API with FIXTURE_RUN_ID=2026-10-21T12-mover and FIXTURE_CLOCK at the clock to shoot:
//
//   node scripts/club-move-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { copyFault, watchData } from './copy-scan.ts';
import { lastGameClubWords, UNKNOWN_CLUB_WEEK } from '../src/lib/player/club-words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { fixtureApiClock, installFixtureApiClock } from './inseason-fixture/clock.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const VIEWPORT_HEIGHT = 900;
const ZONE = 'America/Chicago';
const READY_TIMEOUT_MS = 30_000;
const SLUG = 'jahmyr-gibbs';
/** The page's line, as the build words it from the run's clubs (Lions, Chargers). */
const NOTE = lastGameClubWords({ nickname: 'Lions' }, 6, { nickname: 'Chargers' });
/** His weeks with no line before his first one. */
const UNKNOWN_WEEKS = [1, 2, 3, 4];

const web = process.argv[2] ?? 'http://localhost:4173';
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
if ((await fixtureApiClock(API_ORIGIN)).clock === null)
	throw new Error(`The fixture API at ${API_ORIGIN} runs on the real clock.`);
const out = new URL(process.argv[3] ?? '../screenshots/club-move/', import.meta.url);
await mkdir(out, { recursive: true });

interface Seen {
	team: string;
	rows: { week: string; opponent: string }[];
}

const browser = await chromium.launch();
const faults: string[] = [];
try {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await browser.newContext({
				viewport: { width, height: VIEWPORT_HEIGHT },
				timezoneId: ZONE,
				colorScheme: theme
			});
			watchData(ctx);
			await installFixtureApiClock(ctx, API_ORIGIN);
			await ctx.addInitScript(
				([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
				[THEME_STORAGE_KEY, theme] as const
			);
			const page = await ctx.newPage();
			await page.goto(`${web}/players/${SLUG}`, { waitUntil: 'networkidle' });
			await page.getByText(NOTE).first().waitFor({ timeout: READY_TIMEOUT_MS });
			await page.evaluate(() => document.fonts.ready);
			const seen: Seen = await page.evaluate(() => ({
				team: document.querySelector('main .card')?.textContent ?? '',
				rows: [...document.querySelectorAll('main table tbody tr')].map((tr) => ({
					week: tr.querySelector('td, th')?.textContent.trim() ?? '',
					opponent: tr.querySelector('.opp')?.textContent.trim() ?? ''
				}))
			}));
			const where = `${theme} ${String(width)}`;
			if (!seen.team.includes('Lions')) faults.push(`${where}: the card does not name the Lions`);
			for (const week of UNKNOWN_WEEKS) {
				const row = seen.rows.find((r) => r.week === String(week));
				if (row?.opponent !== UNKNOWN_CLUB_WEEK)
					faults.push(`${where}: week ${String(week)} reads "${row?.opponent ?? 'nothing'}"`);
			}
			const copy = await copyFault(page, undefined, 'body');
			if (copy !== null) faults.push(`${where}: says ${copy}`);
			await page.screenshot({
				path: new URL(`${SLUG}-${theme}-${String(width)}.png`, out).pathname,
				fullPage: true
			});
			await ctx.close();
		}
	}
} finally {
	await browser.close();
}
if (faults.length > 0) throw new Error(faults.join('\n'));
process.stdout.write(
	`club-move shots: ${String(THEMES.length * WIDTHS.length)} in ${out.pathname}\n`
);
