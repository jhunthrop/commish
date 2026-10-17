// Screenshots of the board row as a box score (Lane 66n): the board (All, WR and K), ADP, a club,
// Compare and the schedule, in both themes at 1440 and 390, with what each must hold asserted at
// every width: no page scrolls sideways (1440, 1024, 768 and 390); the basis is at most five rendered
// lines (the schedule's lead two on a desk); a row's name is set larger than its figures; the Gap head
// names its sum; a plus gap is green and a minus gap rose; Compare's head cell makes the call; no
// rendered word is an em-dash, a semicolon or a betting or trading word. Exits non-zero on a miss.
// Against the built site served by serve-built.ts (npm run preview:static):
//   node scripts/board-row-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['dark', 'light'] as const;
/** Shot widths, and the widths only checked for a sideways scroll. */
const SHOT_WIDTHS = [1440, 390] as const;
const CHECK_WIDTHS = [1024, 768] as const;
const VIEWPORT_HEIGHT = 900;
const PHONE_MAX = 760;
const MAX_BASIS_LINES = 5;
const MAX_SCHEDULE_DESK_LINES = 2;
const GAP_TITLE = "Gap, drafters' ADP less our rank";
/** Copy the site never prints (the copy rules), as whole words. */
const BANNED =
	/—|;|\b(odds|line|spread|favou?red|underdog|bets?|betting|market|buy|sell|price)\b/iu;

interface Shot {
	name: string;
	path: string;
	/** The page draws board rows under a Gap head. */
	rows: boolean;
}

const SHOTS: readonly Shot[] = [
	{ name: 'board-all', path: '/board/ppr-12', rows: true },
	{ name: 'board-wr', path: '/board/ppr-12/wr', rows: true },
	{ name: 'board-k', path: '/board/ppr-12/k', rows: false },
	{ name: 'adp', path: '/adp/ppr-12', rows: true },
	{ name: 'club-dal', path: '/clubs/dal', rows: true },
	{ name: 'compare', path: '/compare?a=puka-nacua&b=ja-marr-chase', rows: false },
	{ name: 'schedule', path: '/schedule', rows: false }
];

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/board-row/', import.meta.url);
const failures: string[] = [];

function fail(tag: string, what: string): void {
	failures.push(`${tag}: ${what}`);
}

/** How many lines an element renders, from its height and its line height. */
async function renderedLines(page: Page, selector: string): Promise<number | null> {
	return page.evaluate((query) => {
		const el = document.querySelector(query);
		if (!el) return null;
		const style = getComputedStyle(el);
		const visible = [...el.childNodes].length > 0 && el.getBoundingClientRect().height > 0;
		return visible
			? Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight))
			: 0;
	}, selector);
}

async function checkRows(page: Page, tag: string): Promise<void> {
	const sizes = await page.evaluate(() => {
		const row = document.querySelector('.row');
		const name = row?.querySelector('.name');
		const figure = row?.querySelector('.n:not(.rk)');
		return name && figure
			? {
					name: parseFloat(getComputedStyle(name).fontSize),
					figure: parseFloat(getComputedStyle(figure).fontSize)
				}
			: null;
	});
	if (!sizes) fail(tag, 'no board row with a name and a figure');
	else if (sizes.name <= sizes.figure)
		fail(tag, `name ${String(sizes.name)}px not above figure ${String(sizes.figure)}px`);
	const gapTitle = await page.locator('.h.c-gap [title]').first().getAttribute('title');
	if (gapTitle !== GAP_TITLE) fail(tag, `Gap head title ${String(gapTitle)}`);
	const tones = await page.evaluate(() =>
		[...document.querySelectorAll('.c-gap.n')].map((el) => ({
			text: el.textContent.trim(),
			gain: el.classList.contains('gain'),
			loss: el.classList.contains('loss')
		}))
	);
	for (const tone of tones) {
		if (tone.text.startsWith('+') && !tone.gain) fail(tag, `plus gap ${tone.text} not green`);
		if (tone.text.startsWith('−') && !tone.loss) fail(tag, `minus gap ${tone.text} not rose`);
	}
}

async function checkPage(page: Page, shot: Shot, tag: string, width: number): Promise<void> {
	// The page's own words: players' and clubs' names are theirs, not copy ("Jalen Price").
	const text = await page.evaluate(() => {
		const main = document.querySelector('main')?.cloneNode(true);
		if (!(main instanceof HTMLElement)) return '';
		for (const name of main.querySelectorAll('.name, .ph a, .picked b, .opp a, td a'))
			name.remove();
		return main.innerText;
	});
	const banned = BANNED.exec(text);
	if (banned) fail(tag, `rendered "${banned[0]}"`);
	if (shot.name === 'schedule') {
		const lines = await renderedLines(page, 'main .head p');
		if (lines === null || (width > PHONE_MAX && lines > MAX_SCHEDULE_DESK_LINES))
			fail(tag, `schedule lead ${String(lines)} lines`);
		if (!text.includes("the season's expected wins")) fail(tag, 'no ruled wording in the lead');
	} else {
		const lines = await renderedLines(page, '.basis');
		if (lines === null) fail(tag, 'no basis');
		else if (lines > MAX_BASIS_LINES) fail(tag, `basis ${String(lines)} lines`);
		process.stdout.write(`${tag} basis ${String(lines)} lines\n`);
	}
	if (shot.rows) await checkRows(page, tag);
	if (shot.name === 'compare') {
		const call = await page.locator('.call-words').first().innerText();
		if (!/^we would take nacua$/iu.test(call.trim())) fail(tag, `call "${call}"`);
		if ((await page.locator('.evidence').count()) !== 1) fail(tag, 'no single evidence line');
	}
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
	for (const theme of THEMES) {
		for (const width of [...SHOT_WIDTHS, ...CHECK_WIDTHS]) {
			const context = await browser.newContext({
				viewport: { width, height: VIEWPORT_HEIGHT },
				colorScheme: theme,
				deviceScaleFactor: width <= PHONE_MAX ? 2 : 1
			});
			await context.addInitScript(
				([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
				[THEME_STORAGE_KEY, theme] as const
			);
			const page = await context.newPage();
			for (const shot of SHOTS) {
				const tag = `${shot.name} ${theme} ${String(width)}`;
				await page.goto(`${web}${shot.path}`, { waitUntil: 'networkidle' });
				await page.evaluate(() => document.fonts.ready);
				if (shot.name === 'compare') await page.locator('.cmp').waitFor();
				const wide = await page.evaluate(
					() => document.documentElement.scrollWidth - window.innerWidth
				);
				if (wide > 0) fail(tag, `scrolls sideways by ${String(wide)}px`);
				if ((SHOT_WIDTHS as readonly number[]).includes(width)) {
					await checkPage(page, shot, tag, width);
					await page.screenshot({
						path: new URL(`${shot.name}-${theme}-${String(width)}.png`, out).pathname,
						fullPage: true
					});
				}
			}
			await context.close();
		}
	}
} finally {
	await browser.close();
}
if (failures.length > 0) throw new Error(`Lane 66n shots:\n${failures.join('\n')}`);
process.stdout.write('board-row shots: every check held\n');
