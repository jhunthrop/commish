// Screenshots of the screens whose rest of season runs to the league's last title week (Lane 96, B25):
// Rest of season, Waivers and Trades (signed in, the recorded league chosen) and Players, which keeps
// the run's week 17, dark at 1280 and 390, against
// the fixture API serving the recorded league as one whose playoffs run to week 18 with a two-week
// final (FIXTURE_TITLE_WEEK=18:2) on the fixture week's clock. It asserts each screen prints the
// span through week 18 and names the final, and exits non-zero when one does not.
//
//   node scripts/horizon-shots.ts [web origin] [out dir]
// with the site built on the Saturday run (inseason-fixture/saturday-run.ts) against PUBLIC_API_URL naming the fixture API (API_ORIGIN, default
// http://localhost:8799), started as
//   FIXTURE_CLOCK=2026-10-17T17:00:00.000Z FIXTURE_TITLE_WEEK=18:2 node scripts/inseason-fixture/serve.ts
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installFixtureApiClock, requireFixtureClock } from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
const out = process.argv[3] ?? new URL('../screenshots/horizon/', import.meta.url).pathname;
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);

const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const WIDTHS = [1280, 390] as const;
const PHONE_MAX = 760;
const HEIGHT = { desk: 900, phone: 844 } as const;
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 300;
/** The words every screen's basis carries through week 18. */
const FINAL = 'the final over weeks 17 and 18';
const id = FIXTURE_IDS.league;
const SCREENS = [
	{ name: 'rest', path: '/board/ppr-12/rb', said: `through week 18, ${FINAL}` },
	// Players reads the order with no league: the run's horizon, week 17, whatever the league's.
	{ name: 'players', path: '/players', said: 'through week 17, byes out' },
	{ name: 'waivers', path: `/league/${id}/waivers`, said: `to 18, ${FINAL}` },
	{ name: 'trades', path: `/league/${id}/trades`, said: `to 18, ${FINAL}` }
] as const;

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];
for (const width of WIDTHS) {
	const phone = width <= PHONE_MAX;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? HEIGHT.phone : HEIGHT.desk },
		colorScheme: 'dark',
		deviceScaleFactor: phone ? 2 : 1
	});
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	for (const screen of SCREENS) {
		const page = await ctx.newPage();
		await page.goto(`${web}${screen.path}`, { waitUntil: 'networkidle' });
		try {
			await page
				.getByText(screen.said, { exact: false })
				.first()
				.waitFor({ timeout: READY_TIMEOUT_MS });
		} catch {
			faults.push(`${screen.name} at ${String(width)}: no "${screen.said}"`);
		}
		await page.waitForTimeout(SETTLE_MS);
		await page.screenshot({
			path: `${out}/${screen.name}-dark-${String(width)}.png`,
			fullPage: true
		});
		await page.close();
	}
	await ctx.close();
}
await browser.close();
for (const fault of faults) process.stdout.write(`FAULT ${fault}\n`);
process.stdout.write(`${String(faults.length)} faults, shots in ${out}\n`);
process.exitCode = faults.length === 0 ? 0 : 1;
