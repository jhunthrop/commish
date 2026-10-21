// Screenshots of one board for a signed-in member (Lane 96 fix round 1, B08): the front door and /board,
// signed out and signed in, at 1280 and 390, against the fixture API on the fixture week's clock and
// the site built on the one-board run (inseason-fixture/one-board-run.ts, made Thursday morning, before
// week 6's Thursday game). It asserts that the signed-out front door prints the run's figures with the
// run's time ("Projected and Over replacement updated 8:50 am Central"), that the signed-in one prints the API's order, its lead
// naming the league's shape and the read, with no run stamp, and that /board reads the API's order
// either way. Exits non-zero on any fault.
//
//   node scripts/one-board-shots.ts [web origin] [out dir]
// with the site built with PUBLIC_RUN_ID=2026-10-15T13-oneboard PUBLIC_RUN_BASE_URL=.runs against
// PUBLIC_API_URL naming the fixture API (API_ORIGIN, default http://localhost:8799), started with
// FIXTURE_RUN_ID=2026-10-15T13-oneboard FIXTURE_CLOCK=2026-10-17T17:00:00.000Z.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installFixtureApiClock, requireFixtureClock } from './inseason-fixture/clock.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
const out = process.argv[3] ?? new URL('../screenshots/one-board/', import.meta.url).pathname;
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);

const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const ZONE = 'America/Chicago';
const WIDTHS = [1280, 390] as const;
const PHONE_MAX = 760;
const HEIGHT = { desk: 900, phone: 844 } as const;
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 600;
const RUN_STAMP = 'Over replacement updated 8:50 am Central';
const LIVE_LEAD = "for 12 teams, your league's shape, read";
/** The API's order drawn as its box score (OrderScreen's table). */
const ORDER_TABLE = 'table.order';

interface Shot {
	name: string;
	path: string;
	signedIn: boolean;
	/** Words the page prints, or the selector its API read draws. */
	said: string;
	table?: boolean;
	unsaid?: string;
}
const SHOTS: readonly Shot[] = [
	{ name: 'front-signed-out', path: '/', signedIn: false, said: RUN_STAMP },
	{ name: 'front-signed-in', path: '/', signedIn: true, said: LIVE_LEAD, unsaid: RUN_STAMP },
	{
		name: 'board-signed-out',
		path: '/board/ppr-12',
		signedIn: false,
		said: ORDER_TABLE,
		table: true
	},
	{ name: 'board-signed-in', path: '/board/ppr-12', signedIn: true, said: ORDER_TABLE, table: true }
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];
for (const width of WIDTHS) {
	const phone = width <= PHONE_MAX;
	for (const shot of SHOTS) {
		const ctx = await browser.newContext({
			viewport: { width, height: phone ? HEIGHT.phone : HEIGHT.desk },
			colorScheme: 'dark',
			deviceScaleFactor: phone ? 2 : 1,
			timezoneId: ZONE
		});
		await installFixtureApiClock(ctx, API_ORIGIN);
		if (shot.signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
		const page = await ctx.newPage();
		await page.goto(`${web}${shot.path}`, { waitUntil: 'networkidle' });
		try {
			const ready =
				shot.table === true ? page.locator(shot.said) : page.getByText(shot.said, { exact: false });
			await ready.first().waitFor({ timeout: READY_TIMEOUT_MS });
		} catch {
			faults.push(`${shot.name} at ${String(width)}: no "${shot.said}"`);
		}
		await page.waitForTimeout(SETTLE_MS);
		if (shot.unsaid !== undefined && (await page.getByText(shot.unsaid).count()) > 0) {
			faults.push(`${shot.name} at ${String(width)}: still "${shot.unsaid}"`);
		}
		await page.screenshot({ path: `${out}/${shot.name}-${String(width)}.png`, fullPage: true });
		await ctx.close();
	}
}
await browser.close();
for (const fault of faults) process.stdout.write(`FAULT ${fault}\n`);
process.stdout.write(`${String(faults.length)} faults, shots in ${out}\n`);
process.exitCode = faults.length === 0 ? 0 : 1;
