// Screenshots of the live-draft companion against a local api run with COMPANION_REPLAY=true and
// BILLING_FAKE=true, in both themes at 1440 and 390: the start page with and without the pass, the
// recorded Sleeper draft replayed at the drafter's turn for a pass holder and for a member (the why on
// every row, the range of outcomes and the synced sheet), between turns, and the report on the
// finished draft.
//
//   node scripts/companion-shots.ts [web origin] [out dir]
//
// FRESH (no pass), PASS (the Draft Pass) and MEMBER are session:csrf pairs from
// `go run ./tools/roommeasure session -handle <name>` in api/. The member's sheet is set to our board's
// top 40 so the synced sheet has rows to strike.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
/** The recorded draft (api/internal/companion/replay). */
const REPLAY_DRAFT = '1382163311050645504';
/** The drafter's slot in the replay, and how long after it starts the shot between turns waits:
 * picks 1 to 4 land at a second each, slot 5 holds 12 seconds, and pick 6 lands after that. */
const SLOT = 5;
const BETWEEN_TURNS_MS = 19_000;
const SHEET_ROWS = 40;

const web = process.argv[2] ?? 'http://localhost:5173';
const out = new URL(process.argv[3] ?? '../screenshots/companion/', import.meta.url);
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
const holder = drafter('PASS');
const member = drafter('MEMBER');

async function call<T>(who: Drafter, method: string, path: string, body?: unknown): Promise<T> {
	const response = await fetch(`${api}${path}`, {
		method,
		headers: {
			Cookie: `commish_session=${who.session}`,
			'X-CSRF-Token': who.csrf,
			'Content-Type': 'application/json'
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const envelope = (await response.json()) as { ok: boolean; data: T; error: { message: string } };
	if (!envelope.ok) throw new Error(`${method} ${path}: ${envelope.error.message}`);
	return envelope.data;
}

interface Made {
	id: string;
}

/** A fresh replay from its first pick, so the shot lands at the same moment every time. */
function replay(who: Drafter): Promise<Made> {
	return call<Made>(who, 'POST', '/companions', {
		host: 'sleeper',
		draft: REPLAY_DRAFT,
		seat: { slot: SLOT },
		replay: true
	});
}

interface BoardPlayer {
	id: string;
	name: string;
	position: string;
	team: string;
	vor: number | null;
}

async function seedSheet(): Promise<void> {
	const board = await call<{ players: BoardPlayer[] }>(member, 'GET', '/boards/ppr');
	const rows = board.players
		.filter((p) => p.vor !== null)
		.sort((a, b) => (b.vor ?? 0) - (a.vor ?? 0))
		.slice(0, SHEET_ROWS)
		.map((p) => ({ player_id: p.id, name: p.name, position: p.position, team: p.team }));
	await call(member, 'POST', '/sheets', { name: 'Draft night', format: 'ppr', rows });
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number, who: Drafter): Promise<BrowserContext> {
	const ctx = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT }, colorScheme: theme as 'light' });
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
	who: Drafter,
	path: () => Promise<string>,
	ready: string,
	waitMs = 0
): Promise<void> {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const to = await path();
			const ctx = await context(theme, width, who);
			const page = await ctx.newPage();
			await page.goto(`${web}${to}`, { waitUntil: 'networkidle' });
			if (waitMs > 0) await page.waitForTimeout(waitMs);
			await page.getByText(ready).filter({ visible: true }).first().waitFor({ timeout: READY_TIMEOUT_MS });
			await page.evaluate(() => document.fonts.ready);
			const file = new URL(`${name}-${theme}-${String(width)}.png`, out);
			await page.screenshot({ path: file.pathname, fullPage: true });
			await ctx.close();
			process.stdout.write(`${file.pathname}\n`);
		}
	}
}

await seedSheet();
const live = await call<Made>(holder, 'POST', '/companions', {
	host: 'sleeper',
	draft: `https://sleeper.com/draft/nfl/${REPLAY_DRAFT}`,
	seat: { slot: 3 }
});
const at = (made: Made): string => `/companion/${made.id}`;
await shoot('new-form', member, () => Promise.resolve('/companion/new'), 'Follow my draft');
await shoot('new-no-pass', fresh, () => Promise.resolve('/companion/new'), 'comes with the Draft Pass');
await shoot('turn-pass', holder, async () => at(await replay(holder)), 'Make the pick on Sleeper');
await shoot('turn-member', member, async () => at(await replay(member)), 'Make the pick on Sleeper');
await shoot('between-turns', member, async () => at(await replay(member)), 'away', BETWEEN_TURNS_MS);
await shoot('report', holder, () => Promise.resolve(at(live)), 'Follow another draft');
await browser.close();
