// Screenshots of the Terms of Service and the Privacy Policy, and of the site footer under the pages
// it closes (Lane 151, launch audit C1), against the fixture API (scripts/inseason-fixture/serve.ts)
// and the built site, in both themes at 1440, 1280 and 390, the browser on the fixture API's clock.
// On each legal page it asserts the draft note, the title, the operator and the contact, the copy
// guard over the page, and no sideways scroll. Under the front door, a player page (its verb pinned
// on a phone), Our record, the board, the account page, a followed league's page (its lineup verb
// pinned on a phone, the page's bottom shot whole), a new mock draft and the not-found page, signed
// out and signed in where each is read, it asserts one footer with the Terms, the Privacy Policy and the contact, in at most two drawn lines
// (inside Lane 138's budgets, five at a desk and eight in a hand), nothing drawn over it once the
// page is scrolled to its end, and the copy guard over it. On the account page it asserts the foot's
// deletion sentence with the contact. Exits non-zero on any fault.
//
//   node scripts/legal-shots.ts [web origin] [api origin] [out dir]
// with the site built against PUBLIC_API_URL set to the fixture API's origin.
import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { SUPPORT_EMAIL } from '../src/lib/legal/contact.ts';
import { DRAFT_NOTE } from '../src/lib/legal/legal-doc.ts';
import { FOOT } from '../src/lib/legal/foot-words.ts';
import { ACCOUNT_FOOT } from '../src/lib/account/foot-words.ts';
import { ERROR_WORDS } from '../src/lib/site/error-words.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';
import { basisLines } from './basis-lines.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { installFixtureApiClock } from './inseason-fixture/clock.ts';

const web = process.argv[2] ?? 'http://localhost:4351';
const API_ORIGIN = process.argv[3] ?? 'http://localhost:8851';
const out = new URL(process.argv[4] ?? '../screenshots/legal/', import.meta.url);
const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 1280, 390] as const;
const PHONE_MAX = 760;
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 400;
/** The footer's most drawn lines: one at a desk, two in a hand, well inside Lane 138's budgets. */
const FOOT_LINES = { desk: 1, phone: 2 } as const;
const FOOTER = 'footer.site-foot';
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };

type Theme = (typeof THEMES)[number];
type Who = 'signed-out' | 'signed-in';

interface LegalPage {
	name: string;
	path: string;
	title: string;
}

const LEGAL: readonly LegalPage[] = [
	{ name: 'terms', path: '/terms', title: 'Terms of Service' },
	{ name: 'privacy', path: '/privacy', title: 'Privacy Policy' }
];

interface Closed {
	name: string;
	path: string;
	/** Words that say the page has drawn. */
	ready: string;
	/** Who reads it. */
	who: readonly Who[];
	/** The page pins its verb above the tab bar on a phone (data-pin), so the footer keeps its room. */
	pinned?: boolean;
	/** The page's whole length is shot too: its bottom, under the footer. */
	whole?: boolean;
}

const BOTH: readonly Who[] = ['signed-out', 'signed-in'];

/** The pages the footer is checked under: prerendered ones, the Worker-drawn league and mock pages,
 * and the prerendered not-found page. */
const CLOSED: readonly Closed[] = [
	{ name: 'front', path: '/', ready: 'Commish LLC', who: BOTH },
	{ name: 'player', path: '/players/puka-nacua', ready: 'Puka Nacua', who: ['signed-out'] },
	{ name: 'record', path: '/record', ready: 'Commish LLC', who: ['signed-out'] },
	{ name: 'board', path: '/board', ready: 'Commish LLC', who: ['signed-out'] },
	{ name: 'account', path: '/account', ready: ACCOUNT_FOOT.before.trim(), who: BOTH },
	{
		name: 'league',
		path: `/league/${FIXTURE_IDS.league}`,
		ready: 'Commish LLC',
		who: ['signed-in'],
		pinned: true,
		whole: true
	},
	{ name: 'mock', path: '/mock/new', ready: 'Commish LLC', who: BOTH },
	{
		name: 'not-found',
		path: '/no-such-page',
		ready: ERROR_WORDS.notFound.lead,
		who: ['signed-out']
	}
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const faults: string[] = [];

function fault(where: string, what: string): void {
	faults.push(`${where}: ${what}`);
}

async function context(theme: Theme, width: number, who: Who): Promise<BrowserContext> {
	const phone = width <= PHONE_MAX;
	const ctx = await browser.newContext({
		viewport: { width, height: phone ? 844 : 900 },
		deviceScaleFactor: phone ? 2 : 1,
		colorScheme: theme
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	if (who === 'signed-in') await ctx.addCookies([{ ...SIGNED_IN, domain: 'localhost', path: '/' }]);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, theme] as const
	);
	return ctx;
}

async function ready(page: Page, text: string): Promise<void> {
	await page
		.getByText(text)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');
}

function file(name: string): string {
	return new URL(`${name}.png`, out).pathname;
}

/** The footer's parts as drawn, in order. */
function footerParts(page: Page): Promise<string[]> {
	return page.evaluate(
		(sel) =>
			[...document.querySelectorAll(`${sel} > *`)].map((el) =>
				(el as HTMLElement).innerText.trim()
			),
		FOOTER
	);
}

/** Each footer part the page draws something else over, scrolled to the page's end. */
function coveredParts(page: Page): Promise<string[]> {
	return page.evaluate((sel) => {
		window.scrollTo(0, document.documentElement.scrollHeight);
		return [...document.querySelectorAll(`${sel} > *`)]
			.filter((el) => {
				const r = el.getBoundingClientRect();
				const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
				return hit === null || !el.contains(hit);
			})
			.map((el) => (el as HTMLElement).innerText.trim());
	}, FOOTER);
}

async function checkFooter(page: Page, where: string, width: number): Promise<void> {
	const count = await page.locator(FOOTER).count();
	if (count !== 1) fault(where, `draws ${String(count)} site footers, not one`);
	const parts = await footerParts(page);
	const want = [FOOT.owner, FOOT.terms, FOOT.privacy, SUPPORT_EMAIL];
	if (JSON.stringify(parts) !== JSON.stringify(want)) {
		fault(where, `the footer reads ${parts.join(' | ')}, not ${want.join(' | ')}`);
	}
	const hrefs = await page
		.locator(`${FOOTER} a`)
		.evaluateAll((links) => links.map((a) => a.getAttribute('href')));
	if (JSON.stringify(hrefs) !== JSON.stringify(['/terms', '/privacy', `mailto:${SUPPORT_EMAIL}`])) {
		fault(where, `the footer links ${hrefs.join(', ')}`);
	}
	const lines = await basisLines(page, FOOTER);
	const most = width <= PHONE_MAX ? FOOT_LINES.phone : FOOT_LINES.desk;
	if (lines < 1 || lines > most)
		fault(where, `the footer draws ${String(lines)} lines, most ${String(most)}`);
	await page.waitForTimeout(SETTLE_MS);
	const covered = await coveredParts(page);
	if (covered.length > 0) fault(where, `drawn over at the page's end: ${covered.join(', ')}`);
	const words = await copyFault(page, undefined, FOOTER);
	if (words !== null) fault(where, `the footer says ${words}`);
	const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
	if (wide) fault(where, 'scrolls sideways');
}

async function shootLegal(theme: Theme, width: number, doc: LegalPage): Promise<void> {
	const where = `${doc.name} ${theme} ${String(width)}`;
	const ctx = await context(theme, width, 'signed-out');
	const page = await ctx.newPage();
	await page.goto(`${web}${doc.path}`, { waitUntil: 'networkidle' });
	await ready(page, DRAFT_NOTE);
	const title = await page.evaluate(() => document.title);
	if (title !== `${doc.title} · Commish`) fault(where, `the document title is ${title}`);
	const text = await page.locator('main').innerText();
	for (const want of [
		DRAFT_NOTE,
		'Commish LLC, an Arkansas limited liability company',
		SUPPORT_EMAIL
	]) {
		if (!text.includes(want)) fault(where, `the page never says ${want}`);
	}
	const words = await copyFault(page);
	if (words !== null) fault(where, `the page says ${words}`);
	await checkFooter(page, where, width);
	await page.screenshot({ path: file(`${doc.name}-${theme}-${String(width)}`), fullPage: true });
	process.stdout.write(`${file(`${doc.name}-${theme}-${String(width)}`)}\n`);
	await ctx.close();
}

async function shootClosed(theme: Theme, width: number, who: Who, closed: Closed): Promise<void> {
	const where = `${closed.name} ${who} ${theme} ${String(width)}`;
	const ctx = await context(theme, width, who);
	const page = await ctx.newPage();
	await page.goto(`${web}${closed.path}`, { waitUntil: 'networkidle' });
	await ready(page, closed.ready);
	if (closed.pinned === true && width <= PHONE_MAX) {
		// The pin must be drawn for the room under the footer to be tested at all.
		const pin = page.locator('[data-pin]').filter({ visible: true }).first();
		await pin.waitFor({ timeout: READY_TIMEOUT_MS }).catch(() => {
			fault(where, 'no verb pinned above the tab bar was drawn');
		});
	}
	await checkFooter(page, where, width);
	if (closed.name === 'account') {
		const foot = await page.locator(`section[aria-label="${ACCOUNT_FOOT.label}"]`).innerText();
		for (const want of [
			ACCOUNT_FOOT.before.trim(),
			SUPPORT_EMAIL,
			ACCOUNT_FOOT.privacy,
			ACCOUNT_FOOT.terms
		]) {
			if (!foot.includes(want)) fault(where, `the account foot never says ${want}`);
		}
	}
	const name = `foot-${closed.name}-${who}-${theme}-${String(width)}`;
	await page.screenshot({ path: file(name) });
	process.stdout.write(`${file(name)}\n`);
	if (closed.whole === true) {
		await page.screenshot({ path: file(`${name}-whole`), fullPage: true });
		process.stdout.write(`${file(`${name}-whole`)}\n`);
	}
	await ctx.close();
}

for (const theme of THEMES) {
	for (const width of WIDTHS) {
		for (const doc of LEGAL) await shootLegal(theme, width, doc);
		for (const closed of CLOSED) {
			for (const who of closed.who) await shootClosed(theme, width, who, closed);
		}
	}
}
await browser.close();

if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write('legal-shots: every check passed\n');
