// Screenshots of every state UX fix 6 touched, against a local api run with FFPC_BASE_URL at the
// stand-in (api/tools/ffpcfake), in both themes at 1440 and 390 (touch, DPR 2), full page.
//
//   node scripts/ux-fix-6-shots.ts [web origin] [out dir]
//
// OWNER and FRESH are session:csrf pairs from `go run ./tools/roommeasure session -handle <name>` in
// api/. OWNER is connected to the stand-in, follows FFPC league 104870 (LEAGUE) and has one paired
// device; FRESH has no connection and follows an FFPC league no one is signed in to (ORPHAN). DB is
// the scratch database both the api and this script use: the script flips the owner's connection
// to signed out and puts a disconnected row back between shots, never anything else.
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const DESK_HEIGHT = 900;
const PHONE_HEIGHT = 844;
const PHONE_WIDTH = 390;
const READY_TIMEOUT_MS = 30_000;

const web = process.argv[2] ?? 'http://localhost:5173';
const out = new URL(process.argv[3] ?? '../screenshots/ux-fix-6/', import.meta.url);
const api = process.env.API ?? 'http://localhost:8080';
const db = need('DB');
const league = need('LEAGUE');
const orphan = need('ORPHAN');

interface Drafter {
	session: string;
	csrf: string;
}

function need(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function drafter(name: string): Drafter {
	const [session = '', csrf = ''] = need(name).split(':');
	return { session, csrf };
}

const owner = drafter('OWNER');
const fresh = drafter('FRESH');

function sql(statement: string): void {
	execFileSync('psql', [db, '-Atqc', statement]);
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
	const envelope = await response.json<{ ok: boolean; data: T; error: { message: string } }>();
	if (!envelope.ok) throw new Error(`${method} ${path}: ${envelope.error.message}`);
	return envelope.data;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number, who: Drafter | null): Promise<BrowserContext> {
	const phone = width === PHONE_WIDTH;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? PHONE_HEIGHT : DESK_HEIGHT },
		deviceScaleFactor: phone ? 2 : 1,
		isMobile: phone,
		hasTouch: phone,
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

interface Shot {
	name: string;
	who: Drafter | null;
	path: string;
	ready: string;
	before?: () => void | Promise<void>;
	act?: (page: Page) => Promise<void>;
	route?: (page: Page) => Promise<void>;
}

async function shoot(shot: Shot): Promise<void> {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			await shot.before?.();
			const ctx = await context(theme, width, shot.who);
			const page = await ctx.newPage();
			await shot.route?.(page);
			await page.goto(`${web}${shot.path}`, { waitUntil: 'networkidle' });
			await shot.act?.(page);
			await page
				.getByText(shot.ready)
				.filter({ visible: true })
				.first()
				.waitFor({ timeout: READY_TIMEOUT_MS });
			await page.waitForLoadState('networkidle');
			await page.evaluate(() => document.fonts.ready);
			const file = new URL(`${shot.name}-${theme}-${String(width)}.png`, out);
			await page.screenshot({ path: file.pathname, fullPage: true });
			await ctx.close();
			process.stdout.write(`${file.pathname}\n`);
		}
	}
}

interface SyncSide {
	roster_id: number;
	points: number;
	starters: { player: unknown; points: number }[];
}

interface Sync {
	week: number;
	me: number;
	teams: { roster_id: number }[];
	roster: { slot: string; player: unknown }[];
	matchup: { week: number; mine: SyncSide; opponent: SyncSide | null } | null;
}

/** H2 on the stand-in: its week 6 is all-play, with no game. The real sync answer is kept and given
 * a game the way FFPC's read gives one: both team totals from the schedule, the reader's own
 * starters with no per-player points, the opponent's starters dropped. */
async function withGame(page: Page): Promise<void> {
	await page.route(`${api}/leagues/attached/*/sync`, async (route: Route) => {
		const response = await route.fetch();
		const body = (await response.json()) as { ok: boolean; data: Sync };
		const sync = body.data;
		const opponent = sync.teams.find((t) => t.roster_id !== sync.me)?.roster_id ?? 0;
		sync.matchup = {
			week: sync.week,
			mine: {
				roster_id: sync.me,
				points: 87.3,
				starters: sync.roster
					.filter((spot) => spot.slot === 'starter')
					.map((spot) => ({ player: spot.player, points: 0 }))
			},
			opponent: { roster_id: opponent, points: 74.9, starters: [] }
		};
		await route.fulfill({ response, json: body });
	});
}

const pickFFPC = async (page: Page): Promise<void> => {
	await page.getByRole('button', { name: 'FFPC', exact: true }).click();
};

const OWNER_ROW = `account_id = (select id from app.accounts where handle = 'ffpc14')`;
const status = (to: 'signed_out' | 'connected'): void =>
	sql(`update app.host_connections set status = '${to}' where ${OWNER_ROW}`);

/** The owner's connection kept aside, so each Disconnect shot starts connected without a sign-in. */
sql(
	`drop table if exists ux6_kept_connection; create table ux6_kept_connection as select * from app.host_connections where ${OWNER_ROW}`
);
const restore = (): void =>
	sql(`insert into app.host_connections select * from ux6_kept_connection on conflict do nothing`);

// Signed out: the front page with League on the rail, the attach page naming FFPC.
await shoot({ name: 'front', who: null, path: '/', ready: 'Follow your league' });
await shoot({
	name: 'league-new-signed-out-ffpc',
	who: null,
	path: '/league/new?host=ffpc',
	ready: 'Sign in to follow it'
});

// Connected.
await shoot({
	name: 'league-new-ffpc-signin',
	who: fresh,
	path: '/league/new?host=ffpc',
	ready: 'Connect FFPC'
});
await shoot({
	name: 'league-new-ffpc-leagues',
	who: owner,
	path: '/league/new?host=ffpc',
	ready: 'Follow my league'
});
await shoot({
	name: 'companion-new-ffpc',
	who: owner,
	path: '/companion/new',
	ready: 'Follow my draft',
	act: pickFFPC
});
await shoot({ name: 'account-connected', who: owner, path: '/account', ready: 'Paired devices' });
await shoot({
	name: 'league-ffpc-matchup',
	who: owner,
	path: `/league/${league}`,
	ready: 'shows us your lineup only',
	route: withGame
});
await shoot({
	name: 'league-ffpc-409',
	who: fresh,
	path: `/league/${orphan}`,
	ready: 'Read from FFPC as a member'
});

// Disconnect, from connected each time.
await shoot({
	name: 'account-disconnected',
	who: owner,
	path: '/account',
	ready: 'FFPC disconnected',
	before: restore,
	act: async (page) => {
		await page.getByRole('button', { name: 'Disconnect' }).click();
	}
});
restore();

// FFPC signed the owner out.
status('signed_out');
await shoot({
	name: 'account-signed-out-host',
	who: owner,
	path: '/account',
	ready: 'Signed out by FFPC'
});
await shoot({
	name: 'league-ffpc-signed-out',
	who: owner,
	path: `/league/${league}`,
	ready: 'No one in this league is signed in',
	act: async (page) => {
		await page.getByRole('button', { name: 'Read FFPC now' }).click();
	}
});
status('connected');

// The solo room between turns with an empty queue: no queue line.
interface Room {
	id: string;
	pick_number: number;
	picks: { player_id: string }[];
	board?: { players: { id: string }[] };
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
let room = await call<Room>(fresh, 'POST', '/mocks', { settings, seed: 2066 });
// Only the start answers the board.
const players = room.board?.players ?? [];
for (let i = 0; i < 2; i += 1) {
	const taken = new Set(room.picks.map((p) => p.player_id));
	const next = players.find((p) => !taken.has(p.id));
	if (!next) throw new Error('no player left to pick');
	await call<unknown>(fresh, 'GET', `/mocks/${room.id}/card`);
	room = await call<Room>(fresh, 'POST', `/mocks/${room.id}/picks`, {
		player_id: next.id,
		pick: room.pick_number
	});
}
await shoot({
	name: 'room-between-turns',
	who: fresh,
	path: `/mock/${room.id}`,
	ready: 'went since your pick'
});

sql('drop table if exists ux6_kept_connection');
await browser.close();
