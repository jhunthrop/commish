// Screenshots of a player page on his bye (Lane 100) at 1280 and 390 in both themes, on the fixture
// API's clock: Jahmyr Gibbs, whose Lions are off in week 6, signed out (the sheet's add) and signed in
// with the verb his own roster's (Open your lineup while a week 6 game is still to kick off, Compare
// leading once the week's last game has). Each asserts what it shows:
//   Opp rank reads his week 7 game ("Wk 7 vs GB, ...") and the change tile his week 7 Proj or the day it
//   is published; the row under the tiles holds Preseason, Preseason pace and vs Avg; the game log draws
//   no Proj column; the read is one paragraph with no season read's stamp under it; the tier box is
//   titled by what it holds; and the page's copy passes the one guard (copy-scan.ts).
// STAND-INS, named here and in the lane's report: the fixture league's rosters do not hold Gibbs, so the
// signed-in shot answers his league read with the verb of the member's own (kind lineup, the route below);
// the fixture holds no week 7 allowances (player-week.ts AFTER_BYE_RANK).
// Against the site built from the Saturday run (scripts/inseason-fixture/saturday-run.ts) and the fixture
// API, started with FIXTURE_RUN_ID=2026-10-17T17-ros and FIXTURE_CLOCK at the clock to shoot:
//
//   [VERB=Compare] node scripts/player-bye-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { copyFault, watchData } from './copy-scan.ts';
import { CARD } from '../src/lib/player/card.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { fixtureApiClock, installFixtureApiClock } from './inseason-fixture/clock.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const VIEWPORT_HEIGHT = 900;
const ZONE = 'America/Chicago';
const READY_TIMEOUT_MS = 30_000;
const SLUG = 'jahmyr-gibbs';
const BOARD_ID = '4429795';
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
	projHead: boolean;
	paragraphs: number;
	stamps: string[];
	side: string;
	verb: string;
}

async function seen(page: Page): Promise<Seen> {
	return page.evaluate(() => {
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
			projHead: [...document.querySelectorAll('main .season thead th')].some((th) =>
				th.classList.contains('proj')
			),
			paragraphs: read?.querySelectorAll('.week-read p:not(.stamp)').length ?? 0,
			stamps: [...(read?.querySelectorAll('.stamp') ?? [])].map((el) => el.textContent.trim()),
			side: document.querySelector('main .side h3')?.textContent.trim() ?? '',
			verb: document.querySelector('main .card .act')?.textContent.trim() ?? ''
		};
	});
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
		s.basis.join('|') === [CARD.preseason, CARD.preseasonPace, CARD.vsAvg].join('|'),
		`${where}: the row under the tiles ${s.basis.join(', ')}`
	);
	check(!s.projHead, `${where}: the game log draws a Proj column`);
	check(s.paragraphs <= 1, `${where}: the read runs to ${String(s.paragraphs)} paragraphs`);
	check(!s.stamps.some((st) => st.includes(CARD.writtenFrom)), `${where}: a season read's stamp`);
	check(s.side === CARD.whyRest, `${where}: the tier box is titled "${s.side}"`);
	check(s.verb.startsWith(verb), `${where}: the verb reads "${s.verb}"`);
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const signedIn of [false, true]) {
	const verb = signedIn ? VERB : 'Add to my sheet';
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const where = `${signedIn ? 'roster' : 'signed-out'} ${theme} ${String(width)}`;
			const ctx = await browser.newContext({
				viewport: { width, height: VIEWPORT_HEIGHT },
				colorScheme: theme,
				timezoneId: ZONE
			});
			watchData(ctx);
			await installFixtureApiClock(ctx, API_ORIGIN);
			if (signedIn) {
				await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
				// STAND-IN: his league read with the verb of a player on the member's own roster.
				await ctx.route(`${API_ORIGIN}/leagues/attached/*/players/${BOARD_ID}*`, async (route) => {
					const answer = await route.fetch();
					const body = (await answer.json()) as { data: { verb: unknown } };
					body.data.verb = { kind: 'lineup', holder: null, host_url: null, note: null };
					await route.fulfill({ response: answer, json: body });
				});
			}
			await ctx.addInitScript(
				([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
				[THEME_STORAGE_KEY, theme] as const
			);
			const page = await ctx.newPage();
			await page.goto(`${web}/players/${SLUG}`, { waitUntil: 'networkidle' });
			await page
				.locator('main .card .tile .cap', { hasText: 'Wk 7 vs GB' })
				.first()
				.waitFor({ timeout: READY_TIMEOUT_MS });
			await page.evaluate(() => document.fonts.ready);
			await page.waitForLoadState('networkidle');
			checkSeen(await seen(page), where, verb);
			const banned = await copyFault(page, OWN_WORDS, 'body');
			check(banned === null, `${where}: says ${banned ?? ''}`);
			const name = `${signedIn ? 'roster' : 'signed-out'}-${theme}-${String(width)}.png`;
			await page.screenshot({ path: new URL(name, out).pathname, fullPage: true });
			await ctx.close();
		}
	}
}
await browser.close();
if (failures.length > 0) {
	process.stderr.write(`${failures.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`player bye shots at ${clock}: ${out.pathname}\n`);
