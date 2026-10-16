// Screenshots of a player's injury status on the board and his page (Lane 63), in both themes at 1440
// and 390, on a Central clock: the board's basis line with the capture's sentence, a row on injured
// reserve (his rank shown as IR, below every available player at his position), a doubtful row with
// its mark, the position view's season-long block, both player pages, and the record's method words.
// Each asserts what it shows. Against the built site served static, built from a run whose
// designations.json the capture wrote (`uv run python -m research.nightly mark --out web/.runs`).
//
//   node scripts/injury-status-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const VIEWPORT_HEIGHT = 900;
const ZONE = 'America/Chicago';
const HELD = { slug: 'de-von-achane', name: 'Achane', position: 'RB' };
const DOUBTFUL = { slug: 'david-montgomery', name: 'Montgomery' };
const CAPTURE =
	/(Injury status from the hourly capture|The hourly injury capture is behind), (read|as the list stood) \w{3} \w{3} \d{1,2}, \d{1,2}:\d{2} [ap]m Central\./;

const web = process.argv[2] ?? 'http://localhost:4681';
const out = new URL(process.argv[3] ?? '../screenshots/injury-status/', import.meta.url);
const failures: string[] = [];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

async function context(theme: string, width: number): Promise<BrowserContext> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: theme as 'light',
		timezoneId: ZONE
	});
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	// No live provider: faces come from the headshot route, which is left unanswered here.
	await ctx.route('**/img/**', (route) => route.abort());
	return ctx;
}

function file(name: string): string {
	return new URL(`${name}.png`, out).pathname;
}

function check(ok: boolean, what: string): void {
	if (!ok) failures.push(what);
}

/** The page once its status words are said on the member's clock. */
async function open(page: Page, path: string): Promise<void> {
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
	await page.waitForFunction(() => document.body.innerText.includes('Central'), undefined, {
		timeout: 15_000
	});
}

/** The row of a player by his name, and its text. */
function row(page: Page, name: string): ReturnType<Page['locator']> {
	return page.locator('.row', { hasText: name }).first();
}

async function board(page: Page, tag: string): Promise<void> {
	await open(page, '/board');
	const lead = await page.locator('main div.lead').innerText();
	check(CAPTURE.test(lead), `${tag}: the basis line names the capture: ${lead}`);
	await page.screenshot({ path: file(`board-basis-${tag}`) });
	const held = row(page, HELD.name);
	const heldText = await held.innerText();
	check(/\bIR\b/.test(heldText), `${tag}: his rank shows as IR: ${heldText}`);
	check(
		!/RD \d|picks (later|earlier)|\bT\d+\b/.test(heldText),
		`${tag}: no round, gap or tier frames his rank: ${heldText}`
	);
	check(
		heldText.includes('On injured reserve since September 28.') &&
			heldText.includes('assumes he plays, so he sits below the available players.'),
		`${tag}: the IR row's sentence: ${heldText}`
	);
	const order = await page.locator('.row').evaluateAll(
		(rows, position) =>
			rows.map((r) => ({
				text: (r as HTMLElement).innerText,
				at: r.textContent.includes(position)
			})),
		HELD.position
	);
	const heldAt = order.findIndex((r) => r.text.includes(HELD.name));
	const lastAvailable = order.findLastIndex(
		(r, i) => i !== heldAt && r.at && !/\bIR\b|PUP|NFI|Susp/.test(r.text)
	);
	check(
		heldAt > lastAvailable,
		`${tag}: the IR back follows every available back (${heldAt} after ${lastAvailable})`
	);
	await held.scrollIntoViewIfNeeded();
	await page.screenshot({ path: file(`board-ir-row-${tag}`) });
	const doubtful = row(page, DOUBTFUL.name);
	const doubtfulText = await doubtful.innerText();
	check(
		/Doubtful as of \w{3} \d{1,2}\b/.test(doubtfulText),
		`${tag}: the doubtful mark: ${doubtfulText}`
	);
	await doubtful.scrollIntoViewIfNeeded();
	await page.screenshot({ path: file(`board-doubtful-row-${tag}`) });
}

async function positionView(page: Page, tag: string): Promise<void> {
	await open(page, '/board/ppr-12/rb');
	const block = page.locator('.tier', { hasText: 'On a season-long list' });
	check((await block.count()) === 1, `${tag}: the backs' view has a season-long block`);
	check((await block.innerText()).includes(HELD.name), `${tag}: the block holds him`);
	await block.scrollIntoViewIfNeeded();
	await page.screenshot({ path: file(`board-rb-held-${tag}`) });
}

async function playerPages(page: Page, tag: string): Promise<void> {
	await open(page, `/players/${HELD.slug}`);
	const text = await page.locator('main').innerText();
	check(text.includes('RB IR'), `${tag}: his pill shows IR`);
	check(
		text.includes('On injured reserve since September 28.'),
		`${tag}: his page says since when`
	);
	check(CAPTURE.test(text), `${tag}: his page names the capture`);
	check(!/Tier \d/.test(text.split('This season')[0] ?? ''), `${tag}: no tier chip places him`);
	check(
		text.includes('He sits below the available players.') && !/picks? (later|earlier)/.test(text),
		`${tag}: his drafters fact gives the ADP alone`
	);
	await page.screenshot({ path: file(`player-ir-${tag}`) });
	await open(page, `/players/${DOUBTFUL.slug}`);
	const week = await page.locator('main').innerText();
	check(
		week.includes('Doubtful on the latest report, which does not move his place on our board.'),
		`${tag}: the doubtful page's week line`
	);
	await page.screenshot({ path: file(`player-doubtful-${tag}`) });
}

async function recordPage(page: Page, tag: string): Promise<void> {
	await open(page, '/record');
	const text = await page.locator('main').innerText();
	check(text.includes('as it froze, before that move.'), `${tag}: the record's method words`);
	await page.locator('main p').last().scrollIntoViewIfNeeded();
	await page.screenshot({ path: file(`record-method-${tag}`) });
}

for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const tag = `${theme}-${String(width)}`;
		const ctx = await context(theme, width);
		const page = await ctx.newPage();
		await board(page, tag);
		await positionView(page, tag);
		await playerPages(page, tag);
		await recordPage(page, tag);
		const sideways = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth
		);
		check(!sideways, `${tag}: nothing scrolls sideways`);
		await ctx.close();
	}
}
await browser.close();

for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
process.stdout.write(
	`${failures.length === 0 ? 'ok' : 'failed'}: ${String(failures.length)} failures\n`
);
process.exit(failures.length === 0 ? 0 : 1);
