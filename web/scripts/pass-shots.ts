// Screenshots of the Draft Pass pages against a local api run with BILLING_FAKE=true, in both themes
// at 1440 and 390: the pass page signed out, free, back from a closed checkout, holding the pass and
// as a member; the account page back from checkout and with a group pass's seats; the claim page
// signed out, open, claimed, covered by a Membership, and a link that opens nothing.
//
//   node scripts/pass-shots.ts [web origin] [out dir]
//
// FRESH, HOLDER, BUYER, CLAIMER and MEMBER are session:csrf pairs from
// `go run ./tools/roommeasure session -handle <name>` in api/: a drafter with nothing, one with the
// Draft Pass, one who bought a group pass, one who claimed a seat of it, and a member. Their state is
// made by the shots/setup step of the Lane 8 walk, not here.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 20_000;

const web = process.argv[2] ?? 'http://localhost:5173';
const out = new URL(process.argv[3] ?? '../screenshots/pass/', import.meta.url);
const api = process.env.API ?? 'http://localhost:8080';

interface Drafter {
	session: string;
	csrf: string;
}

function drafter(name: string): Drafter {
	const [session = '', csrf = ''] = (process.env[name] ?? '').split(':');
	if (!session || !csrf) throw new Error(`${name} is required as session:csrf`);
	return { session, csrf };
}

const fresh = drafter('FRESH');
const holder = drafter('HOLDER');
const buyer = drafter('BUYER');
const claimer = drafter('CLAIMER');
const member = drafter('MEMBER');

interface GroupPass {
	claim_url: string;
}

async function claimPath(): Promise<string> {
	const response = await fetch(`${api}/billing/group-passes`, {
		headers: { Cookie: `commish_session=${buyer.session}` }
	});
	const body = await response.json<{ data: GroupPass[] }>();
	const first = body.data[0];
	if (!first) throw new Error('BUYER has no group pass: run the walk first');
	return new URL(first.claim_url).pathname;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(
	theme: (typeof THEMES)[number],
	width: number,
	who: Drafter | null
): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme
	});
	if (who)
		await ctx.addCookies([
			{ name: 'commish_session', value: who.session, domain: 'localhost', path: '/' },
			{ name: 'commish_csrf', value: who.csrf, domain: 'localhost', path: '/' }
		]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function shoot(
	name: string,
	path: string,
	ready: string,
	who: Drafter | null
): Promise<void> {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await context(theme, width, who);
			const page = await ctx.newPage();
			await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
			await page
				.getByText(ready)
				.filter({ visible: true })
				.first()
				.waitFor({ timeout: READY_TIMEOUT_MS });
			await page.evaluate(() => document.fonts.ready);
			const file = new URL(`${name}-${theme}-${String(width)}.png`, out);
			await page.screenshot({ path: file.pathname, fullPage: true });
			await ctx.close();
			process.stdout.write(`${file.pathname}\n`);
		}
	}
}

const claim = await claimPath();
await shoot('pass-signed-out', '/pass', 'Get the Draft Pass', null);
await shoot('pass-free', '/pass', 'Get the Draft Pass', fresh);
await shoot('pass-canceled', '/pass?checkout=canceled', 'Nothing was charged', fresh);
await shoot('pass-holder', '/pass', 'Everything in it is on your account', holder);
await shoot('pass-member', '/pass', 'Everything in it is on your account', member);
await shoot('account-done', '/account?checkout=done&bought=draft_pass', 'Thanks.', holder);
await shoot('account-group', '/account', 'Your group passes', buyer);
await shoot('account-member', '/account', 'renews', member);
await shoot('claim-signed-out', claim, 'Sign in to claim your pass', null);
await shoot('claim-open', claim, 'Claim my pass', fresh);
await shoot('claim-yours', claim, 'Your Draft Pass is on', claimer);
await shoot('claim-covered', claim, 'leave this one for a teammate', member);
await shoot(
	'claim-missing',
	'/claim/AAAAAAAAAAAAAAAAAAAAAA',
	'This link does not open a pass',
	null
);
await browser.close();
