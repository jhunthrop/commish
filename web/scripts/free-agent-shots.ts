// Screenshots of a free agent (Lane 123, B101) at 1280 and 390 in both themes, signed out, on the fixture
// API's clock: his player page and his row on the Players list. Each asserts what it shows: the card's
// club cell reads "FA" with no club link and no mark, the card's week says "No club", the line under the
// card says he is now a free agent and whose his last game was, the log lists no week past the records,
// his week of offensive snaps with no club edge reads "Played, no line" (Lane 138),
// the Players row's club cell reads "FA" and its game cell "No club", and the page's copy passes the one
// guard (copy-scan.ts).
// STAND-INS, named here and in the lane's report:
// - the page: Jahmyr Gibbs as a constructed free agent. The in-season contract fixture run copied to
//   .runs with his page rewritten by the research writer's rules (`run_club(None)` for his club, his DET
//   lines of weeks 1 to 5 kept, every later week a no-club week, `last_game_club` naming DET week 5);
//   written by `node scripts/inseason-fixture/mover-run.ts free-agent` (2026-10-21T12-free-agent);
//   build the site from it (PUBLIC_RUN_ID=2026-10-21T12-free-agent PUBLIC_RUN_BASE_URL=.runs) and start
//   the fixture API with FIXTURE_RUN_ID=2026-10-21T12-free-agent.
// - the API: the fixture API's answers for him rewritten in the browser as the API answers a free agent
//   (boards.WireClub's "FA", no game, no bye, no Proj, no Opp rank): his card's week
//   (/players/<id>/week) and the first row of the Players list (/order).
//
//   node scripts/free-agent-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Route } from 'playwright';
import { copyFault, watchData } from './copy-scan.ts';
import { FREE_AGENT_CLUB } from '../src/lib/format/free-agent.ts';
import { BOX } from '../src/lib/league/box/box.ts';
import { lastGameClubWords } from '../src/lib/player/club-words.ts';
import { SEASON_LOG_WORDS } from '../src/lib/run/season-log-words.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { fixtureApiClock, installFixtureApiClock } from './inseason-fixture/clock.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const VIEWPORT_HEIGHT = 900;
const ZONE = 'America/Chicago';
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 400;
const SLUG = 'jahmyr-gibbs';
const GIBBS = '4429795';
/** The page's line under the card, as the build words it from the run's clubs (Lions). */
const NOTE = lastGameClubWords(null, 5, { nickname: 'Lions' });
/** The run's records reach week 5: no later week is a row. */
const THROUGH = 5;
/** His week of offensive snaps with no club edge (mover-run.ts). */
const UNNAMED_GAME_WEEK = 3;

const web = process.argv[2] ?? 'http://localhost:4173';
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
if ((await fixtureApiClock(API_ORIGIN)).clock === null)
	throw new Error(`The fixture API at ${API_ORIGIN} runs on the real clock.`);
const out = new URL(process.argv[3] ?? '../screenshots/free-agent/', import.meta.url);
await mkdir(out, { recursive: true });

type Json = Record<string, unknown>;

/** A player line as the API answers a free agent: his club cell FA, no game, no bye, no Proj. */
function freeAgentLine(line: Json): Json {
	const player = line.player as Json;
	const facts = line.facts as Json;
	return {
		...line,
		player: { ...player, team: FREE_AGENT_CLUB },
		facts: { ...facts, opponent: null, home: null, kickoff: null, bye: false, game_state: null },
		week_projection: null,
		projection_delta: null,
		opp_rank: null,
		rest_of_season_per_game: null
	};
}

/** The fixture API's answer, rewritten by `edit` (the STAND-IN above). */
async function rewrite(route: Route, edit: (data: Json) => Json): Promise<void> {
	const response = await route.fetch();
	const body = (await response.json()) as Json;
	await route.fulfill({ response, json: { ...body, data: edit(body.data as Json) } });
}

async function standIns(ctx: BrowserContext): Promise<void> {
	await ctx.route(`${API_ORIGIN}/players/${GIBBS}/week*`, (route) =>
		rewrite(route, (data) => ({
			...data,
			line: freeAgentLine(data.line as Json),
			after_bye: null,
			rest_from_week: null
		}))
	);
	await ctx.route(
		(url) => url.origin === API_ORIGIN && url.pathname === '/order',
		(route) =>
			rewrite(route, (data) => {
				const rows = data.rows as Json[];
				const [lead, ...rest] = rows;
				if (lead === undefined) return data;
				return { ...data, rows: [{ ...lead, line: freeAgentLine(lead.line as Json) }, ...rest] };
			})
	);
}

const browser = await chromium.launch();
const faults: string[] = [];
try {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const ctx = await browser.newContext({
				viewport: { width, height: VIEWPORT_HEIGHT },
				timezoneId: ZONE,
				colorScheme: theme,
				deviceScaleFactor: width <= 390 ? 2 : 1
			});
			watchData(ctx);
			await installFixtureApiClock(ctx, API_ORIGIN);
			await standIns(ctx);
			await ctx.addInitScript(
				([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
				[THEME_STORAGE_KEY, theme] as const
			);
			const where = `${theme} ${String(width)}`;

			const page = await ctx.newPage();
			await page.goto(`${web}/players/${SLUG}`, { waitUntil: 'networkidle' });
			await page.getByText(NOTE).first().waitFor({ timeout: READY_TIMEOUT_MS });
			await page.getByText(BOX.noClub).first().waitFor({ timeout: READY_TIMEOUT_MS });
			await page.evaluate(() => document.fonts.ready);
			const card = await page.evaluate(() => {
				const head = document.querySelector('main .card .sub');
				return {
					club: head?.querySelector('.club')?.textContent.trim() ?? '',
					link:
						head?.querySelector('a.club') !== null && head?.querySelector('a.club') !== undefined,
					mark:
						head?.querySelector('.club img') !== null &&
						head?.querySelector('.club img') !== undefined,
					weeks: [...document.querySelectorAll('main table tbody tr')]
						.map((tr) => Number(tr.querySelector('td, th')?.textContent.trim() ?? ''))
						.filter((week) => Number.isFinite(week) && week > 0),
					rows: [...document.querySelectorAll('main table tbody tr')].map((tr) => ({
						week: Number(tr.querySelector('td, th')?.textContent.trim() ?? ''),
						text: tr.textContent.replace(/\s+/g, ' ').trim()
					}))
				};
			});
			const unnamed = card.rows.find((r) => r.week === UNNAMED_GAME_WEEK)?.text ?? '';
			if (
				!unnamed.includes(SEASON_LOG_WORDS.playedNoLine) ||
				unnamed.includes(SEASON_LOG_WORDS.didNotPlay)
			)
				faults.push(`${where}: his week ${String(UNNAMED_GAME_WEEK)} row reads "${unnamed}"`);
			if (card.club !== FREE_AGENT_CLUB)
				faults.push(`${where}: the card's club reads "${card.club}"`);
			if (card.link || card.mark) faults.push(`${where}: the card links or marks a club`);
			const late = card.weeks.filter((week) => week > THROUGH);
			if (late.length > 0) faults.push(`${where}: the log lists weeks ${late.join(', ')}`);
			const copy = await copyFault(page, undefined, 'body');
			if (copy !== null) faults.push(`${where}: the page says ${copy}`);
			await page.screenshot({
				path: new URL(`player-${theme}-${String(width)}.png`, out).pathname,
				fullPage: true
			});

			const players = await ctx.newPage();
			await players.goto(`${web}/players`);
			await players.locator('table.order').first().waitFor({ timeout: READY_TIMEOUT_MS });
			await players.waitForLoadState('networkidle');
			await players.waitForTimeout(SETTLE_MS);
			const row = await players.evaluate(() => {
				const first = document.querySelector('table.order tbody tr');
				return {
					club: first?.querySelector('.club > span')?.textContent.trim() ?? '',
					game: first?.querySelector('td.game')?.textContent.trim() ?? '',
					text: first?.textContent ?? ''
				};
			});
			if (row.club !== FREE_AGENT_CLUB)
				faults.push(`${where}: the Players row's club reads "${row.club}"`);
			const gameSaid = width <= 390 ? row.text.includes(BOX.noClub) : row.game === BOX.noClub;
			if (!gameSaid) faults.push(`${where}: the Players row's game reads "${row.game}"`);
			const said = await copyFault(players, undefined, 'body');
			if (said !== null) faults.push(`${where}: Players says ${said}`);
			await players.screenshot({
				path: new URL(`players-${theme}-${String(width)}.png`, out).pathname,
				clip: { x: 0, y: 0, width, height: VIEWPORT_HEIGHT }
			});
			await ctx.close();
		}
	}
} finally {
	await browser.close();
}
if (faults.length > 0) throw new Error(faults.join('\n'));
process.stdout.write(
	`free-agent shots: ${String(THEMES.length * WIDTHS.length * 2)} in ${out.pathname}\n`
);
