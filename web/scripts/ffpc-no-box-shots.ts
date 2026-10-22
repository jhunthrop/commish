// Screenshots of an FFPC opponent with no box (Lane 124, B102): the Matchup, the league home and the
// front door (Lane 127: its basis says the opponent's figure as the home does) of the fixture's FFPC
// stand-in (ffpc.ts, the fixture_platform=ffpc cookie), both themes at 1280 and 390, on
// one of the fixture's clocks. FFPC lists the opponent no starters, so his state is the schedule's (his
// roster's games): the Matchup's head reads Final only once both sides are final by their own rule, and
// until then the opponent reads his best lineup's Proj final under a Kicked off head (Lane 127). It asserts, on the member's
// game, the Matchup bug's head, the opponent's small figure there and on the home bug, the home bug's
// head, each footer's lines (basis-lines.ts, eight at most at 390, five at 1280) and the copy guard, and
// prints the footers' counts. Exits non-zero on any fault. On the home after the Sunday (Lane 125,
// B104) every other game lists no starters on either side too, and before it (Lane 127): it prints each
// other bug's head and figures on every clock, and asserts no other bug reads Final while a side of it
// reads "--", that the footer names the teams FFPC sends no lineup for once while one draws a figure of
// its own (never on a board whose every game is final), and never says they have no Proj final unless
// a game under way draws one "--".
//   thursday-night,    before the week's Sunday (Lane 127, B105): Thursday's game under way, then
//   friday, saturday,  final, every other side unlisted, its Proj our best lineup from its roster or
//   sunday             "--" with none; the Matchup's opponent unlisted too, his Proj the home bug's
//                      best lineup (Lane 137, B107), never "--";
//   monday             Monday night, the Monday game under way with a player on each roster: Kicked off;
//   tuesday            every week 6 game final: Final on both sides;
//   tuesday-late       Tuesday with LV at BUF's final not held (FIXTURE_LATE_FINAL=LV,BUF): every
//                      starter of the member's final, the opponent's roster still playing: Kicked off;
//   wednesday          our week 6 stats in: Final.
//
//   FIXTURE_CLOCK=<the clock's instant> [FIXTURE_LATE_FINAL=LV,BUF] PORT=8924 node scripts/inseason-fixture/serve.ts
//   CLOCK=monday|tuesday|... API_ORIGIN=http://localhost:8924 node scripts/ffpc-no-box-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL at the fixture API.
import { mkdir } from 'node:fs/promises';
import { chromium, type Locator, type Page } from 'playwright';
import { BOX } from '../src/lib/league/box/box.ts';
import { KICKOFF } from '../src/lib/league/box/kickoff.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { basisLines } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_FRIDAY_CLOCK,
	FIXTURE_LIVE_CLOCK,
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_STATS_CLOCK,
	FIXTURE_SUNDAY_MORNING_CLOCK,
	FIXTURE_THURSDAY_NIGHT_CLOCK,
	FIXTURE_TUESDAY_CLOCK,
	FIXTURE_WEEK_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

/** Each clock, and what the member's game reads there: the Matchup's head and whether the opponent
 * reads Final (null where neither is held: before the Sunday), and how many times the home's footer
 * names the teams FFPC sends no lineup for (none once every game is final: they draw their totals). */
const CLOCKS = {
	'thursday-night': {
		at: FIXTURE_THURSDAY_NIGHT_CLOCK,
		head: null,
		opponentFinal: null,
		unlistedSaid: 1
	},
	friday: { at: FIXTURE_FRIDAY_CLOCK, head: null, opponentFinal: null, unlistedSaid: 1 },
	saturday: { at: FIXTURE_WEEK_CLOCK, head: null, opponentFinal: null, unlistedSaid: 1 },
	sunday: { at: FIXTURE_SUNDAY_MORNING_CLOCK, head: null, opponentFinal: null, unlistedSaid: 1 },
	// Monday night 25 minutes into its game (Lane 127 fix round 3): the opponent's in-play back counts
	// at his projection's pace, so his Proj final reads above his points.
	'monday-live': {
		at: FIXTURE_LIVE_CLOCK,
		head: KICKOFF.kickedOff,
		opponentFinal: false,
		unlistedSaid: 1
	},
	monday: {
		at: FIXTURE_MONDAY_NIGHT_CLOCK,
		head: KICKOFF.kickedOff,
		opponentFinal: false,
		unlistedSaid: 1
	},
	tuesday: { at: FIXTURE_TUESDAY_CLOCK, head: KICKOFF.final, opponentFinal: true, unlistedSaid: 0 },
	'tuesday-late': {
		at: FIXTURE_TUESDAY_CLOCK,
		head: KICKOFF.kickedOff,
		opponentFinal: false,
		unlistedSaid: 1
	},
	wednesday: { at: FIXTURE_STATS_CLOCK, head: KICKOFF.final, opponentFinal: true, unlistedSaid: 0 }
} as const;
type Day = keyof typeof CLOCKS;
const day = (process.env.CLOCK ?? 'monday') as Day;
const want = CLOCKS[day];
const web = process.argv[2] ?? 'http://localhost:4324';
const out = new URL(process.argv[3] ?? `../screenshots/lane-124/${day}/`, import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8924').origin;
const WIDTHS = [1280, 390] as const;
const THEMES = ['dark', 'light'] as const;
/** The most rendered lines a footer may draw at each width (Lane 108). */
const MOST_LINES: Readonly<Record<(typeof WIDTHS)[number], number>> = { 1280: 5, 390: 8 };
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const COOKIES = [
	{ name: 'commish_csrf', value: 'fixture' },
	{ name: 'fixture_platform', value: 'ffpc' }
];
const LEAGUE = `/league/${FIXTURE_IDS.league}`;
const SCREENS = [
	{ name: 'matchup', path: `${LEAGUE}/matchup`, ready: 'Week 6' },
	{ name: 'home', path: LEAGUE, ready: BOX.totals },
	// The front door's lead bug is the member's FFPC game (Lane 127): its basis says the opponent's figure.
	{ name: 'front', path: '/', ready: 'McConkey Kong' }
] as const;
const FRONT_BASIS = 'main .front-week .basis';
/** The starters' key the front door once gave the FFPC opponent's "--" (Lane 125 review LOW-4). */
const STARTERS_KEY = 'No Proj final while';
const PROJ_FINAL_NONE = `${BOX.projFinal} ${BOX.none}`;

await requireFixtureClock(API_ORIGIN, want.at);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];
const footers: string[] = [];

async function open(width: number, theme: (typeof THEMES)[number], path: string): Promise<Page> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies(COOKIES.map((c) => ({ ...c, domain: 'localhost', path: '/' })));
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	const page = await ctx.newPage();
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
	return page;
}

/** What a locator draws, empty where it draws nothing (the small figure before kickoff). */
async function drawn(at: Locator): Promise<string> {
	return (await at.allTextContents()).join(' ').trim();
}

/** A bug's head, the opponent's small figure and his big one (his Proj before kickoff, Lane 92). */
interface BugRead {
	head: string;
	opponent: string;
	big: string;
}

/** The Matchup bug's head and the opponent's figures there. */
async function matchupBug(page: Page): Promise<BugRead> {
	const bug = page.locator('main section.bug').first();
	return {
		head: await drawn(bug.locator('.mid b')),
		opponent: await drawn(bug.locator('.sd:not(.me) .sc small')),
		big: await drawn(bug.locator('.sd:not(.me) .sc .big'))
	};
}

/** The member's home bug: its head, the opponent's small figure and his big one (his points). */
async function homeBug(page: Page): Promise<BugRead & { points: string }> {
	const bug = page.locator('main a.bug.mine').first();
	const big = await drawn(bug.locator('.bt:not(.me) .pts'));
	return {
		head: await drawn(bug.locator('.bh .st')),
		opponent: await drawn(bug.locator('.bt:not(.me) .proj')),
		big,
		points: big
	};
}

/** The opponent's big figure on each screen before Sunday, by theme and width: the Matchup's must be
 * the home's, never "--" (Lane 137, B107: one figure per side across screens). */
const beforeSundayProj = new Map<string, { matchup?: string; home?: string }>();

/** Every other home bug as it reads (Lane 125, B104): "head: small/big | small/big", the faults of a
 * bug whose head reads Final with a side still at "--", and whether a game under way draws a side's
 * Proj final "--". */
async function otherBugs(
	page: Page,
	at: string
): Promise<{ said: string[]; faults: string[]; noProjFinal: boolean }> {
	const said: string[] = [];
	const faults: string[] = [];
	let noProjFinal = false;
	for (const bug of await page.locator('main a.bug:not(.mine)').all()) {
		const head = await drawn(bug.locator('.bh .st'));
		const sides = await Promise.all(
			(await bug.locator('.bt').all()).map(
				async (side) => `${await drawn(side.locator('.proj'))}/${await drawn(side.locator('.pts'))}`
			)
		);
		said.push(`${head}: ${sides.join(' | ')}`);
		if (
			head.toLowerCase() === KICKOFF.kickedOff.toLowerCase() &&
			sides.some((s) => s.startsWith(`${BOX.none}/`))
		)
			noProjFinal = true;
		if (
			head.toLowerCase() === KICKOFF.final.toLowerCase() &&
			sides.some((s) => s.startsWith(BOX.none))
		)
			faults.push(`${at}: other bug "${head}" with a side at "${BOX.none}"`);
	}
	return { said, faults, noProjFinal };
}

/** The home footer's words for the teams FFPC sends no lineup for (basis.ts unlistedPart). */
const UNLISTED_NAMED = /teams FFPC sends no lineup/gi;
const NO_PROJ_FINAL_SAID = 'have no Proj final';

/** How many times the footer names the teams FFPC sends no lineup for, and whether it says they have
 * no Proj final. */
async function unlistedSaid(
	page: Page,
	basis = '[data-basis="league"]'
): Promise<{ times: number; noProjFinal: boolean }> {
	const text = await drawn(page.locator(basis));
	return {
		times: [...text.matchAll(UNLISTED_NAMED)].length,
		noProjFinal: text.includes(NO_PROJ_FINAL_SAID)
	};
}

/** The opponent's small figure's faults against the clock's state. */
function opponentFaults(small: string, at: string): string[] {
	if (want.opponentFinal === null) return [];
	if (want.opponentFinal)
		return small.startsWith(BOX.projFinal) ? [`${at}: opponent "${small}"`] : [];
	// Not final: his best lineup's Proj final (Lane 127 fix round 1), never "--": he has a roster.
	return [PROJ_FINAL_NONE, BOX.none, ''].includes(small) ? [`${at}: opponent "${small}"`] : [];
}

for (const theme of THEMES)
	for (const screen of SCREENS)
		for (const width of WIDTHS) {
			const at = `${day} ${screen.name} ${theme} ${String(width)}`;
			const page = await open(width, theme, screen.path);
			try {
				await page
					.getByText(screen.ready)
					.filter({ visible: true })
					.first()
					.waitFor({ timeout: READY_TIMEOUT_MS });
				await page.evaluate(() => document.fonts.ready);
				if (screen.name === 'front') {
					// The front door: the home's words for the opponent, never the starters' key.
					const lines = await basisLines(page, FRONT_BASIS);
					footers.push(`${at}: footer ${String(lines)} lines`);
					if (lines === 0 || lines > MOST_LINES[width])
						faults.push(`${at}: footer draws ${String(lines)} lines`);
					const said = await unlistedSaid(page, FRONT_BASIS);
					if (said.times !== want.unlistedSaid)
						faults.push(`${at}: the unlisted teams said ${String(said.times)} times`);
					if ((await drawn(page.locator(FRONT_BASIS))).includes(STARTERS_KEY))
						faults.push(`${at}: the front door keys the opponent with the starters' sentence`);
				}
				const bug =
					screen.name === 'matchup'
						? await matchupBug(page)
						: screen.name === 'home'
							? await homeBug(page)
							: null;
				if (
					bug !== null &&
					want.head !== null &&
					bug.head.toLowerCase() !== want.head.toLowerCase()
				)
					faults.push(`${at}: head "${bug.head}", want "${want.head}"`);
				if (bug !== null) faults.push(...opponentFaults(bug.opponent, at));
				// Before Sunday the opponent's Proj is his best lineup's on both screens (Lane 137, B107).
				if (bug !== null && want.opponentFinal === null && screen.name !== 'front') {
					const key = `${theme} ${String(width)}`;
					beforeSundayProj.set(key, { ...beforeSundayProj.get(key), [screen.name]: bug.big });
					if (bug.big === BOX.none || bug.big === '')
						faults.push(`${at}: the opponent's Proj "${bug.big}" before Sunday`);
				}
				// At the live clock the opponent's Proj final is above his points (his back at pace).
				if (day === 'monday-live' && screen.name === 'home') {
					const home = await homeBug(page);
					footers.push(`  opponent Proj final ${home.opponent} over Pts ${home.points}`);
					if (!(Number(home.opponent) > Number(home.points)))
						faults.push(`${at}: opponent Proj final ${home.opponent} not above his ${home.points}`);
				}
				const lines = bug === null ? 1 : await basisLines(page);
				// The Matchup says the opponent's best-lineup Proj final once while he plays (Lane 127).
				if (screen.name === 'matchup') {
					const said = await unlistedSaid(page, 'main [data-basis]');
					// Before Sunday his best lineup's Proj is drawn and said too (Lane 137, B107).
					const wantSaid = want.opponentFinal === true ? 0 : 1;
					if (said.times !== wantSaid)
						faults.push(`${at}: the Matchup names the unlisted teams ${String(said.times)} times`);
				}
				if (bug !== null)
					footers.push(
						`${at}: footer ${String(lines)} lines, head "${bug.head}", opponent "${bug.opponent}"`
					);
				if (lines === 0 || lines > MOST_LINES[width])
					faults.push(`${at}: footer draws ${String(lines)} lines`);
				// The home's other games list no starters either (Lane 125, B104), before Sunday too (Lane 127).
				if (screen.name === 'home') {
					const others = await otherBugs(page, at);
					footers.push(...others.said.map((s) => `  ${s}`));
					faults.push(...others.faults);
					const said = await unlistedSaid(page);
					if (said.times !== want.unlistedSaid)
						faults.push(`${at}: the unlisted teams said ${String(said.times)} times`);
					if (said.noProjFinal && !others.noProjFinal)
						faults.push(`${at}: the footer says no Proj final where no game under way draws one`);
				}
				const copy = await copyFault(page);
				if (copy !== null) faults.push(`${at}: ${copy}`);
				await page.screenshot({
					path: new URL(`ffpc-${screen.name}-${day}-${theme}-${String(width)}.png`, out).pathname,
					fullPage: true
				});
			} catch (error) {
				faults.push(`${at}: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				await page.context().close();
			}
		}
await browser.close();
for (const [key, proj] of beforeSundayProj) {
	footers.push(`  ${key}: opponent Proj Matchup ${proj.matchup ?? '?'}, home ${proj.home ?? '?'}`);
	if (proj.matchup !== proj.home)
		faults.push(
			`${day} ${key}: Matchup Proj ${proj.matchup ?? '?'} is not the home's ${proj.home ?? '?'}`
		);
}
process.stdout.write(`${footers.join('\n')}\n`);
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`${day}: ${String(footers.length)} shots, no fault\n`);
