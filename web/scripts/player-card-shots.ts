// Screenshots of the player card (Lane 66h) in both themes at 1440 and 390, on a Central clock:
// signed out (the week in PPR, Add to my sheet), and in the fixture's Sleeper league a player another
// roster holds (Trade for him), one our lineup starts (Start him), one no roster holds (Open Sleeper
// waivers), Compare open with a second player, a player whose week read is withheld (his status
// changed), and in an ESPN stand-in league the claim (Add on ESPN) followed onto Waivers. Each asserts
// what it shows:
//   the six tiles, each "--" with its reason on the tile, Opp rank's direction in words, the shared
//   status pill, the verb and Compare, the week read's caption (or its withheld caption alone), the
//   season read's stamp, the week ahead's row, the earlier seasons collapsed, the basis in at most five
//   rendered lines at 1440 and eight at 390, no betting or trading word, no "host", no dash or
//   semicolon in the card's words, nothing scrolling sideways, and on a phone the pinned verb clearing
//   the first tiles.
// The Rest of season tile shows on a run that ranks the rest of the season: set ROS_FROM_WEEK to its
// first week (the site built from the nightly's contract fixture run, research/nightly/contract/
// fixture, PUBLIC_RUN_ID=2026-10-21T12-ros) and one signed-out page is shot with the tile held to
// "Rest of season ... in our order"; that run predates the reads' stamps and the earlier seasons, so
// those two are not asked of it. Otherwise the tile is held to "Projected".
// A season-long player (De'Von Achane on injured reserve) needs the run's designations: after
// `npm run standin`, `uv run python -m research.nightly mark --out ../web/.runs` (from research/,
// RESEARCH_DATABASE_URL the dev store, read only) writes the newest capture beside it; his pill and
// his rest tile are held to Lane 63's word.
// Against the built site served by the Worker and the fixture API (scripts/inseason-fixture/serve.ts).
//
//   [ROS_FROM_WEEK=6] node scripts/player-card-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL pointing at the fixture API.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['dark', 'light'] as const;
const PHONE_WIDTH = 390;
const WIDTHS = [1440, PHONE_WIDTH] as const;
const VIEWPORT_HEIGHT = 900;
const ZONE = 'America/Chicago';
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const ESPN_LEAGUE = { name: 'fixture_league', value: 'espn' };
const BANNED =
	/\b(favou?red|underdogs?|odds|spreads?|bets?|betting|market|buy|sell|price|host|tips?)\b|—|;/i;
const NONE = '--';
const PROJECTED = 'Projected';
const REST = 'Rest of season';
const DIRECTION = /, (among the easiest for|among the toughest for|in the middle for) \w/;
const ROS_FROM_WEEK = process.env.ROS_FROM_WEEK;
const REST_CAPTION = /^from week \d+, (\d+\.\d a game, )?[A-Z]{2}\d+ in our order$/;
/** The basis's rendered lines at most, by width (review M6). */
const BASIS_LINES: Readonly<Record<number, number>> = { 1440: 5, [PHONE_WIDTH]: 8 };
const WEEK_READ = /Written \w{3} \d{1,2}:\d{2} [ap]m Central, for week \d+/;
const WITHHELD = 'His status changed since this read was written. A new read is due by';

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/player-card/', import.meta.url);

type WeekReadState = 'shown' | 'withheld' | 'none';

interface Shot {
	name: string;
	slug: string;
	signedIn: boolean;
	verb: string;
	weekRead: WeekReadState;
	compare?: string;
	/** Selects an ESPN stand-in league, whose claims are made from here. */
	espn?: boolean;
	/** Follows the verb onto Waivers, his row marked and his drops open. */
	follow?: boolean;
	/** On a season-long list: the pill and the rest tile show Lane 63's word, never a rank. */
	held?: string;
}

const SHOTS: readonly Shot[] = [
	{
		name: 'signed-out',
		slug: 'puka-nacua',
		signedIn: false,
		verb: 'Add to my sheet',
		weekRead: 'shown'
	},
	{ name: 'trade', slug: 'puka-nacua', signedIn: true, verb: 'Trade for him', weekRead: 'shown' },
	{ name: 'start', slug: 'jaxson-dart', signedIn: true, verb: 'Start him', weekRead: 'none' },
	{
		name: 'waivers',
		slug: 'xavier-hutchinson',
		signedIn: true,
		verb: 'Open Sleeper waivers',
		weekRead: 'none'
	},
	{
		name: 'compare',
		slug: 'puka-nacua',
		signedIn: true,
		verb: 'Trade for him',
		weekRead: 'shown',
		compare: "Ja'Marr Chase"
	},
	{
		name: 'withheld',
		slug: 'ceedee-lamb',
		signedIn: true,
		verb: 'Trade for him',
		weekRead: 'withheld'
	},
	{
		name: 'held',
		slug: 'de-von-achane',
		signedIn: false,
		verb: 'Add to my sheet',
		weekRead: 'none',
		held: 'RB IR'
	},
	{
		name: 'claim',
		slug: 'xavier-hutchinson',
		signedIn: true,
		verb: 'Add on ESPN',
		weekRead: 'none',
		espn: true,
		follow: true
	}
];

/** On the contract fixture's rest-of-season run: one signed-out page, the run's own player. */
const ROS_SHOTS: readonly Shot[] = [
	{ name: 'ros', slug: 'josh-allen', signedIn: false, verb: 'Add to my sheet', weekRead: 'none' }
];
const ROS = ROS_FROM_WEEK !== undefined;

const failures: string[] = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number, shot: Shot): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		timezoneId: ZONE
	});
	const cookies = [
		...(shot.signedIn ? [SIGNED_IN] : []),
		...(shot.espn === true ? [ESPN_LEAGUE] : [])
	];
	await ctx.addCookies(cookies.map((c) => ({ ...c, domain: 'localhost', path: '/' })));
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

function check(ok: boolean, what: string): void {
	if (!ok) failures.push(what);
}

interface Card {
	labels: string[];
	values: Record<string, string>;
	captions: Record<string, string>;
	pill: string;
	verbs: string[];
	text: string;
	cardText: string;
	readText: string;
	basis: string[];
	basisLines: number;
	nextRow: string;
	earlier: string;
	earlierOpen: boolean;
	sideways: boolean;
	pinTop: number | null;
	tilesBottom: number | null;
}

async function read(page: Page): Promise<Card> {
	return page.evaluate(() => {
		const tiles = [...document.querySelectorAll('main .card .tile')];
		const labels = tiles.map((t) => t.querySelector('.lb')?.textContent.trim() ?? '');
		const pick = (sel: string): Record<string, string> =>
			Object.fromEntries(
				tiles.map((t, i) => [labels[i] ?? '', t.querySelector(sel)?.textContent.trim() ?? ''])
			);
		const act = document.querySelector('main .card .act');
		const firstTiles = document.querySelector('main .card .tiles');
		const pinned = act !== null && getComputedStyle(act).position === 'fixed';
		const basis = [...document.querySelectorAll<HTMLElement>('main .basis p')];
		const lines = basis.reduce((sum, p) => {
			const height = parseFloat(getComputedStyle(p).lineHeight);
			return sum + Math.round(p.getBoundingClientRect().height / height);
		}, 0);
		const toggle = document.querySelector<HTMLElement>('main .season tbody.earlier button');
		return {
			labels,
			values: pick('.v'),
			captions: pick('.cap'),
			pill: document.querySelector<HTMLElement>('main .card .sub')?.innerText ?? '',
			verbs: [...document.querySelectorAll('main .card .act a, main .card .act button')].map((el) =>
				(el as HTMLElement).innerText.trim()
			),
			text: document.body.innerText,
			cardText: document.querySelector<HTMLElement>('main .card')?.innerText ?? '',
			readText: document.querySelector<HTMLElement>('main .read')?.innerText ?? '',
			basis: basis.map((p) => p.innerText),
			basisLines: lines,
			nextRow: document.querySelector<HTMLElement>('main .season tr.next')?.innerText ?? '',
			earlier: toggle?.innerText ?? '',
			earlierOpen: toggle?.getAttribute('aria-expanded') === 'true',
			sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
			pinTop: pinned ? act.getBoundingClientRect().top : null,
			tilesBottom: firstTiles ? firstTiles.getBoundingClientRect().top + 90 : null
		};
	});
}

async function openCompare(page: Page, name: string): Promise<void> {
	await page.getByRole('button', { name: 'Compare' }).first().click();
	const input = page.getByPlaceholder('Add a player');
	await input.waitFor({ timeout: READY_TIMEOUT_MS });
	await input.fill(name.split(' ')[1] ?? name);
	await page
		.getByRole('button', { name: new RegExp(name) })
		.first()
		.click();
	await page.locator('#compare tbody tr').nth(1).waitFor({ timeout: READY_TIMEOUT_MS });
	await page.waitForLoadState('networkidle');
}

/** The tiles, each "--" with its reason, and rest of season's label as the run covers it. */
function checkTiles(card: Card, where: string): void {
	const rest = ROS_FROM_WEEK === undefined ? PROJECTED : REST;
	const want = ['Proj', rest, 'Opp rank', 'Avg', 'Last', 'Δ Proj'];
	check(card.labels.join('|') === want.join('|'), `${where}: tiles ${card.labels.join(', ')}`);
	if (ROS_FROM_WEEK !== undefined)
		check(REST_CAPTION.test(card.captions[REST] ?? ''), `${where}: rest of season's caption`);
	for (const label of card.labels) {
		if (card.values[label] === NONE)
			check((card.captions[label] ?? '') !== '', `${where}: ${label} is "--" with no reason`);
	}
	const opp = card.values['Opp rank'] ?? '';
	if (opp !== NONE)
		check(DIRECTION.test(card.captions['Opp rank'] ?? ''), `${where}: Opp rank's caption`);
}

function checkCard(card: Card, shot: Shot, where: string, width: number): void {
	checkTiles(card, where);
	// The shared pill always carries his rank or Lane 63's word (review N4).
	check(
		/\b(QB|RB|WR|TE) (\d+|[A-Z]{2,3})\b/.test(card.pill),
		`${where}: the status pill "${card.pill}"`
	);
	if (shot.held !== undefined) {
		check(card.pill.includes(shot.held), `${where}: the pill does not say ${shot.held}`);
		const rest = card.captions[PROJECTED] ?? card.captions[REST] ?? '';
		check(
			rest.includes(`${shot.held}, unranked while on a season-long list`) &&
				!/\d+ in our order/.test(rest),
			`${where}: the rest tile ranks a held player: "${rest}"`
		);
	}
	check(card.verbs.includes(shot.verb), `${where}: verbs ${card.verbs.join(', ')}`);
	check(card.verbs.includes('Compare'), `${where}: no Compare`);
	check(WEEK_READ.test(card.readText) === (shot.weekRead === 'shown'), `${where}: the week read`);
	check(card.readText.includes(WITHHELD) === (shot.weekRead === 'withheld'), `${where}: withheld`);
	if (!ROS && !card.readText.includes('Our written read of him is not ready'))
		check(
			/Written \w{3} \d{1,2}, from his facts through last season/.test(card.readText),
			`${where}: the season read's stamp`
		);
	// A week on bye has no game ahead to draw, and the Proj tile says so.
	if (card.captions.Proj !== 'Bye this week')
		check(card.nextRow !== '', `${where}: no week ahead row in the game log`);
	if (!ROS)
		check(/earlier seasons/i.test(card.earlier) && !card.earlierOpen, `${where}: earlier seasons`);
	const most = BASIS_LINES[width] ?? 0;
	check(card.basisLines <= most, `${where}: the basis runs ${String(card.basisLines)} lines`);
	for (const said of [card.cardText, ...card.basis]) {
		check(!BANNED.test(said), `${where}: a banned word in "${said.slice(0, 80)}"`);
	}
	check(!/\bhost\b/i.test(card.text), `${where}: says host`);
	check(!card.sideways, `${where}: scrolls sideways`);
	if (width === PHONE_WIDTH && card.pinTop !== null && card.tilesBottom !== null)
		check(card.pinTop > card.tilesBottom, `${where}: the pinned verb covers the first tiles`);
}

/** The verb followed onto Waivers: his row marked, his drops open, the claim's way in. */
async function follow(page: Page, shot: Shot, where: string, file: string): Promise<void> {
	await page.getByText(shot.verb).filter({ visible: true }).first().click();
	await page.waitForURL(/\/waivers\?player=/, { timeout: READY_TIMEOUT_MS });
	const marked = page.locator('tr[data-asked]');
	await marked.first().waitFor({ timeout: READY_TIMEOUT_MS });
	check((await marked.count()) === 1, `${where}: his row is not marked on Waivers`);
	await page.waitForLoadState('networkidle');
	await page.screenshot({ path: file });
}

for (const shot of ROS ? ROS_SHOTS : SHOTS) {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const where = `${shot.name} ${theme} ${String(width)}`;
			const ctx = await context(theme, width, shot);
			const page = await ctx.newPage();
			const file = (tag: string): string =>
				new URL(`${shot.name}-${theme}-${String(width)}${tag}.png`, out).pathname;
			try {
				await page.goto(`${web}/players/${shot.slug}`, { waitUntil: 'networkidle' });
				await page
					.getByText(shot.verb)
					.filter({ visible: true })
					.first()
					.waitFor({ timeout: READY_TIMEOUT_MS });
				await page.evaluate(() => document.fonts.ready);
				await page.waitForLoadState('networkidle');
				if (shot.compare !== undefined) await openCompare(page, shot.compare);
				const card = await read(page);
				checkCard(card, shot, where, width);
				if (width === PHONE_WIDTH) {
					await page.screenshot({ path: file('-first-screen') });
					// The full page in one image: the pinned bars set in the flow, as the page reads.
					await page.addStyleTag({
						content: 'nav.rail{display:none!important}main .card .act{position:static!important}'
					});
				}
				await page.screenshot({ path: file(''), fullPage: true });
				if (shot.follow === true) await follow(page, shot, where, file('-waivers'));
				process.stdout.write(
					`${where}: ${card.values.Proj ?? ''} Proj (${card.captions.Proj ?? ''}), ${card.values['Opp rank'] ?? ''}, basis ${String(card.basisLines)} lines, ${card.verbs.join(' / ')}\n`
				);
			} catch (error: unknown) {
				failures.push(`${where}: ${String(error)}`);
			} finally {
				await ctx.close();
			}
		}
	}
}

await browser.close();
for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
process.stdout.write(`${String(failures.length)} failures\n`);
process.exit(failures.length === 0 ? 0 : 1);
