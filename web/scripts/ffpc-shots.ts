// Screenshots of FFPC read as the member, against a local api run with FFPC_BASE_URL at the stand-in
// (api/tools/ffpcfake, the founder's captured pages), in both themes at 1440 and 390: the attach
// page's FFPC sign-in, the member's FFPC leagues to tap, the FFPC league's page, and the account's
// connected accounts and paired devices with a pairing code shown.
//
//   node scripts/ffpc-shots.ts [web origin] [out dir]
//
// OWNER and FRESH are session:csrf pairs from `go run ./tools/roommeasure session -handle <name>` in
// api/. OWNER is connected to the stand-in (password "replay"), has league 104870 attached and one
// paired device; FRESH has nothing.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
/** The founder's league in the captured pages. */
const LEAGUE = '104870';
const STANDIN_PASSWORD = 'replay';

const web = process.argv[2] ?? 'http://localhost:5173';
const out = new URL(process.argv[3] ?? '../screenshots/ffpc/', import.meta.url);
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

const owner = drafter('OWNER');
const fresh = drafter('FRESH');

async function call<T>(
	who: Drafter | null,
	method: string,
	path: string,
	body?: unknown
): Promise<T> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (who) {
		headers.Cookie = `commish_session=${who.session}`;
		headers['X-CSRF-Token'] = who.csrf;
	}
	const response = await fetch(`${api}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const envelope = await response.json<{ ok: boolean; data: T; error: { message: string } }>();
	if (!envelope.ok) throw new Error(`${method} ${path}: ${envelope.error.message}`);
	return envelope.data;
}

/** The owner connected, the league attached, one browser paired. */
async function seed(): Promise<string> {
	await call(owner, 'POST', '/hosts/ffpc/connect', {
		email: 'founder@example.invalid',
		password: STANDIN_PASSWORD,
		consent: true
	});
	const league = await call<{ id: string }>(owner, 'POST', '/leagues/attach', {
		host: 'ffpc',
		link: LEAGUE,
		me: {}
	});
	const devices = await call<unknown[]>(owner, 'GET', '/devices');
	if (devices.length === 0) {
		const code = await call<{ code: string }>(owner, 'POST', '/devices/codes');
		await call(null, 'POST', '/devices/pair', { code: code.code, name: 'Chrome on a Mac' });
	}
	return league.id;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number, who: Drafter | null): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light'
	});
	if (who) {
		await ctx.addCookies([
			{ name: 'commish_session', value: who.session, domain: 'localhost', path: '/' },
			{ name: 'commish_csrf', value: who.csrf, domain: 'localhost', path: '/' }
		]);
	}
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function shoot(
	name: string,
	who: Drafter | null,
	path: string,
	ready: string,
	act?: (page: Page) => Promise<void>
): Promise<void> {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await context(theme, width, who);
			const page = await ctx.newPage();
			await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
			if (act) await act(page);
			await page
				.getByText(ready)
				.filter({ visible: true })
				.first()
				.waitFor({ timeout: READY_TIMEOUT_MS });
			await page.waitForLoadState('networkidle');
			await page.evaluate(() => document.fonts.ready);
			const file = new URL(`${name}-${theme}-${String(width)}.png`, out);
			await page.screenshot({ path: file.pathname, fullPage: true });
			await ctx.close();
			process.stdout.write(`${file.pathname}\n`);
		}
	}
}

const pickFFPC = async (page: Page): Promise<void> => {
	await page.getByRole('button', { name: 'FFPC', exact: true }).click();
};

const id = await seed();
await shoot('new-ffpc-signin', fresh, '/league/new', 'Connect FFPC', pickFFPC);
await shoot('new-ffpc-leagues', owner, '/league/new', 'Follow my league', pickFFPC);
await shoot('league-ffpc', owner, `/league/${id}`, 'Waiver pool');
await shoot('account', owner, '/account', 'Paired devices', async (page) => {
	await page.getByRole('button', { name: 'Pair a device' }).click();
});
await browser.close();
