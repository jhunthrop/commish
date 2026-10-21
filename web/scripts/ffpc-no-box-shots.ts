// Screenshots of an FFPC opponent with no box (Lane 124, B102): the Matchup and the league home of the
// fixture's FFPC stand-in (ffpc.ts, the fixture_platform=ffpc cookie), both themes at 1280 and 390, on
// one of the fixture's clocks. FFPC lists the opponent no starters, so his state is the schedule's (his
// roster's games): the Matchup's head reads Final only once both sides are final by their own rule, and
// until then the opponent reads "Proj final --" under a Kicked off head. It asserts, on the member's
// game, the Matchup bug's head, the opponent's small figure there and on the home bug, the home bug's
// head, each footer's lines (basis-lines.ts, eight at most at 390, five at 1280) and the copy guard, and
// prints the footers' counts. Exits non-zero on any fault. On the home after the Sunday (Lane 125,
// B104) every other game lists no starters on either side too: it prints each other bug's head and
// figures, and asserts no other bug reads Final while a side of it reads "--", and the footer says the
// teams FFPC sends no lineup for once.
//   saturday, sunday   before the week's Sunday: the opponent listed as the stand-in reads him;
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
import { unlistedPart } from '../src/lib/league/box/basis.ts';
import { BOX } from '../src/lib/league/box/box.ts';
import { KICKOFF } from '../src/lib/league/box/kickoff.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { basisLines } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import {
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_STATS_CLOCK,
	FIXTURE_SUNDAY_MORNING_CLOCK,
	FIXTURE_TUESDAY_CLOCK,
	FIXTURE_WEEK_CLOCK,
	installFixtureApiClock,
	requireFixtureClock
} from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

/** Each clock, and what the member's game reads there: the Matchup's head and whether the opponent
 * reads Final (null where neither is held: before the Sunday). */
const CLOCKS = {
	saturday: { at: FIXTURE_WEEK_CLOCK, head: null, opponentFinal: null },
	sunday: { at: FIXTURE_SUNDAY_MORNING_CLOCK, head: null, opponentFinal: null },
	monday: { at: FIXTURE_MONDAY_NIGHT_CLOCK, head: KICKOFF.kickedOff, opponentFinal: false },
	tuesday: { at: FIXTURE_TUESDAY_CLOCK, head: KICKOFF.final, opponentFinal: true },
	'tuesday-late': { at: FIXTURE_TUESDAY_CLOCK, head: KICKOFF.kickedOff, opponentFinal: false },
	wednesday: { at: FIXTURE_STATS_CLOCK, head: KICKOFF.final, opponentFinal: true }
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
	{ name: 'home', path: LEAGUE, ready: BOX.totals }
] as const;
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

/** The Matchup bug's head and the opponent's small figure there. */
async function matchupBug(page: Page): Promise<{ head: string; opponent: string }> {
	const bug = page.locator('main section.bug').first();
	return {
		head: await drawn(bug.locator('.mid b')),
		opponent: await drawn(bug.locator('.sd:not(.me) .sc small'))
	};
}

/** The member's home bug: its head and the opponent's small figure. */
async function homeBug(page: Page): Promise<{ head: string; opponent: string }> {
	const bug = page.locator('main a.bug.mine').first();
	return {
		head: await drawn(bug.locator('.bh .st')),
		opponent: await drawn(bug.locator('.bt:not(.me) .proj'))
	};
}

/** Every other home bug as it reads (Lane 125, B104): "head: small/big | small/big", and the faults
 * of a bug whose head reads Final with a side still at "--". */
async function otherBugs(page: Page, at: string): Promise<{ said: string[]; faults: string[] }> {
	const said: string[] = [];
	const faults: string[] = [];
	for (const bug of await page.locator('main a.bug:not(.mine)').all()) {
		const head = await drawn(bug.locator('.bh .st'));
		const sides = await Promise.all(
			(await bug.locator('.bt').all()).map(
				async (side) => `${await drawn(side.locator('.proj'))}/${await drawn(side.locator('.pts'))}`
			)
		);
		said.push(`${head}: ${sides.join(' | ')}`);
		if (
			head.toLowerCase() === KICKOFF.final.toLowerCase() &&
			sides.some((s) => s.startsWith(BOX.none))
		)
			faults.push(`${at}: other bug "${head}" with a side at "${BOX.none}"`);
	}
	return { said, faults };
}

/** How many times the footer names the teams FFPC sends no lineup for. */
async function unlistedSaid(page: Page): Promise<number> {
	const text = await drawn(page.locator('[data-basis="league"]'));
	return text.split(unlistedPart('ffpc', true)).length - 1;
}

/** The opponent's small figure's faults against the clock's state. */
function opponentFaults(small: string, at: string): string[] {
	if (want.opponentFinal === null) return [];
	if (want.opponentFinal)
		return small.startsWith(BOX.projFinal) ? [`${at}: opponent "${small}"`] : [];
	// Not final: "Proj final --" on the Matchup, "--" under the home's Proj final column.
	return [PROJ_FINAL_NONE, BOX.none].includes(small) ? [] : [`${at}: opponent "${small}"`];
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
				const bug = screen.name === 'matchup' ? await matchupBug(page) : await homeBug(page);
				const head = bug.head.toLowerCase();
				if (want.head !== null && head !== want.head.toLowerCase())
					faults.push(`${at}: head "${bug.head}", want "${want.head}"`);
				faults.push(...opponentFaults(bug.opponent, at));
				const lines = await basisLines(page);
				footers.push(
					`${at}: footer ${String(lines)} lines, head "${bug.head}", opponent "${bug.opponent}"`
				);
				if (lines === 0 || lines > MOST_LINES[width])
					faults.push(`${at}: footer draws ${String(lines)} lines`);
				// After the Sunday the home's other games list no starters either (Lane 125, B104).
				if (screen.name === 'home' && want.head !== null) {
					const others = await otherBugs(page, at);
					footers.push(...others.said.map((s) => `  ${s}`));
					faults.push(...others.faults);
					const times = await unlistedSaid(page);
					if (times !== 1) faults.push(`${at}: the unlisted teams said ${String(times)} times`);
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
process.stdout.write(`${footers.join('\n')}\n`);
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`${day}: ${String(footers.length)} shots, no fault\n`);
