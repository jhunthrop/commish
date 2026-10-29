// Screenshots of league sync against a local api run with COMPANION_REPLAY=true, in both themes at
// 1440 and 390: the attach page signed out, empty, and read from each recorded league's link (the
// Sleeper league and the public MyFantasyLeague league), each league's page with a sheet whose tags
// ride along on the roster and the waiver pool, a league page signed out, and the account's leagues.
//
//   node scripts/league-shots.ts [web origin] [out dir]
//
// LEAGUE and FRESH are session:csrf pairs from `go run ./tools/roommeasure session -handle <name>` in
// api/. LEAGUE gets both recorded leagues attached and a tagged sheet; FRESH has none.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
/** The recorded leagues (api/internal/leaguesync/replay). */
const SLEEPER_LINK = 'https://sleeper.com/leagues/1382163311038038016/team';
const MFL_LINK = 'https://www43.myfantasyleague.com/2026/home/10010';
const TAGGED = 6;
const SHEET_NAME = 'In season';

const web = process.argv[2] ?? 'http://localhost:5173';
const out = new URL(process.argv[3] ?? '../screenshots/league/', import.meta.url);
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

const owner = drafter('LEAGUE');
const fresh = drafter('FRESH');

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

interface Sync {
	id: string;
	held_by: Record<string, number>;
	board_format: string;
	roster: { player: { board_id: string | null; name: string; position: string } }[];
}

interface RunBoard {
	rows: { id: string; name: string; position: string; team: string }[];
}

/** Both recorded leagues, and a sheet tagging the roster's first players and the pool's top. */
async function seed(): Promise<{ sleeper: string; mfl: string }> {
	const sleeper = await call<Sync>(owner, 'POST', '/leagues/attach', {
		link: SLEEPER_LINK,
		me: { roster_id: 1 }
	});
	const mfl = await call<Sync>(owner, 'POST', '/leagues/attach', {
		link: MFL_LINK,
		me: { roster_id: 7 }
	});
	// The board is the run's own file, as the page reads it.
	const response = await fetch(`${web}/data/league-board/${sleeper.board_format}.json`);
	const board = await response.json<RunBoard>();
	const byId = new Map(board.rows.map((p) => [p.id, p] as const));
	const held = new Set(Object.keys(sleeper.held_by));
	const ids = [
		...sleeper.roster.flatMap((r) => (r.player.board_id ? [r.player.board_id] : [])).slice(0, 3),
		...board.rows
			.filter((p) => !held.has(p.id))
			.slice(0, TAGGED)
			.map((p) => p.id)
	];
	const tags = ['target', 'breakout', 'sleeper', 'avoid', 'injury', 'handcuff'];
	const rows = ids.flatMap((id, i) => {
		const p = byId.get(id);
		return p
			? [
					{
						player_id: p.id,
						name: p.name,
						position: p.position,
						team: p.team,
						tags: [tags[i % tags.length]]
					}
				]
			: [];
	});
	// One tagged sheet however many times the shots run: an earlier run's is kept.
	const sheets = await call<{ name: string }[]>(owner, 'GET', '/sheets');
	if (!sheets.some((sheet) => sheet.name === SHEET_NAME)) {
		await call(owner, 'POST', '/sheets', { name: SHEET_NAME, format: 'ppr', rows });
	}
	return { sleeper: sleeper.id, mfl: mfl.id };
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
	fullPage = true
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
			await page.waitForLoadState('networkidle');
			await page.evaluate(() => document.fonts.ready);
			const file = new URL(`${name}-${theme}-${String(width)}.png`, out);
			await page.screenshot({ path: file.pathname, fullPage });
			await ctx.close();
			process.stdout.write(`${file.pathname}\n`);
		}
	}
}

const ids = await seed();
const link = (l: string): string => `/league/new?link=${encodeURIComponent(l)}`;
await shoot('new-signed-out', null, '/league/new', 'Sign in to follow it');
await shoot('new-empty', fresh, '/league/new', 'Follow your league');
await shoot('new-sleeper', fresh, link(SLEEPER_LINK), 'From the list');
await shoot('new-mfl', fresh, link(MFL_LINK), '12 teams on MyFantasyLeague');
await shoot('league-sleeper', owner, `/league/${ids.sleeper}`, 'Standings');
// The first screen alone, where the phone's tab bar holds League.
await shoot('league-sleeper-first-screen', owner, `/league/${ids.sleeper}`, 'Standings', false);
await shoot('league-mfl', owner, `/league/${ids.mfl}`, 'Standings');
await shoot('league-signed-out', null, `/league/${ids.sleeper}`, 'Sign in to see your league');
await shoot('account', owner, '/account', 'Your leagues');
await browser.close();
