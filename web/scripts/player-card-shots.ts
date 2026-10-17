// Screenshots of the player card (Lane 66h) in both themes at 1440 and 390, on a Central clock:
// signed out (the week in PPR, Add to my sheet), and in the fixture's Sleeper league, a player another
// roster holds (Trade for him), one our lineup starts (Start him), one no roster holds (Open Sleeper
// waivers) and Compare open with a second player. Each asserts what it shows: the six tiles, a figure
// in the Proj tile, the opponent's rank with its direction in words, the verb, the week-ahead read with
// its caption where the run carries one, the season read's stamp, the week ahead's row in the game log,
// no betting or trading word, no "host", no dash or semicolon in the card's words, and that nothing
// scrolls sideways. On a phone the pinned verb clears the first tiles. Against the built site served
// static and the fixture API (scripts/inseason-fixture/serve.ts).
//
//   node scripts/player-card-shots.ts [web origin] [out dir]
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
const BANNED =
	/\b(favou?red|underdogs?|odds|spreads?|bets?|betting|market|buy|sell|price|host|tips?)\b|—|;/i;
const TILES = ['Proj', 'Rest of season', 'Opp rank', 'Avg', 'Last', 'Δ Proj'];
const PROJECTED = 'Projected';
const DIRECTION = /, (among the easiest for|among the toughest for|in the middle for) \w/;

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/player-card/', import.meta.url);

interface Shot {
	name: string;
	slug: string;
	signedIn: boolean;
	verb: string;
	/** The run carries his week-ahead read (the stand-in's three, Lane 72). */
	weekRead: boolean;
	compare?: string;
}

const SHOTS: readonly Shot[] = [
	{
		name: 'signed-out',
		slug: 'puka-nacua',
		signedIn: false,
		verb: 'Add to my sheet',
		weekRead: true
	},
	{ name: 'trade', slug: 'puka-nacua', signedIn: true, verb: 'Trade for him', weekRead: true },
	{ name: 'start', slug: 'jaxson-dart', signedIn: true, verb: 'Start him', weekRead: false },
	{
		name: 'waivers',
		slug: 'xavier-hutchinson',
		signedIn: true,
		verb: 'Open Sleeper waivers',
		weekRead: false
	},
	{
		name: 'compare',
		slug: 'puka-nacua',
		signedIn: true,
		verb: 'Trade for him',
		weekRead: true,
		compare: "Ja'Marr Chase"
	}
];

const failures: string[] = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number, signedIn: boolean): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		timezoneId: ZONE
	});
	if (signedIn) await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
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
	verbs: string[];
	text: string;
	cardText: string;
	nextRow: string;
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
		return {
			labels,
			values: pick('.v'),
			captions: pick('.cap'),
			verbs: [...document.querySelectorAll('main .card .act a, main .card .act button')].map((el) =>
				(el as HTMLElement).innerText.trim()
			),
			text: document.body.innerText,
			cardText: document.querySelector<HTMLElement>('main .card')?.innerText ?? '',
			nextRow: document.querySelector<HTMLElement>('main .season tr.next')?.innerText ?? '',
			sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
			pinTop: pinned ? act.getBoundingClientRect().top : null,
			tilesBottom: firstTiles ? firstTiles.getBoundingClientRect().top + 90 : null
		};
	});
}

for (const shot of SHOTS) {
	for (const theme of THEMES) {
		for (const width of WIDTHS) {
			const where = `${shot.name} ${theme} ${String(width)}`;
			const ctx = await context(theme, width, shot.signedIn);
			const page = await ctx.newPage();
			try {
				await page.goto(`${web}/players/${shot.slug}`, { waitUntil: 'networkidle' });
				await page
					.getByText(shot.verb)
					.filter({ visible: true })
					.first()
					.waitFor({ timeout: READY_TIMEOUT_MS });
				await page.evaluate(() => document.fonts.ready);
				await page.waitForLoadState('networkidle');
				if (shot.compare) {
					await page.getByRole('button', { name: 'Compare' }).first().click();
					const input = page.getByPlaceholder('Add a player');
					await input.waitFor({ timeout: READY_TIMEOUT_MS });
					await input.fill(shot.compare.split(' ')[1] ?? shot.compare);
					await page
						.getByRole('button', { name: new RegExp(shot.compare) })
						.first()
						.click();
					await page.locator('#compare tbody tr').nth(1).waitFor({ timeout: READY_TIMEOUT_MS });
					await page.waitForLoadState('networkidle');
				}
				const card = await read(page);
				const rest = card.labels.includes(PROJECTED) ? PROJECTED : 'Rest of season';
				check(
					card.labels.join('|') === TILES.map((t) => (t === 'Rest of season' ? rest : t)).join('|'),
					`${where}: tiles ${card.labels.join(', ')}`
				);
				check(
					/^\d+\.\d$/.test(card.values.Proj ?? ''),
					`${where}: Proj "${card.values.Proj ?? ''}"`
				);
				const opp = card.values['Opp rank'] ?? '';
				if (opp !== '--')
					check(DIRECTION.test(card.captions['Opp rank'] ?? ''), `${where}: Opp rank's caption`);
				check(card.verbs.includes(shot.verb), `${where}: verbs ${card.verbs.join(', ')}`);
				check(card.verbs.includes('Compare'), `${where}: no Compare`);
				check(
					/Written \w{3} \d{1,2}:\d{2} [ap]m Central, for week \d+/.test(card.text) ===
						shot.weekRead,
					`${where}: the week-ahead read's caption`
				);
				if (!card.text.includes('Our written read of him is not ready'))
					check(
						/Written \w{3} \d{1,2}, from his facts through last season/.test(card.text),
						`${where}: the season read's stamp`
					);
				check(card.nextRow !== '', `${where}: no week ahead row in the game log`);
				for (const said of [
					card.cardText,
					...card.text
						.split('\n')
						.filter((l) => l.startsWith('Proj is') || l.startsWith('Opp rank is'))
				]) {
					check(!BANNED.test(said), `${where}: a banned word in "${said.slice(0, 80)}"`);
				}
				check(!/\bhost\b/i.test(card.text), `${where}: says host`);
				check(!card.sideways, `${where}: scrolls sideways`);
				if (width === PHONE_WIDTH && card.pinTop !== null && card.tilesBottom !== null)
					check(card.pinTop > card.tilesBottom, `${where}: the pinned verb covers the first tiles`);
				const file = (tag: string): string =>
					new URL(`${shot.name}-${theme}-${String(width)}${tag}.png`, out).pathname;
				if (width === PHONE_WIDTH) {
					await page.screenshot({ path: file('-first-screen') });
					// The full page in one image: the pinned bars set in the flow, as the page reads.
					await page.addStyleTag({
						content: 'nav.rail{display:none!important}main .card .act{position:static!important}'
					});
				}
				await page.screenshot({ path: file(''), fullPage: true });
				process.stdout.write(
					`${where}: ${card.values.Proj ?? ''} Proj, ${opp} (${card.captions['Opp rank'] ?? ''}), ${card.verbs.join(' / ')}\n`
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
