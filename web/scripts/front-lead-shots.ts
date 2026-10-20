// Screenshots of the front door keeping the member's league (Lane 102): signed in on the fixture's
// Monday night with the selected Sleeper league's game final and the ESPN stand-in's still under way
// (FIXTURE_LEAD_FINAL=1), the live league's card leading, headed Live now, the selected league in
// full after it; signed in after opening the ESPN league's page, the switch still the Sleeper
// league's and no PUT /me/league sent; and signed out, the board strip's heads, tiers and basis and
// the header's "Updated" stamp. In both themes at 1280 and 390. Exits non-zero on any fault.
//
//   node scripts/front-lead-shots.ts [web origin] [out dir]
// with the site built with PUBLIC_API_URL naming the fixture API (API_ORIGIN, default
// http://localhost:8799), started with FIXTURE_LEAD_FINAL=1 FIXTURE_CLOCK=2026-10-20T00:40:00.000Z.
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import {
	FIXTURE_LIVE_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const web = process.argv[2] ?? 'http://localhost:4196';
const out = process.argv[3] ?? new URL('../screenshots/front-lead/', import.meta.url).pathname;
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN, FIXTURE_LIVE_CLOCK);

const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const ZONE = 'America/Chicago';
const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const PHONE_MAX = 760;
const HEIGHT = { desk: 900, phone: 844 } as const;
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 800;
const LIVE_NOW = 'Live now';
const SWITCH_LABEL = 'S.U.C.K.';
/** The ESPN stand-in's name, on its own page. */
const ESPN_LEAGUE = 'Office League';
const STAMP = 'Updated';
const BANNED = [/\bRun of\b/i, /\bstrip\b/i, /as of the run/i];

const faults: string[] = [];

async function assertWords(page: Page, name: string): Promise<void> {
	const text = await page.locator('body').innerText();
	for (const banned of BANNED) {
		if (banned.test(text)) faults.push(`${name}: says ${String(banned)}`);
	}
	if (!text.includes(STAMP) && !text.toUpperCase().includes(STAMP.toUpperCase())) {
		faults.push(`${name}: no "${STAMP}" stamp`);
	}
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const phone = width <= PHONE_MAX;
		for (const signedIn of [true, false]) {
			const ctx = await browser.newContext({
				viewport: { width, height: phone ? HEIGHT.phone : HEIGHT.desk },
				colorScheme: theme,
				deviceScaleFactor: phone ? 2 : 1,
				timezoneId: ZONE
			});
			await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value), [
				THEME_STORAGE_KEY,
				theme
			] as const);
			await installFixtureApiClock(ctx, API_ORIGIN);
			if (signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
			const page = await ctx.newPage();
			const puts: string[] = [];
			page.on('request', (req) => {
				if (req.method() === 'PUT' && req.url().includes('/me/league')) puts.push(req.url());
			});
			const tag = `${signedIn ? 'signed-in' : 'signed-out'}-${theme}-${String(width)}`;
			await page.goto(`${web}/`, { waitUntil: 'networkidle' });
			try {
				const ready = signedIn ? page.getByText(LIVE_NOW) : page.locator('.front .row').first();
				await ready.first().waitFor({ timeout: READY_TIMEOUT_MS });
			} catch {
				faults.push(`front-${tag}: not ready`);
			}
			await page.waitForTimeout(SETTLE_MS);
			await assertWords(page, `front-${tag}`);
			await page.screenshot({ path: `${out}/front-${tag}.png`, fullPage: true });
			if (signedIn) {
				// Open the live league's page, then come back: the selection is the member's.
				await page.goto(`${web}/league/${FIXTURE_IDS.espnDone}`, { waitUntil: 'networkidle' });
				try {
					await page.getByText(ESPN_LEAGUE).first().waitFor({ timeout: READY_TIMEOUT_MS });
				} catch {
					faults.push(`espn-league-${tag}: the league's page did not draw`);
				}
				await page.waitForTimeout(SETTLE_MS);
				await page.screenshot({ path: `${out}/espn-league-${tag}.png` });
				await page.goto(`${web}/`, { waitUntil: 'networkidle' });
				try {
					await page.getByText(LIVE_NOW).first().waitFor({ timeout: READY_TIMEOUT_MS });
				} catch {
					faults.push(`front-after-${tag}: the live league no longer leads`);
				}
				await page.waitForTimeout(SETTLE_MS);
				if (!phone) {
					const label = await page.locator('header, .bar').first().innerText();
					if (!label.includes(SWITCH_LABEL)) faults.push(`front-after-${tag}: the switch changed`);
				}
				if (puts.length > 0) faults.push(`${tag}: opening a league sent PUT /me/league`);
				await page.screenshot({ path: `${out}/front-after-league-${tag}.png` });
			}
			await ctx.close();
		}
	}
}
await browser.close();
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`Shots in ${out}, 0 faults.\n`);
