// Screenshots of the account page's Your plan card for an account holding a granted Membership, in
// both themes at 1440 and 390 (touch, DPR 2), full page, against a local api and web dev server.
//
//   node scripts/plan-card-shots.ts [web origin] [out dir, default the ledger's plan-card-shots/]
//
// MEMBER is a session:csrf pair from `go run ./tools/roommeasure session -handle <name>` in api/,
// for an account granted a Membership with `api grant <account-id> membership <days>`. The script
// only reads: it opens the account page and waits for the grant's line.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const DESK_HEIGHT = 900;
const PHONE_HEIGHT = 844;
const PHONE_WIDTH = 390;
const READY_TIMEOUT_MS = 30_000;
/** The grant's line, the proof the card read the Membership and not Free. */
const READY = 'Granted, good through';

const web = process.argv[2] ?? 'http://localhost:5173';
const out = new URL(
	process.argv[3] ?? '../../.superpowers/sdd/2026-10-12-prep-site/plan-card-shots/',
	import.meta.url
);
const member = process.env.MEMBER;
if (!member) throw new Error('MEMBER is required');
const [session = '', csrf = ''] = member.split(':');

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const phone = width === PHONE_WIDTH;
		const ctx = await browser.newContext({
			viewport: { width, height: phone ? PHONE_HEIGHT : DESK_HEIGHT },
			deviceScaleFactor: phone ? 2 : 1,
			isMobile: phone,
			hasTouch: phone,
			colorScheme: theme
		});
		await ctx.addCookies([
			{ name: 'commish_session', value: session, domain: 'localhost', path: '/' },
			{ name: 'commish_csrf', value: csrf, domain: 'localhost', path: '/' }
		]);
		await ctx.addInitScript(
			([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
			[THEME_STORAGE_KEY, theme] as const
		);
		const page = await ctx.newPage();
		await page.goto(`${web}/account`, { waitUntil: 'networkidle' });
		await page
			.getByText(READY)
			.filter({ visible: true })
			.first()
			.waitFor({ timeout: READY_TIMEOUT_MS });
		await page.evaluate(() => document.fonts.ready);
		const file = new URL(`account-granted-${theme}-${String(width)}.png`, out);
		await page.screenshot({ path: file.pathname, fullPage: true });
		// The phone's fixed tab bar sits over the card in a full-page shot, so the card is shot alone too.
		const card = new URL(`plan-card-${theme}-${String(width)}.png`, out);
		await page
			.getByRole('complementary', { name: 'Your plan' })
			.screenshot({ path: card.pathname });
		await ctx.close();
		process.stdout.write(`${file.pathname}\n${card.pathname}\n`);
	}
}
await browser.close();
