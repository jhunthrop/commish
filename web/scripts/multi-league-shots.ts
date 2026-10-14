// Screenshots of following several leagues, against a local api with FFPC_BASE_URL at the stand-in
// (api/tools/ffpcfake) and COMPANION_REPLAY on, in both themes at 1440 and 390: the FFPC picker for a
// Membership (every league chosen, "Follow my leagues") and for a free account (one league, the line
// on the rest), the done state after one tap (the stand-in serves one league, so the second is
// named as missed), the account's list with the summary, the league page's title switch open, the
// free account's list, and the IR mark on the system page.
//
//   node scripts/multi-league-shots.ts [web origin] [out dir]
//
// MEMBER and FREE are session:csrf pairs from `go run ./tools/roommeasure session -handle <name>` in
// api/. MEMBER holds a Membership grant; FREE holds nothing. Both start with no league.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 60_000;
const STANDIN_PASSWORD = 'replay';
/** The stand-in's one league, and the recorded Sleeper league COMPANION_REPLAY serves. */
const FFPC_LEAGUE = '104870';
const SLEEPER_LINK = 'https://sleeper.com/leagues/1382163311038038016/team';

const web = process.argv[2] ?? 'http://localhost:5173';
const out = new URL(process.argv[3] ?? '../screenshots/multi-league/', import.meta.url);
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

const member = drafter('MEMBER');
const free = drafter('FREE');

async function call<T>(who: Drafter, method: string, path: string, body?: unknown): Promise<T> {
	const response = await fetch(`${api}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			Cookie: `commish_session=${who.session}`,
			'X-CSRF-Token': who.csrf
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const envelope = await response.json<{ ok: boolean; data: T; error: { message: string } }>();
	if (!envelope.ok) throw new Error(`${method} ${path}: ${envelope.error.message}`);
	return envelope.data;
}

async function connect(who: Drafter): Promise<void> {
	await call(who, 'POST', '/hosts/ffpc/connect', {
		email: 'shots@example.invalid',
		password: STANDIN_PASSWORD,
		consent: true
	});
}

/** Detaches every league the account follows, so the picker starts with none. */
async function detachAll(who: Drafter): Promise<void> {
	for (const league of await call<{ id: string }[]>(who, 'GET', '/leagues/attached')) {
		await call(who, 'DELETE', `/leagues/attached/${league.id}`);
	}
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number, who: Drafter): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light'
	});
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

interface Shot {
	name: string;
	who: Drafter;
	path: string;
	ready: string;
	before?: () => Promise<void>;
	act?: (page: Page) => Promise<void>;
	/** Wait for these words after act, when the act leads somewhere new. */
	after?: string;
}

async function visible(page: Page, words: string): Promise<void> {
	await page
		.getByText(words)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
}

async function shoot(shot: Shot): Promise<void> {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			if (shot.before) await shot.before();
			const ctx = await context(theme, width, shot.who);
			const page = await ctx.newPage();
			await page.goto(`${web}${shot.path}`, { waitUntil: 'networkidle' });
			await visible(page, shot.ready);
			if (shot.act) await shot.act(page);
			if (shot.after) await visible(page, shot.after);
			await page.waitForLoadState('networkidle');
			await page.evaluate(() => document.fonts.ready);
			const file = new URL(`${shot.name}-${theme}-${String(width)}.png`, out);
			await page.screenshot({ path: file.pathname, fullPage: true });
			await ctx.close();
			process.stdout.write(`${file.pathname}\n`);
		}
	}
}

const PICKER = '/league/new?host=ffpc';

await connect(member);
await connect(free);
await detachAll(member);
await detachAll(free);

await shoot({ name: 'picker-membership', who: member, path: PICKER, ready: 'Follow my leagues' });
await shoot({ name: 'picker-free', who: free, path: PICKER, ready: 'One league is free' });
await shoot({
	name: 'done',
	who: member,
	path: PICKER,
	ready: 'Follow my leagues',
	before: () => detachAll(member),
	act: async (page) => {
		await page.getByRole('button', { name: 'Follow my leagues' }).click();
	},
	after: 'Following 1 league.'
});

// The member now follows the FFPC league; a Sleeper league makes two.
await call(member, 'POST', '/leagues/attach', { link: SLEEPER_LINK, me: { roster_id: 1 } });
const followed = await call<{ id: string; host: string }[]>(member, 'GET', '/leagues/attached');
const ffpc = followed.find((l) => l.host === 'ffpc');
if (!ffpc) throw new Error('the member does not follow the FFPC league');
await shoot({
	name: 'account-followed',
	who: member,
	path: '/account?followed=2',
	ready: 'Following 2 leagues.'
});
await shoot({
	name: 'league-switch',
	who: member,
	path: `/league/${ffpc.id}`,
	ready: 'Waiver pool',
	act: async (page) => {
		await page.locator('button.as-title').filter({ visible: true }).first().click();
	},
	after: 'All your leagues'
});

await call(free, 'POST', '/leagues/attach', { host: 'ffpc', link: FFPC_LEAGUE, me: {} });
await shoot({ name: 'account-free', who: free, path: '/account', ready: 'One league is free' });
await shoot({ name: 'picker-free-following', who: free, path: PICKER, ready: 'following' });
await shoot({ name: 'ir-mark', who: free, path: '/system', ready: 'Face, on injured reserve' });
await browser.close();
