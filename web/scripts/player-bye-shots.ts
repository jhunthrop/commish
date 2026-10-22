// Screenshots of a player page on his bye (Lane 100) at 1280 and 390 in both themes, on the fixture
// API's clock: Jahmyr Gibbs, whose Lions are off in week 6, signed out (Compare leads) and signed in
// with the verb his own roster's (Open your lineup while a week 6 game is still to kick off, Compare
// leading once the week's last game has). Each asserts what it shows:
//   Opp rank reads his week 7 game ("Wk 7 vs GB, ...") and the change tile his week 7 Proj or the day it
//   is published; the row under the tiles holds Preseason pace and Our rate vs his Avg (Lane 139, C08,
//   C09); the game log draws no Proj column; the read is one paragraph with no season read's stamp under
//   it; the tier box is titled by what it holds, His tier (C23); and the page's copy passes the one guard
//   (copy-scan.ts).
// Beside him (Lane 117, B80) a playing player (Josh Jacobs, GB at DAL in week 6) and an Out one
// (MarShawn Lloyd, Out on the stand-in capture SATURDAY_OUT=4429023 writes into the Saturday run), each
// signed out and signed in. For every page: before the week's read answers the card's verb is Compare
// (never the sheet's add), and at 390 the vs Avg caption takes at most four lines.
// STAND-INS, named here and in the lane's report: the fixture league's rosters do not hold Gibbs, so the
// signed-in shot answers his league read with the verb of the member's own (kind lineup, the route below);
// the fixture holds no week 7 allowances (player-week.ts AFTER_BYE_RANK).
// Against the site built from the Saturday run (scripts/inseason-fixture/saturday-run.ts, written with
// SATURDAY_OUT=4429023 SATURDAY_PACE=1 SATURDAY_READ=1) and the fixture API, started with
// FIXTURE_RUN_ID=2026-10-17T17-ros and FIXTURE_CLOCK at the clock to shoot: the fixture week's, or with
// VERB=Compare the Tuesday after the week's last game (`npm run shots` runs both):
//
//   [VERB=Compare] node scripts/player-bye-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { copyFault, watchData } from './copy-scan.ts';
import { BASIS_WORDS } from '../src/lib/player/basis-words.ts';
import { CARD } from '../src/lib/player/card.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { fixtureApiClock, installFixtureApiClock } from './inseason-fixture/clock.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const VIEWPORT_HEIGHT = 900;
const ZONE = 'America/Chicago';
const READY_TIMEOUT_MS = 30_000;
/** The players shot: one on his bye (every bye check below), one playing, one Out (Lane 117). */
const PLAYERS = [
	{ slug: 'jahmyr-gibbs', id: '4429795', kind: 'bye', ready: 'Wk 7 vs GB' },
	{ slug: 'josh-jacobs', id: '4047365', kind: 'playing', ready: 'DAL' },
	{ slug: 'marshawn-lloyd', id: '4429023', kind: 'out', ready: 'DAL' }
] as const;
/** The most lines vs Avg's caption takes in its phone tile (B80). */
const VS_AVG_PHONE_LINES = 4;
/** The sheet's add as SheetAdd.svelte draws it. */
const SHEET_ADD = 'Add to my sheet';
/** The week read's cap (research WEEK_BAND, Lane 117 fix round 3): the stand-in read runs to it. */
const READ_CAP_WORDS = 95;
/** The read's body: its paragraphs, never the byline caption (Lane 126) or a season read's stamp. */
const READ_BODY = '.week-read p:not(.stamp):not(.byline)';
const PHONE = 390;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const OWN_WORDS = /\btips?\b/;
/** The signed-in verb the clock should give: Open your lineup before the week's last kickoff. */
const VERB = process.env.VERB ?? CARD.openLineup;

const web = process.argv[2] ?? 'http://localhost:4173';
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
const clock = (await fixtureApiClock(API_ORIGIN)).clock;
if (clock === null) throw new Error(`The fixture API at ${API_ORIGIN} runs on the real clock.`);
const out = new URL(process.argv[3] ?? '../screenshots/player-bye/', import.meta.url);

interface Seen {
	tiles: Record<string, { value: string; caption: string }>;
	basis: string[];
	vsAvg: { value: string; caption: string };
	projHead: boolean;
	paragraphs: number;
	/** The read's words, and whether any box around it clips or scrolls it (Lane 117 fix round 3). */
	readWords: number;
	readClipped: boolean;
	stamps: string[];
	side: string;
	verb: string;
}

async function seen(page: Page): Promise<Seen> {
	return page.evaluate((readBody: string) => {
		const tile = (t: Element): [string, { value: string; caption: string }] => [
			t.querySelector('.lb')?.textContent.trim() ?? '',
			{
				value: t.querySelector('.v')?.textContent.trim() ?? '',
				caption: t.querySelector('.cap')?.textContent.trim() ?? ''
			}
		];
		const first = document.querySelector('main .card .tiles:not(.basis)');
		const read = document.querySelector('main .read');
		return {
			tiles: Object.fromEntries([...(first?.querySelectorAll('.tile') ?? [])].map(tile)),
			basis: [...document.querySelectorAll('main .card .tiles.basis .lb')].map((el) =>
				el.textContent.trim()
			),
			vsAvg: {
				value:
					document
						.querySelector('main .card .tiles.basis .tile:last-child .v')
						?.textContent.trim() ?? '',
				caption:
					document
						.querySelector('main .card .tiles.basis .tile:last-child .cap')
						?.textContent.trim() ?? ''
			},
			projHead: [...document.querySelectorAll('main .season thead th')].some((th) =>
				th.classList.contains('proj')
			),
			paragraphs: read?.querySelectorAll(readBody).length ?? 0,
			readWords: (read?.querySelector(readBody)?.textContent.trim().split(/\s+/) ?? []).filter(
				(w) => w !== ''
			).length,
			readClipped: (() => {
				const body = read?.querySelector(readBody);
				if (!body) return false;
				const inner = body.getBoundingClientRect();
				for (let el = body.parentElement; el && el !== document.body; el = el.parentElement) {
					const box = el.getBoundingClientRect();
					if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible')
						return true;
					if (inner.bottom > box.bottom + 1 && getComputedStyle(el).overflow !== 'visible')
						return true;
				}
				return false;
			})(),
			stamps: [...(read?.querySelectorAll('.stamp') ?? [])].map((el) => el.textContent.trim()),
			side: document.querySelector('main .side h3')?.textContent.trim() ?? '',
			verb: document.querySelector('main .card .act')?.textContent.trim() ?? ''
		};
	}, READ_BODY);
}

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
	if (!ok) failures.push(what);
};

function checkSeen(s: Seen, where: string, verb: string): void {
	const opp = s.tiles[CARD.opp];
	check(
		opp?.caption.startsWith('Wk 7 vs GB, ') === true,
		`${where}: Opp rank ${JSON.stringify(opp)}`
	);
	const next = s.tiles[`Wk 7 ${CARD.proj}`];
	check(next !== undefined, `${where}: no Wk 7 Proj tile in ${Object.keys(s.tiles).join(', ')}`);
	check(
		next?.caption === 'Published Thursday' || next?.caption === 'PPR',
		`${where}: Wk 7 Proj ${JSON.stringify(next)}`
	);
	check(
		s.basis.join('|') === [BASIS_WORDS.pace, BASIS_WORDS.vsAvg].join('|'),
		`${where}: the row under the tiles ${s.basis.join(', ')}`
	);
	const gap = s.vsAvg;
	check(
		/^[+\u2212]\d+\.\d$/.test(gap.value) &&
			/^\d+\.\d a game vs his \d+\.\d Avg: /.test(gap.caption),
		`${where}: vs Avg ${JSON.stringify(gap)}`
	);
	check(!s.projHead, `${where}: the game log draws a Proj column`);
	check(s.paragraphs <= 1, `${where}: the read runs to ${String(s.paragraphs)} paragraphs`);
	// With the stand-in read at the cap (SATURDAY_READ=1), the box grows to the whole read, never clips.
	check(
		s.readWords === 0 || s.readWords >= READ_CAP_WORDS,
		`${where}: the read has ${String(s.readWords)} words`
	);
	check(!s.readClipped, `${where}: a box clips or scrolls the read`);
	check(!s.stamps.some((st) => st.includes(CARD.writtenFrom)), `${where}: a season read's stamp`);
	check(s.side === CARD.tier, `${where}: the tier box is titled "${s.side}"`);
	check(s.verb.startsWith(verb), `${where}: the verb reads "${s.verb}"`);
}

/** The vs Avg caption's rendered lines. */
async function vsAvgLines(page: Page): Promise<number> {
	return page.evaluate(() => {
		const cap = document.querySelector('main .card .tiles.basis .tile:last-child .cap');
		if (cap === null) return 0;
		const lineHeight = parseFloat(getComputedStyle(cap).lineHeight);
		return Math.round(cap.getBoundingClientRect().height / lineHeight);
	});
}

/** The card's verb as the page first draws it, the week's read held back until it is seen. */
async function verbBeforeRead(page: Page, url: string): Promise<string> {
	let release: () => void = () => undefined;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(`${API_ORIGIN}/**/players/*`, async (route) => {
		await held;
		await route.continue();
	});
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await page.locator('main .card .act').waitFor({ timeout: READY_TIMEOUT_MS });
	const verb = (await page.locator('main .card .act').textContent())?.trim() ?? '';
	release();
	await page.unroute(`${API_ORIGIN}/**/players/*`);
	return verb;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const player of PLAYERS) {
	for (const signedIn of [false, true]) {
		// Signed out in season Compare leads too (fix round 1, M3).
		const verb = signedIn && player.kind === 'bye' ? VERB : CARD.compare;
		for (const theme of THEMES) {
			for (const width of WIDTHS) {
				const who = `${player.kind}-${signedIn ? 'roster' : 'signed-out'}`;
				const where = `${who} ${theme} ${String(width)}`;
				const ctx = await browser.newContext({
					viewport: { width, height: VIEWPORT_HEIGHT },
					colorScheme: theme,
					timezoneId: ZONE
				});
				watchData(ctx);
				await installFixtureApiClock(ctx, API_ORIGIN);
				if (signedIn) {
					await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
				}
				if (signedIn && player.kind === 'bye') {
					// STAND-IN: his league read with the verb of a player on the member's own roster.
					await ctx.route(
						`${API_ORIGIN}/leagues/attached/*/players/${player.id}*`,
						async (route) => {
							const answer = await route.fetch();
							const body = (await answer.json()) as { data: { verb: unknown } };
							body.data.verb = { kind: 'lineup', holder: null, host_url: null, note: null };
							await route.fulfill({ response: answer, json: body });
						}
					);
				}
				await ctx.addInitScript(
					([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
					[THEME_STORAGE_KEY, theme] as const
				);
				const page = await ctx.newPage();
				const url = `${web}/players/${player.slug}`;
				// The sheet's add never leads before the read answers (B80).
				const first = await verbBeforeRead(page, url);
				check(
					first.startsWith(CARD.compare) && !first.includes(SHEET_ADD),
					`${where}: before the read the verb reads "${first}"`
				);
				await page.goto(url, { waitUntil: 'networkidle' });
				await page
					.locator('main .card .tile .cap', { hasText: player.ready })
					.first()
					.waitFor({ timeout: READY_TIMEOUT_MS });
				await page.evaluate(() => document.fonts.ready);
				await page.waitForLoadState('networkidle');
				const shown = await seen(page);
				if (player.kind === 'bye') checkSeen(shown, where, verb);
				else if (!signedIn)
					check(shown.verb.startsWith(verb), `${where}: the verb reads "${shown.verb}"`);
				if (width === PHONE) {
					const lines = await vsAvgLines(page);
					check(
						lines <= VS_AVG_PHONE_LINES,
						`${where}: vs Avg's caption takes ${String(lines)} lines`
					);
				}
				const banned = await copyFault(page, OWN_WORDS, 'body');
				check(banned === null, `${where}: says ${banned ?? ''}`);
				const name = `${who}-${theme}-${String(width)}.png`;
				await page.screenshot({ path: new URL(name, out).pathname, fullPage: true });
				await ctx.close();
			}
		}
	}
}
await browser.close();
if (failures.length > 0) {
	process.stderr.write(`${failures.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`player bye shots at ${clock}: ${out.pathname}\n`);
