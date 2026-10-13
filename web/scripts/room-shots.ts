// Screenshots of the rooms against a local api and room service, in both themes at 1440 and 390, into
// screenshots/ (git-ignored). Every state the rooms' UX fixes changed is here:
//
//   setup signed in and out, and refusing a cross-site start; the solo room at its first turn, at
//   round 5, and just after an undo; its shared link; a report at 1st place (Pick for me throughout)
//   and one well down the table (three picks by hand, with hindsight, the rest made for you); a lobby
//   filling, drafting, asking before Leave, closed unattended, and its report; setup after Leave,
//   while the lobby drafts and once it is over.
//
//   node scripts/room-shots.ts [web origin]
//
// SESSION and CSRF are the drafter's cookies, HELPERS three more drafters as session:csrf pairs, each
// from `go run ./tools/roommeasure session -handle <name>` in api/ against the same local database.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const OUT_DIR = new URL('../screenshots/', import.meta.url);
/** The lobby fills for 90 seconds, then the room drafts this long before the shot. */
const FILL_WAIT_MS = 92_000;
const DRAFT_WAIT_MS = 25_000;
/** How long the lobby has to finish once everyone has left it, and how often it is asked. */
const FINISH_WAIT_MS = 10 * 60_000;
const POLL_MS = 3_000;
/** Where setup remembers the lobby Leave came from (src/lib/room/setup/left.ts). */
const LEFT_LOBBY_KEY = 'commish:left-lobby';
/** The refusal an untrusted cross-site start gets (api/internal/solo/owner.go), replayed on localhost. */
const REFUSAL = {
	ok: false,
	data: null,
	error: {
		code: 'forbidden',
		message: 'Mocks start on trycommish.app',
		fields: { site: 'https://trycommish.app' }
	}
};

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

interface BoardPlayer {
	id: string;
	position: string;
	vor: number | null;
}

interface Room {
	id: string;
	pick_number: number;
	share_code: string;
	waiting: boolean;
	picks: { player_id: string }[];
	board?: { players: BoardPlayer[] };
}

interface Seat {
	room_id: string;
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

interface ShotOptions {
	who?: Drafter | null;
	/** Runs in each fresh context before the page opens: a route, a stored value. */
	before?: (ctx: BrowserContext) => Promise<unknown>;
	/** Runs on the open page before the shot: a key, a click. */
	act?: (page: Page) => Promise<void>;
	/** The text the shot waits for after `act`, when it differs from the page's own. */
	after?: string;
}

async function shoot(
	name: string,
	path: string | (() => Promise<string>),
	ready: string,
	{ who = me, before, act, after }: ShotOptions = {}
): Promise<void> {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await context(theme, width, who);
			await before?.(ctx);
			const page = await ctx.newPage();
			const to = typeof path === 'string' ? path : await path();
			await page.goto(`${web}${to}`, { waitUntil: 'networkidle' });
			await page.getByText(ready).filter({ visible: true }).first().waitFor({ timeout: 20_000 });
			if (act) {
				await act(page);
				if (after)
					await page
						.getByText(after)
						.filter({ visible: true })
						.first()
						.waitFor({ timeout: 20_000 });
			}
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

const settings = {
	scoring: { preset: 'ppr' },
	teams: 12,
	slot: 8,
	roster: { qb: 1, rb: 2, wr: 2, te: 1, k: 1, dst: 1, bench: 6 },
	lineup: 'standard',
	keepers: [],
	bot_style: 'adp'
};

/** A new mock at its first turn, seven bots already in. */
function newMock(seed: number): Promise<Room> {
	return call<Room>(me, 'POST', '/mocks', { settings, seed });
}

/** One pick by hand, after reading the turn's card so the pick records the odds the room showed. */
async function pickByHand(room: Room, playerId: string): Promise<Room> {
	await call<unknown>(me, 'GET', `/mocks/${room.id}/card`);
	return call<Room>(me, 'POST', `/mocks/${room.id}/picks`, {
		player_id: playerId,
		pick: room.pick_number
	});
}

/** The undrafted player at a position the board values least: a pick that sinks a team. */
function worstAt(room: Room, players: BoardPlayer[], position: string): string {
	const taken = new Set(room.picks.map((p) => p.player_id));
	const left = players.filter((p) => p.position === position && !taken.has(p.id));
	const worst = left.reduce((low, p) => ((p.vor ?? 0) < (low.vor ?? 0) ? p : low));
	return worst.id;
}

/** A mock finished well down the table: three picks by hand that the board likes least, then
 * Finish the draft, so the report reads a lower rank, hindsight on the hand-made picks, and the
 * rest marked as made for you. */
async function sunkMock(): Promise<string> {
	let room = await newMock(2027);
	const players = room.board?.players ?? [];
	for (const position of ['K', 'DEF', 'QB']) {
		room = await pickByHand(room, worstAt(room, players, position));
	}
	await call<Room>(me, 'POST', `/mocks/${room.id}/finish`);
	return room.id;
}

async function waitForStatus(roomId: string, status: string): Promise<void> {
	const until = Date.now() + FINISH_WAIT_MS;
	while (Date.now() < until) {
		const room = await call<{ status: string }>(me, 'GET', `/lobbies/${roomId}`);
		if (room.status === status) return;
		await new Promise((done) => setTimeout(done, POLL_MS));
	}
	throw new Error(`lobby ${roomId} never reached ${status}`);
}

try {
	await shoot('mock-new', '/mock/new', 'Start against bots');
	await shoot('mock-new-signed-out', '/mock/new', 'Sign in to keep it', { who: null });
	await shoot('mock-new-refused', '/mock/new', 'Start against bots', {
		who: null,
		before: (ctx) =>
			ctx.route(`${api}/mocks`, (route) =>
				route.fulfill({
					status: 403,
					contentType: 'application/json',
					body: JSON.stringify(REFUSAL)
				})
			),
		act: (page) => page.getByRole('button', { name: 'Start against bots' }).click(),
		after: 'Mocks start on trycommish.app'
	});

	const first = await newMock(2026);
	await shoot('mock-first-turn', `/mock/${first.id}`, 'went before your first pick');
	// Each undo shot takes back a pick of its own, so each opens a fresh mock with one pick made.
	await shoot(
		'mock-undo',
		async () => {
			const room = await newMock(2026);
			const players = room.board?.players ?? [];
			await pickByHand(room, worstAt(room, players, 'QB'));
			return `/mock/${room.id}`;
		},
		'Our call at',
		{ act: (page) => page.keyboard.press('u'), after: 'Back to ' }
	);

	const created = await newMock(2026);
	await call<Room>(me, 'POST', `/mocks/${created.id}/autopick?to_round=4`);
	await shoot('mock-room', `/mock/${created.id}`, 'Our call at');
	// The same draft as a friend opens its link, signed out in a fresh browser.
	const midway = await call<Room>(me, 'GET', `/mocks/${created.id}`);
	await shoot('mock-shared', `/mock/share/${midway.share_code}`, 'Run this draft from slot', {
		who: null
	});
	await call<Room>(me, 'POST', `/mocks/${created.id}/finish`);
	await shoot('mock-report', `/mock/${created.id}/report`, 'The field');
	const sunk = await sunkMock();
	await shoot('mock-report-low', `/mock/${sunk}/report`, 'the leader at');

	// A lobby joined and left unattended: nobody is here when it fills, so it closes, and opening it
	// after the fill window shows the closed state with the verb to join another.
	const lonely = await call<Seat>(me, 'POST', '/lobbies/join', { format: '10_ppr' });
	const seat = await call<Seat>(me, 'POST', '/lobbies/join', { format: '12_ppr' });
	const lobby = seat.room_id;
	for (const helper of helpers)
		await call<Seat>(helper, 'POST', '/lobbies/join', { format: '12_ppr' });
	// Every drafter holds the lobby open in a tab, as a person waiting in it does: a seat with no
	// socket at the fill deadline is not counted as there.
	const present = await Promise.all([me, ...helpers].map((who) => hold(lobby, who)));
	await shoot('lobby-filling', `/lobby/${lobby}`, 'The draft starts when');
	await new Promise((done) => setTimeout(done, FILL_WAIT_MS));
	await shoot('lobby-abandoned', `/lobby/${lonely.room_id}`, 'Join another lobby');
	// The helpers step away once the room starts, so their queues draft at a bot's pace.
	for (const helper of helpers) await call<null>(helper, 'POST', `/lobbies/${lobby}/leave`);
	await Promise.all(present.slice(1).map((ctx) => ctx.close()));
	await new Promise((done) => setTimeout(done, DRAFT_WAIT_MS));
	await shoot('lobby-room', `/lobby/${lobby}`, 'just taken, newest first');
	await shoot('lobby-leave', `/lobby/${lobby}`, 'just taken, newest first', {
		act: (page) => page.getByRole('button', { name: 'Leave', exact: true }).click(),
		after: 'Leave? Your queue drafts your seat'
	});
	// Then I leave too: every seat drafts at a stand-in's pace, and setup offers the way back.
	await present[0]?.close();
	await call<null>(me, 'POST', `/lobbies/${lobby}/leave`);
	const remembered: ShotOptions['before'] = (ctx) =>
		ctx.addInitScript(([key, id]: readonly [string, string]) => sessionStorage.setItem(key, id), [
			LEFT_LOBBY_KEY,
			lobby
		] as const);
	await shoot('mock-new-left', '/mock/new', 'Return to the lobby', { before: remembered });
	await waitForStatus(lobby, 'complete');
	await shoot('mock-new-left-done', '/mock/new', 'Read the report', { before: remembered });
	await shoot('lobby-report', `/lobby/${lobby}/report`, 'The field');
} finally {
	await browser.close();
}
