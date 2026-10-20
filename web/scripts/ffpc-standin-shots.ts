// Screenshots of an FFPC league's screens and the Account room's platforms (Lane 94), against the
// fixture API (scripts/inseason-fixture/serve.ts) asked for its FFPC stand-in (ffpc.ts, the
// fixture_platform=ffpc cookie) and the built site, light at 1280 and 390, on the fixture week's
// clock. It asserts the standings say FFPC's seeding under the table and draw no cut by record, the
// Lineup's basis says the PPR column nearest FFPC's rules with FFPC's tight end extra beside it, and
// the Account room's platforms say one state word each, what each connection is connected to, and no
// internal field. Exits non-zero on any fault.
//
//   FIXTURE_CLOCK=2026-10-17T17:00:00.000Z PORT=8799 node scripts/inseason-fixture/serve.ts
//   node scripts/ffpc-standin-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL set to the fixture API's origin.
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { copyFault, watchData } from './copy-scan.ts';
import { installFixtureApiClock, requireFixtureClock } from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const WIDTHS = [1440, 1280, 390] as const;
/** The Connection column's least width at a desk, where its line wraps within it (fix round 1). */
const CONNECTION_MIN_PX = 200;
const DESK = 900;
const VIEWPORT_HEIGHT = 900;
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const FFPC_PLATFORM = { name: 'fixture_platform', value: 'ffpc' };
const SEEDING =
	'FFPC seeds 4 for the playoffs, weeks 13 to 14: 1 and 3 on record, 2 and 4 on points.';
const NEAREST_WORDS = "PPR shown, nearest FFPC's rules";
const TE_WORDS = 'FFPC adds 0.5 a catch for TEs.';
const STATES = ['Connected', 'Followed', 'Not connected', 'Not yet open', 'Signed in'] as const;

const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? '../screenshots/lane-94/', import.meta.url);
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
await requireFixtureClock(API_ORIGIN);
await mkdir(out, { recursive: true });

const faults: string[] = [];
const fault = (where: string, what: string): void => {
	faults.push(`${where}: ${what}`);
};

const browser = await chromium.launch();

async function open(width: number, path: string, text: string): Promise<Page> {
	const ctx = await browser.newContext({
		viewport: { width, height: VIEWPORT_HEIGHT },
		colorScheme: 'light'
	});
	watchData(ctx);
	await installFixtureApiClock(ctx, API_ORIGIN);
	await ctx.addCookies(
		[SIGNED_IN, FFPC_PLATFORM].map((c) => ({ ...c, domain: 'localhost', path: '/' }))
	);
	await ctx.addInitScript(
		([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
		[THEME_STORAGE_KEY, 'light'] as const
	);
	const page = await ctx.newPage();
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
	await page
		.getByText(text)
		.filter({ visible: true })
		.first()
		.waitFor({ timeout: READY_TIMEOUT_MS });
	return page;
}

async function shoot(page: Page, name: string, width: number): Promise<void> {
	await page.screenshot({
		path: new URL(`${name}-${String(width)}.png`, out).pathname,
		fullPage: true
	});
	const banned = await copyFault(page);
	if (banned !== null) fault(`${name} ${String(width)}`, `says ${banned}`);
	await page.context().close();
}

const league = `/league/${FIXTURE_IDS.league}`;
for (const width of WIDTHS) {
	const home = await open(width, league, 'Standings');
	const seeding = await home.locator('.stand .seeding').textContent();
	if (seeding?.trim() !== SEEDING) fault(`league ${String(width)}`, `seeding "${seeding ?? ''}"`);
	if ((await home.locator('.standings tr.rule').count()) !== 0)
		fault(`league ${String(width)}`, 'a cut by record under the standings');
	const homeText = (await home.locator('main').textContent()) ?? '';
	if (!homeText.includes(NEAREST_WORDS) || !homeText.includes(TE_WORDS))
		fault(`league ${String(width)}`, 'no nearest rules and tight end extra in the basis');
	await shoot(home, 'ffpc-league', width);

	const start = await open(width, `${league}/start`, 'Copy the lineup');
	const body = (await start.locator('main').textContent()) ?? '';
	if (!body.includes(NEAREST_WORDS) || !body.includes(TE_WORDS))
		fault(`lineup ${String(width)}`, 'no nearest rules and tight end extra in the basis');
	await shoot(start, 'ffpc-lineup', width);

	const account = await open(width, '/account', 'Platforms');
	const states = await account.locator('.platforms tbody .st b').allTextContents();
	const lines = await account.locator('.platforms tbody .st b + span').allTextContents();
	const said = states.map((s) => s.trim());
	// ESPN's session kept unproven reads connected; FFPC signed in (rows ESPN, Sleeper, Yahoo,
	// MyFantasyLeague, FFPC).
	if (said[0] !== 'Connected' || said[4] !== 'Signed in')
		fault(`account ${String(width)}`, `states ${said.join(' | ')}`);
	for (const s of said)
		if (!(STATES as readonly string[]).includes(s) && s !== 'Not followed')
			fault(`account ${String(width)}`, `state "${s}"`);
	const text = [...said, ...lines].join(' ');
	if (/consent|checked/.test(text))
		fault(`account ${String(width)}`, `internal field in "${text}"`);
	if (!lines.some((l) => l.includes('league followed') || l.includes('leagues followed')))
		fault(`account ${String(width)}`, `no league count in ${lines.join(' | ')}`);
	if (width > DESK) {
		const head = await account.locator('.platforms thead th').nth(1).boundingBox();
		if (head === null || head.width < CONNECTION_MIN_PX)
			fault(`account ${String(width)}`, `Connection column ${String(head?.width ?? 0)} px`);
		// Every platform's name sits on one line inside its own cell, never into Connection's.
		const spill = await account.locator('.platforms tbody th.name').evaluateAll((cells) =>
			cells.flatMap((cell) => {
				const range = document.createRange();
				range.selectNodeContents(cell);
				const text = range.getBoundingClientRect();
				const box = cell.getBoundingClientRect();
				const lines = range.getClientRects().length;
				return text.right > box.right || lines > 1 ? [cell.textContent.trim()] : [];
			})
		);
		if (spill.length > 0)
			fault(`account ${String(width)}`, `names past their cell: ${spill.join(', ')}`);
		// Every row's verb sits whole inside the table.
		const table = await account.locator('.platforms table').boundingBox();
		for (const verb of await account
			.locator('.platforms tbody .act a, .platforms tbody .act button')
			.all()) {
			const box = await verb.boundingBox();
			if (table !== null && box !== null && box.x + box.width > table.x + table.width)
				fault(
					`account ${String(width)}`,
					`verb "${(await verb.textContent()) ?? ''}" past the table`
				);
		}
	}
	// One time a row: the ESPN row's last read is its leagues' newest, as the leagues table says it.
	const bare = (r: string | null): string => (r ?? '').replace('Last read', '').trim();
	const espnRead = bare(
		await account.locator('.platforms tbody tr').first().locator('.read').textContent()
	);
	const leagueReads = (await account.locator('#your-leagues tbody .read').allTextContents()).map(
		bare
	);
	if (!leagueReads.includes(espnRead))
		fault(`account ${String(width)}`, `ESPN read "${espnRead}" is no league's`);
	await shoot(account, 'account-platforms', width);
}
await browser.close();

if (faults.length > 0) {
	for (const f of faults) process.stderr.write(`${f}\n`);
	process.exit(1);
}
process.stdout.write(`ffpc stand-in shots: ${String(WIDTHS.length * 3)} pages, no fault\n`);
