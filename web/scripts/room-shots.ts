// Screenshots of the rooms signed in, against a local api and room service: setup, the solo room at
// round 5, its shared link, its report, a lobby filling and drafting, and one closed unattended, in
// both themes at 1440 and 390, into screenshots/ (git-ignored).
//
//   node scripts/room-shots.ts [web origin]
//
// SESSION and CSRF are the drafter's cookies, HELPERS three more drafters as session:csrf pairs, each
// from `go run ./tools/roommeasure session -handle <name>` in api/ against the same local database.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const OUT_DIR = new URL('../screenshots/', import.meta.url);
/** The lobby fills for 90 seconds, then the room drafts this long before the shot. */
const FILL_WAIT_MS = 92_000;
const DRAFT_WAIT_MS = 25_000;

const web = process.argv[2] ?? 'http://localhost:5173';
const api = process.env.API ?? 'http://localhost:8080';
const session = required('SESSION');
const csrf = required('CSRF');
const helpers = (process.env.HELPERS ?? '')
	.split(',')
	.filter((pair) => pair !== '')
	.map((pair) => {
		const [s = '', c = ''] = pair.split(':');
		return { session: s, csrf: c } satisfies Drafter;
	});

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

interface Drafter {
	session: string;
	csrf: string;
}

interface Envelope<T> {
	ok: boolean;
	data: T;
	error: { message: string } | null;
}

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
	const envelope = await response.json<Envelope<T>>();
	if (!envelope.ok)
		throw new Error(`${method} ${path}: ${envelope.error?.message ?? response.status}`);
	return envelope.data;
}

const me: Drafter = { session, csrf };
await mkdir(OUT_DIR, { recursive: true });
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
	who: Drafter | null = me
): Promise<void> {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await context(theme, width, who);
			const page = await ctx.newPage();
			await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
			await page.getByText(ready).first().waitFor({ timeout: 20_000 });
			await page.evaluate(() => document.fonts.ready);
			const file = new URL(`${name}-${theme}-${width}.png`, OUT_DIR);
			await page.screenshot({ path: file.pathname, fullPage: true });
			await ctx.close();
			process.stdout.write(`${file.pathname}\n`);
		}
	}
}

/** A drafter's tab open on the lobby, its socket connected, until the context closes. */
async function hold(roomId: string, who: Drafter): Promise<BrowserContext> {
	const ctx = await context('dark', WIDTHS[0], who);
	const page = await ctx.newPage();
	await page.goto(`${web}/lobby/${roomId}`, { waitUntil: 'networkidle' });
	return ctx;
}

try {
	await shoot('mock-new', '/mock/new', 'Start against bots');
	await shoot('mock-new-signed-out', '/mock/new', 'Sign in to keep it', null);

	interface Room {
		id: string;
		pick_number: number;
		share_code: string;
	}
	const settings = {
		scoring: { preset: 'ppr' },
		teams: 12,
		slot: 8,
		roster: { qb: 1, rb: 2, wr: 2, te: 1, k: 1, dst: 1, bench: 6 },
		lineup: 'standard',
		keepers: [],
		bot_style: 'adp'
	};
	const created = await call<Room>(me, 'POST', '/mocks', { settings, seed: 2026 });
	await call<Room>(me, 'POST', `/mocks/${created.id}/autopick?to_round=4`);
	await shoot('mock-room', `/mock/${created.id}`, 'Our call at');
	// The same draft as a friend opens its link, signed out in a fresh browser.
	const midway = await call<Room>(me, 'GET', `/mocks/${created.id}`);
	await shoot('mock-shared', `/mock/share/${midway.share_code}`, 'Run this draft from slot', null);
	await call<Room>(me, 'POST', `/mocks/${created.id}/finish`);
	await shoot('mock-report', `/mock/${created.id}/report`, 'The field');

	interface Seat {
		room_id: string;
	}
	// A lobby joined and left unattended: nobody is here when it fills, so it closes, and opening it
	// after the fill window shows the closed state with the verb to join another.
	const lonely = await call<Seat>(me, 'POST', '/lobbies/join', { format: '10_ppr' });
	const seat = await call<Seat>(me, 'POST', '/lobbies/join', { format: '12_ppr' });
	for (const helper of helpers)
		await call<Seat>(helper, 'POST', '/lobbies/join', { format: '12_ppr' });
	// Every drafter holds the lobby open in a tab, as a person waiting in it does: a seat with no
	// socket at the fill deadline is not counted as there.
	const present = await Promise.all([me, ...helpers].map((who) => hold(seat.room_id, who)));
	await shoot('lobby-filling', `/lobby/${seat.room_id}`, 'The draft starts when');
	await new Promise((done) => setTimeout(done, FILL_WAIT_MS));
	await shoot('lobby-abandoned', `/lobby/${lonely.room_id}`, 'Join another lobby');
	// The helpers step away once the room starts, so their queues draft at a bot's pace.
	for (const helper of helpers) await call<null>(helper, 'POST', `/lobbies/${seat.room_id}/leave`);
	await Promise.all(present.slice(1).map((ctx) => ctx.close()));
	await new Promise((done) => setTimeout(done, DRAFT_WAIT_MS));
	await shoot('lobby-room', `/lobby/${seat.room_id}`, 'just taken, newest first');
	await present[0]?.close();
} finally {
	await browser.close();
}
