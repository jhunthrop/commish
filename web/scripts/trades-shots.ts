// Screenshots of the Trades screen (Lane 103) at 1280 and 390 in both themes, on the fixture API's
// clock, the strip and the finder as a member sees them. Each asserts what it shows:
//   the head over the gains reads "Gain a week" (no "over repl."), the line under the heads says what a
//   Gain is in once ("points over replacement in each lineup, weeks ..."); each card's gains read
//   "+3.5 a week for your lineup, +0.8 for theirs"; the first card's verb solid and the rest quiet,
//   the first of two saying Best (strip.ts, Lane 115, B87); the trade listed only for the need it fills says so ("Fills your empty TE ...") and
//   no other row does; the footer says the keep rule; and the page's copy passes the one guard
//   (copy-scan.ts).
// Against the built site and the fixture API (scripts/inseason-fixture/serve.ts) on the fixture
// week's clock, whose trades carry each need (trade-needs.ts):
//
//   node scripts/trades-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { copyFault, watchData } from './copy-scan.ts';
import { STRIP } from '../src/lib/league/box/strip.ts';
import { TRADES } from '../src/lib/league/box/trades.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { fixtureApiClock, installFixtureApiClock } from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { KEPT_STAND_IN } from './inseason-fixture/trade-needs.ts';
import { KEEP_GAIN } from './inseason-fixture/week.ts';
import { lastName } from '../src/lib/format/draft.ts';
import { MINUS } from '../src/lib/format/number.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const VIEWPORT_HEIGHT = 900;
const ZONE = 'America/Chicago';
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const OWN_WORDS = /\bover repl\b/i;
const GAIN_BASIS = /^points over replacement in each lineup, weeks? \d+/;
const CARD_GAINS = /[+−]\d+\.\d a week for your lineup, [+−]\d+\.\d for theirs/;
const NEED = /^Fills your empty \S+ (this week|in week \d+|while \S+ sits on bye)\.$/;
const KEEP_RULE = 'A player we rank first at his position goes only for';

/** A signed figure as its cell prints it: "+0.7", "−0.3". */
const signedValue = (s: string): number => Number(s.replace(MINUS, '-'));

const web = process.argv[2] ?? 'http://localhost:4173';
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
const clock = (await fixtureApiClock(API_ORIGIN)).clock;
if (clock === null) throw new Error(`The fixture API at ${API_ORIGIN} runs on the real clock.`);
const out = new URL(process.argv[3] ?? '../screenshots/trades/', import.meta.url);

interface Seen {
	gainHead: string;
	gainBasis: string[];
	cards: string[];
	verbLooks: string[];
	/** Each finder row and strip card: what the member gives, his gain, and the needs it says. */
	trades: { give: string; gain: string; needs: string[] }[];
	basis: string;
}

async function seen(page: Page): Promise<Seen> {
	return page.evaluate(() => {
		const shown = (el: Element): boolean => (el as HTMLElement).offsetParent !== null;
		const text = (el: Element): string => (el as HTMLElement).innerText.trim();
		return {
			gainHead: document.querySelector('main table.finder .gh')?.textContent.trim() ?? '',
			gainBasis: [...document.querySelectorAll('main table.finder thead tr.gain-basis td.gb')]
				.filter(shown)
				.map(text),
			cards: [...document.querySelectorAll('main .card')].map(text),
			verbLooks: [...document.querySelectorAll('main .card .act .action')].map((a) => a.className),
			trades: [
				...[...document.querySelectorAll('main table.finder > tbody > tr.trade')].map((tr) => ({
					give: tr.querySelector('td.give')?.textContent ?? '',
					gain: tr.querySelector('td.g.first')?.textContent.trim() ?? '',
					needs: [...tr.querySelectorAll('.need, .ph-need')].filter(shown).map(text)
				})),
				...[...document.querySelectorAll('main .card')].map((card) => ({
					give: card.querySelector('.deal b')?.textContent ?? '',
					gain: card.querySelector('em.mine')?.textContent.trim() ?? '',
					needs: [...card.querySelectorAll('.need')].filter(shown).map(text)
				}))
			],
			basis: document.querySelector('main [data-basis]')?.textContent.trim() ?? ''
		};
	});
}

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
	if (!ok) failures.push(what);
};

function checkSeen(s: Seen, where: string, width: number): void {
	// A phone drops the group heads (TradeFinder), its gain heads saying the gain.
	if (width > 900) check(s.gainHead === TRADES.gainHead, `${where}: gain head "${s.gainHead}"`);
	check(
		s.gainBasis.length === 1 && GAIN_BASIS.test(s.gainBasis[0] ?? ''),
		`${where}: gain basis ${s.gainBasis.join(' | ')}`
	);
	check(s.cards.length > 0 && s.cards.length <= 2, `${where}: ${String(s.cards.length)} cards`);
	for (const card of s.cards)
		check(CARD_GAINS.test(card), `${where}: card ${card.replace(/\s+/g, ' ')}`);
	const [lead, ...rest] = s.verbLooks.map((looks) =>
		looks.split(' ').includes('verb') ? 'verb' : 'quiet'
	);
	check(
		lead === 'verb' && rest.every((looks) => looks === 'quiet'),
		`${where}: card verbs ${s.verbLooks.join(' | ')}`
	);
	if (s.cards.length > 1)
		check(
			s.cards[0]?.toLowerCase().startsWith(STRIP.best.toLowerCase()) === true,
			`${where}: the first card not Best`
		);
	// The need is said only where it lists the trade (fix round 1, HIGH-1): the top-ranked stand-in
	// given for under 1.0 a week, on one line at each width, and on no other row.
	const listedForANeed = s.trades.filter(
		(t) => t.give.includes(lastName(KEPT_STAND_IN)) && signedValue(t.gain) < KEEP_GAIN
	);
	check(listedForANeed.length > 0, `${where}: no trade listed for its need`);
	for (const t of s.trades) {
		const wants = listedForANeed.includes(t);
		check(
			t.needs.length === (wants ? 1 : 0) && t.needs.every((need) => NEED.test(need)),
			`${where}: ${t.give.trim()} ${t.gain} says ${JSON.stringify(t.needs)}`
		);
	}
	check(s.basis.includes(KEEP_RULE), `${where}: the footer leaves out the keep rule`);
	check(!s.basis.includes('over replacement'), `${where}: the footer says what a Gain is`);
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const where = `${theme} ${String(width)}`;
		const ctx = await browser.newContext({
			viewport: { width, height: VIEWPORT_HEIGHT },
			colorScheme: theme,
			timezoneId: ZONE
		});
		watchData(ctx);
		await installFixtureApiClock(ctx, API_ORIGIN);
		await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
		await ctx.addInitScript(
			([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
			[THEME_STORAGE_KEY, theme] as const
		);
		const page = await ctx.newPage();
		await page.goto(`${web}/league/${FIXTURE_IDS.league}/trades`, { waitUntil: 'networkidle' });
		try {
			await page.getByText('worth proposing').first().waitFor({ timeout: READY_TIMEOUT_MS });
		} catch (error: unknown) {
			// What the page drew instead, beside the shots, for the report.
			await page.screenshot({ path: new URL(`not-ready-${where}.png`, out).pathname });
			throw error;
		}
		await page.evaluate(() => document.fonts.ready);
		await page.waitForLoadState('networkidle');
		checkSeen(await seen(page), where, width);
		const banned = await copyFault(page, OWN_WORDS, 'main');
		check(banned === null, `${where}: says ${banned ?? ''}`);
		await page.screenshot({
			path: new URL(`trades-${theme}-${String(width)}.png`, out).pathname,
			fullPage: true
		});
		await ctx.close();
	}
}
await browser.close();
if (failures.length > 0) {
	process.stderr.write(`${failures.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`trades shots at ${clock}: ${out.pathname}\n`);
