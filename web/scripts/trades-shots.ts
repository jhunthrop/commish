// Screenshots of the Trades screen as one experience (Lane 260, after Lane 103; dense since Lane 268)
// at 1280 and 390 in both themes, on the fixture API's clock: the screen as it opens (and its window at
// 1280 by 800 and 390 by 844, with the member's rows in sight counted: ten and seven at least), a trade
// the member builds by tick (his own RB2 for the other team's WR1), the verdict held in sight at a
// desk, and one of our ideas loaded. Each asserts what it shows:
//   no decision line; our ideas by team drawn above the rosters, the best three and the rest behind
//   "N more", the first marked Best and its gains in its one line ("+5.7 yours, +0.7 theirs"); the
//   team picker at the head of their roster opens on the team the first idea
//   names, nothing ticked; a tick on each side reads the verdict with no submit: each side's figures and
//   a bar, the answer line naming the lineups' change; the taps from the page to that verdict are
//   counted; a preset's one tap ticks its players and is pressed; Share copies the trade in our words;
//   the footer says the keep rule; and the page's copy passes the one guard (copy-scan.ts).
// Against the built site and the fixture API (scripts/inseason-fixture/serve.ts) on the fixture
// week's clock:
//
//   node scripts/trades-shots.ts [web origin] [out dir]
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { copyFault, watchData } from './copy-scan.ts';
import { STRIP } from '../src/lib/league/box/strip.ts';
import { TRADES } from '../src/lib/league/box/trades.ts';
import { ANALYZER_LINES } from '../src/lib/league/inseason/builder.ts';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { fixtureApiClock, installFixtureApiClock } from './inseason-fixture/clock.ts';
import { FIXTURE_IDS } from './inseason-fixture/ids.ts';

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1280, 390] as const;
const VIEWPORT_HEIGHT = 900;
const ZONE = 'America/Chicago';
const READY_TIMEOUT_MS = 30_000;
const SIGNED_IN = { name: 'commish_csrf', value: 'fixture' };
const OWN_WORDS = /\bover repl\b|\b(price|market|buy|sell|grade)\b/i;
const IDEA_GAINS = /^[+−]\d+\.\d yours, [+−]\d+\.\d theirs$/;
/** The ideas row's label, which names them as this league's teams (Lane 268). */
const IDEAS_LABEL = 'Our ideas, by team';
/** The best ideas the row shows before its "N more" (Lane 268). */
const IDEAS_SHOWN = 3;
/** The windows the rows are counted in (Lane 268): a desk at 1280 by 800, a phone at 390 by 844, and
 * the fewest whole rows of the member's roster each must show above the verdict as the screen opens. */
const ROW_WINDOWS = {
	1280: { height: 800, rows: 10 },
	390: { height: 844, rows: 7 }
} as const;
const VERDICT =
	/^(Your lineup|Both lineups|Neither lineup|Your roster|Their roster|They give up|You give up|Both sides give up)/;
/** The idea the finder drops for Lane 269's rule (the old Best, Lane 268's shots): Rodgers for
 * Skattebo and Strong with Max_Jensen10 costs them more rest of season than the rule lets a side give
 * up, so the member builds it by tick and the verdict says why they would not take it (Lane 277). */
const REFUSED = { give: ['Aaron Rodgers'], get: ['Cam Skattebo', 'Pierre Strong'] } as const;
const KEEP_RULE = 'A player we rank first at his position goes only for';
/** At this width and under, the rosters stack and the switch draws one at a time (TradeBuilder). */
const STACKS_AT = 1180;
/** The idea the shots load: the second, so the screen visibly changes team and ticks. */
const LOADED_IDEA = 1;

const web = process.argv[2] ?? 'http://localhost:4173';
const API_ORIGIN = new URL(process.env.API_ORIGIN ?? 'http://localhost:8799').origin;
const clock = (await fixtureApiClock(API_ORIGIN)).clock;
if (clock === null) throw new Error(`The fixture API at ${API_ORIGIN} runs on the real clock.`);
const out = new URL(process.argv[3] ?? '../screenshots/trades/', import.meta.url);

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
	if (!ok) failures.push(what);
};

/** What the screen shows: the ideas, the chosen team, the ticks on, the verdict and the basis. */
async function seen(page: Page) {
	return page.evaluate(() => {
		const text = (el: Element | null): string => (el as HTMLElement | null)?.innerText.trim() ?? '';
		return {
			ideas: [...document.querySelectorAll('main .idea')].map((b) => ({
				mark: text(b.querySelector('.mark')),
				gains: text(b.querySelector('.gains')),
				pressed: b.getAttribute('aria-pressed') === 'true'
			})),
			none: [...document.querySelectorAll('main .no-idea .deal')].map((b) => text(b)),
			rest: [...document.querySelectorAll<HTMLElement>('main .bug td.rest')]
				.filter((td) => td.offsetParent !== null)
				.map((td) => text(td)),
			pin: text(document.querySelector('main .builder .pin-gains')),
			team: document.querySelector('main .builder select option:checked')?.textContent.trim() ?? '',
			ticked: document.querySelectorAll('main .builder button.tick[aria-pressed="true"]').length,
			line: text(document.querySelector('main .builder .words .line')),
			bars: [...document.querySelectorAll('main .bug .bar > span')].map(
				(s) => (s as HTMLElement).style.width
			),
			basis: text(document.querySelector('main [data-basis]:not([data-basis="builder"])'))
		};
	});
}

/** The tick of the nth player at a position in a box, by his pill: "RB" 2 is the box's RB2. */
async function tickAt(page: Page, mine: boolean, position: string, nth: number): Promise<string> {
	const box = page.locator(mine ? 'main table.box.mine' : 'main table.box:not(.mine)');
	const rows = box.locator('tbody tr').filter({
		has: page.locator('.pos', { hasText: new RegExp(`^${position}\\b`) })
	});
	const row = rows.nth(nth - 1);
	const name = (await row.locator('td.player').innerText()).split('\n')[0] ?? '';
	await row.locator('button.tick').click();
	return name;
}

/** Ticks a player by name in a box. */
async function tickNamed(page: Page, mine: boolean, name: string): Promise<void> {
	const box = page.locator(mine ? 'main table.box.mine' : 'main table.box:not(.mine)');
	await box
		.locator('tbody tr')
		.filter({ has: page.locator('td.player', { hasText: name }) })
		.locator('button.tick')
		.click();
}

/** Waits for the verdict to read an answer (the answer line names a lineup's change). */
async function verdict(page: Page): Promise<void> {
	await page.waitForFunction(
		(pattern) =>
			new RegExp(pattern).test(
				document.querySelector<HTMLElement>('main .builder .words .line')?.innerText ?? ''
			),
		VERDICT.source,
		{ timeout: READY_TIMEOUT_MS }
	);
}

/** The trade check's route, held back by holdChecks so a read is still out when the verbs are read. */
const CHECK_ROUTE = '**/trades/check';
const HOLD_MS = 1500;

/** Holds every trade check for HOLD_MS before it goes on. */
async function holdChecks(page: Page): Promise<void> {
	await page.route(CHECK_ROUTE, async (route) => {
		await new Promise((done) => setTimeout(done, HOLD_MS));
		await route.continue();
	});
}

/** Whether Propose (the drawn verb is a link) and Share (enabled) act now. */
async function verbs(page: Page): Promise<{ propose: boolean; share: boolean }> {
	return page.evaluate((shareWord) => {
		const acts = [...document.querySelectorAll<HTMLElement>('main .builder .act')].filter(
			(el) => el.offsetParent !== null
		);
		const share = [
			...document.querySelectorAll<HTMLButtonElement>('main .builder .share button')
		].find((b) => b.innerText.trim() === shareWord);
		return {
			propose: acts.some((el) => el.querySelector('a') !== null),
			share: share !== undefined && !share.disabled
		};
	}, ANALYZER_LINES.share);
}

/** Waits for Propose and Share to come live on the answer for the ticks. */
async function waitLive(page: Page): Promise<void> {
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll<HTMLElement>('main .builder .act')].some(
				(el) => el.offsetParent !== null && el.querySelector('a') !== null
			),
		undefined,
		{ timeout: READY_TIMEOUT_MS }
	);
}

/** A side's roster rows wholly in sight as the screen opens: under the bar, over the verdict held at
 * the window's foot (or, where the rosters stack, the pinned gains); with the side's whole roster. */
async function rowsInSight(page: Page, mine: boolean): Promise<{ seen: number; roster: number }> {
	return page.evaluate(
		(box) => {
			const held = [...document.querySelectorAll<HTMLElement>('main .verdict, main .pin')]
				.filter((el) => el.offsetParent !== null && getComputedStyle(el).position === 'sticky')
				.map((el) => el.getBoundingClientRect().top);
			const floor = Math.min(innerHeight, ...held);
			const top = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
			const rows = [...document.querySelectorAll(`main ${box} tbody tr`)].map((row) =>
				row.getBoundingClientRect()
			);
			return {
				seen: rows.filter((r) => r.height > 0 && r.top >= top - 1 && r.bottom <= floor + 1).length,
				roster: rows.length
			};
		},
		mine ? 'table.box.mine' : 'table.box:not(.mine)'
	);
}

/** The Lineup's row height, which every roster row keeps at a desk (Lane 268). */
const ROW_HEIGHT = 52;

/** Text the screen cuts (Lane 268 fix round 1, the box-score rule): an idea card or anything in it, a
 * status chip, a verdict's team name, any drawn element whose words run past its box. */
async function cutText(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[
			...document.querySelectorAll<HTMLElement>(
				'main .idea, main .idea *, main .status-chip, main .bug .name'
			)
		]
			.filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
			.map((el) => el.innerText.trim())
	);
}

/** The status chip's one line (Lane 268 fix round 2): a chip taller than this wrapped inside itself. */
const CHIP_HEIGHT = 20;
/** A phone's tallest roster row: his name, then his club, pill, short status and game, the game on a
 * third short line where the second has no room for it. */
const PHONE_ROW_MAX = 68;

/** The status chips drawn taller than one line. */
async function wrappedChips(page: Page): Promise<string[]> {
	return page.evaluate(
		(height) =>
			[...document.querySelectorAll<HTMLElement>('main table.box .status-chip')]
				.filter((el) => el.offsetParent !== null)
				.filter((el) => Math.round(el.getBoundingClientRect().height) > height)
				.map((el) => el.innerText.trim()),
		CHIP_HEIGHT
	);
}

/** The phone's roster rows taller than PHONE_ROW_MAX. */
async function tallPhoneRows(page: Page): Promise<string[]> {
	return page.evaluate(
		(max) =>
			[...document.querySelectorAll<HTMLElement>('main table.box tbody tr')]
				.filter((row) => row.offsetParent !== null)
				.filter((row) => Math.round(row.getBoundingClientRect().height) > max)
				.map((row) => String(Math.round(row.getBoundingClientRect().height))),
		PHONE_ROW_MAX
	);
}

/** The roster rows at a desk whose height is not the Lineup's. */
async function offHeightRows(page: Page): Promise<string[]> {
	return page.evaluate(
		(height) =>
			[...document.querySelectorAll<HTMLElement>('main table.box tbody tr')]
				.filter((row) => Math.round(row.getBoundingClientRect().height) !== height)
				.map(
					(row) =>
						`${row.querySelector('td.player')?.textContent.trim().split('\n')[0] ?? ''} ${String(Math.round(row.getBoundingClientRect().height))}px`
				),
		ROW_HEIGHT
	);
}

/** The whole page at its height, so the verdict sits in its place rather than over the rows. */
async function shoot(page: Page, name: string, width: number): Promise<void> {
	const height = await page.evaluate(() => document.documentElement.scrollHeight);
	await page.setViewportSize({ width, height });
	await page.screenshot({ path: new URL(name, out).pathname });
	await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const taps: string[] = [];
const counts: string[] = [];
for (const theme of THEMES) {
	for (const width of WIDTHS) {
		const where = `${theme} ${String(width)}`;
		const ctx = await browser.newContext({
			viewport: { width, height: VIEWPORT_HEIGHT },
			colorScheme: theme,
			timezoneId: ZONE,
			permissions: ['clipboard-read', 'clipboard-write']
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
			await page.getByText(ANALYZER_LINES.ideas).first().waitFor({ timeout: READY_TIMEOUT_MS });
		} catch (error: unknown) {
			await page.screenshot({ path: new URL(`not-ready-${where}.png`, out).pathname });
			throw error;
		}
		await page.evaluate(() => document.fonts.ready);
		await page.waitForLoadState('networkidle');

		// As it opens, the rosters take the window: the member's rows counted over the verdict (Lane 268).
		const window = ROW_WINDOWS[width];
		await page.setViewportSize({ width, height: window.height });
		const yours = await rowsInSight(page, true);
		counts.push(
			`${where}: ${String(yours.seen)} of your ${String(yours.roster)} rows in sight at ${String(width)} by ${String(window.height)}`
		);
		check(
			yours.seen >= window.rows,
			`${where}: ${String(yours.seen)} rows in sight, want ${String(window.rows)}`
		);
		// The other side's rows at a desk, where both rosters show: as many as the first side's floor, or
		// its whole roster when it has fewer.
		if (width > STACKS_AT) {
			const theirs = await rowsInSight(page, false);
			counts.push(
				`${where}: ${String(theirs.seen)} of their ${String(theirs.roster)} rows in sight`
			);
			check(
				theirs.seen >= Math.min(window.rows, theirs.roster),
				`${where}: ${String(theirs.seen)} of their ${String(theirs.roster)} rows in sight`
			);
			const off = await offHeightRows(page);
			check(off.length === 0, `${where}: rows off ${String(ROW_HEIGHT)}px: ${off.join(', ')}`);
		}
		const cut = await cutText(page);
		check(cut.length === 0, `${where}: cut text ${cut.join(' | ')}`);
		const wrapped = await wrappedChips(page);
		check(wrapped.length === 0, `${where}: chips on more than one line ${wrapped.join(' | ')}`);
		if (width <= STACKS_AT) {
			const tall = await tallPhoneRows(page);
			check(
				tall.length === 0,
				`${where}: rows over ${String(PHONE_ROW_MAX)}px: ${tall.join(', ')}`
			);
		}
		await page.screenshot({
			path: new URL(`trades-${theme}-${String(width)}-open-window.png`, out).pathname
		});
		await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });

		// As it opens: our ideas by team, the best three and the rest behind "N more", the first's team
		// chosen, nothing ticked; no decision line over the screen (the Best idea is our best trade).
		check(
			(await page.getByText(IDEAS_LABEL, { exact: true }).count()) === 1,
			`${where}: the ideas row is not labelled ${IDEAS_LABEL}`
		);
		check(
			(await page.locator('main [role="status"] .line, main .decision').count()) === 0,
			`${where}: a decision line over the screen`
		);
		const first = await seen(page);
		check(
			first.ideas.length === IDEAS_SHOWN,
			`${where}: ${String(first.ideas.length)} ideas shown`
		);
		const more = (await page.locator('main .ideas .more').innerText()).trim();
		check(/^\d+ more$/.test(more), `${where}: the ideas row's more says "${more}"`);
		check(
			(await page.locator('main .ideas .more').getAttribute('aria-expanded')) === 'false',
			`${where}: N more carries no aria-expanded`
		);
		// By keyboard: Enter shows the rest in place and hands the focus to the first idea it adds.
		await page.locator('main .ideas .more').focus();
		await page.keyboard.press('Enter');
		const focused = await page.evaluate(() => {
			const el = document.activeElement;
			const all = [...document.querySelectorAll('main .idea')];
			return el === null ? -1 : all.indexOf(el);
		});
		check(focused === IDEAS_SHOWN, `${where}: N more left the focus on idea ${String(focused)}`);
		// The Best card stays first and in sight once every idea shows (a phone's row wraps under it).
		const bestInSight = await page.evaluate(() => {
			const best = document.querySelector('main .idea')?.getBoundingClientRect();
			return best !== undefined && best.left >= 0 && best.right <= innerWidth;
		});
		check(bestInSight, `${where}: the Best card is off the row once every idea shows`);
		const shownCut = await cutText(page);
		check(
			shownCut.length === 0,
			`${where}: cut text once every idea shows ${shownCut.join(' | ')}`
		);
		const open = await seen(page);
		check(
			open.ideas.length + open.none.length === IDEAS_SHOWN + Number(more.split(' ')[0]),
			`${where}: ${String(open.ideas.length)} ideas and ${String(open.none.length)} lines after ${more}`
		);
		// A team the finder lists no trade with keeps its place, said (B271).
		check(
			open.none.length > 0 && open.none.every((line) => line === TRADES.noIdea),
			`${where}: the teams with no idea say ${open.none.join(' | ') || 'nothing'}`
		);
		check(open.ideas[0]?.mark.toLowerCase() === STRIP.best.toLowerCase(), `${where}: no Best`);
		check(
			open.ideas.every((i) => IDEA_GAINS.test(i.gains)),
			`${where}: idea gains ${open.ideas.map((i) => i.gains).join(' | ')}`
		);
		check(open.ticked === 0, `${where}: ${String(open.ticked)} ticked on opening`);
		check(open.team.length > 0, `${where}: no team chosen on opening`);
		check(open.basis.includes(KEEP_RULE), `${where}: the footer leaves out the keep rule`);
		const banned = await copyFault(page, OWN_WORDS, 'main');
		check(banned === null, `${where}: says ${banned ?? ''}`);
		await shoot(page, `trades-${theme}-${String(width)}-open.png`, width);

		// The member's own idea: his RB2 for their WR1, a tap each, the verdict with no submit.
		// Where the rosters stack, theirs is a tap on the switch away, never a scroll past his roster.
		const stacked = width <= STACKS_AT;
		const give = await tickAt(page, true, 'RB', 2);
		if (stacked) await page.locator('main .switch button').nth(1).click();
		const get = await tickAt(page, false, 'WR', 1);
		const tapCount = stacked ? 3 : 2;
		await verdict(page);
		const built = await seen(page);
		const builtCut = await cutText(page);
		check(builtCut.length === 0, `${where}: cut text in the verdict ${builtCut.join(' | ')}`);
		check(built.ticked === 2, `${where}: ${String(built.ticked)} ticked after two ticks`);
		check(built.bars.length === 2, `${where}: ${String(built.bars.length)} bars`);
		taps.push(
			`${where}: ${String(tapCount)} taps, ${give} for ${get} with ${open.team}: ${built.line}`
		);
		// The window as the member sees it: at a desk the verdict held at its foot while the rosters
		// scroll, on a phone their roster under the switch with the gains pinned.
		await page.screenshot({
			path: new URL(`trades-${theme}-${String(width)}-built-window.png`, out).pathname
		});
		await shoot(page, `trades-${theme}-${String(width)}-built.png`, width);
		if (stacked) {
			// The ticks hold across the switch: back to yours, his tick is still on.
			await page.locator('main .switch button').nth(0).click();
			const mine = await page
				.locator('main table.box.mine button.tick[aria-pressed="true"]')
				.count();
			check(mine === 1, `${where}: ${String(mine)} of yours ticked after the switch`);
		}

		// Share copies the trade in our words.
		await page.getByRole('button', { name: ANALYZER_LINES.share }).click();
		await page
			.getByText(ANALYZER_LINES.shared)
			.filter({ visible: true })
			.first()
			.waitFor({ timeout: READY_TIMEOUT_MS });
		const copied = await page.evaluate(() => navigator.clipboard.readText());
		check(copied.startsWith('Trade with '), `${where}: shared "${copied}"`);

		// One tap loads an idea: its team chosen, its players ticked, the preset pressed. Its check is
		// held back, so the race (review H1) is seen: while it is read, the last answer (another team's
		// trade) stays drawn and no verb acts on it.
		await holdChecks(page);
		await page.locator('main .idea').nth(LOADED_IDEA).click();
		const racing = await verbs(page);
		check(!racing.propose && !racing.share, `${where}: a verb live while an idea is read`);
		await verdict(page);
		await waitLive(page);
		const loaded = await seen(page);
		check(loaded.ideas[LOADED_IDEA]?.pressed === true, `${where}: the loaded idea not pressed`);
		check(loaded.ticked >= 2, `${where}: ${String(loaded.ticked)} ticked after an idea`);
		await shoot(page, `trades-${theme}-${String(width)}-idea.png`, width);
		// Another tick on the same team while its check is read: the answer is for the idea's trade,
		// the ticks hold one more, so no verb acts until the new answer lands.
		if (stacked) await page.locator('main .switch button').first().click();
		await page
			.locator('main table.box.mine button.tick[aria-pressed="false"]:not([disabled])')
			.first()
			.click();
		const ticking = await verbs(page);
		check(!ticking.propose && !ticking.share, `${where}: a verb live while a tick is read`);
		await page.unroute(CHECK_ROUTE);

		// An idea they would not take (Lane 277): the member builds the finder's dropped idea by tick.
		// The verdict draws each side's rest of season, tags theirs at a desk, leads the line (and the
		// phone's pin) with why they refuse, and leaves the verb live: the member may still propose.
		await page.goto(`${web}/league/${FIXTURE_IDS.league}/trades`, { waitUntil: 'networkidle' });
		await page.getByText(ANALYZER_LINES.ideas).first().waitFor({ timeout: READY_TIMEOUT_MS });
		for (const name of REFUSED.give) await tickNamed(page, true, name);
		if (stacked) await page.locator('main .switch button').nth(1).click();
		for (const name of REFUSED.get) await tickNamed(page, false, name);
		await verdict(page);
		await waitLive(page);
		const refused = await seen(page);
		check(
			refused.line.startsWith(TRADES.theyGiveUp),
			`${where}: the refused idea reads "${refused.line}"`
		);
		if (!stacked) {
			check(
				refused.rest.length === 2 && /^\+\d+\.\d/.test(refused.rest[0] ?? ''),
				`${where}: rest of season cells ${refused.rest.join(' | ')}`
			);
			check(
				/^−\d+\.\d/.test(refused.rest[1] ?? ''),
				`${where}: their rest of season ${refused.rest[1] ?? ''}`
			);
			check(
				(refused.rest[1] ?? '').includes(TRADES.wouldNotTake),
				`${where}: their cell is not tagged ${TRADES.wouldNotTake}`
			);
		} else {
			// The phone draws no cell, as its basis has no room for its sentence; the pin says why.
			check(refused.rest.length === 0, `${where}: a rest-of-season cell on the phone`);
			check(refused.pin.startsWith(TRADES.theyGiveUp), `${where}: the pin reads "${refused.pin}"`);
		}
		const refusedCut = await cutText(page);
		check(
			refusedCut.length === 0,
			`${where}: cut text in the refused verdict ${refusedCut.join(' | ')}`
		);
		if (!stacked)
			check(
				(await page.locator('main [data-basis="builder"]').innerText()).includes(
					'A side takes a trade that costs it'
				),
				`${where}: the builder's line leaves out the rest-of-season rule`
			);
		taps.push(`${where}: refused, ${refused.line} | ${refused.rest.join(' | ')}`);
		await page.screenshot({
			path: new URL(`trades-${theme}-${String(width)}-refused-window.png`, out).pathname
		});
		await shoot(page, `trades-${theme}-${String(width)}-refused.png`, width);
		await ctx.close();
	}
}
await browser.close();
process.stdout.write(`${counts.join('\n')}\n${taps.join('\n')}\n`);
if (failures.length > 0) {
	process.stderr.write(`${failures.join('\n')}\n`);
	process.exit(1);
}
process.stdout.write(`trades shots at ${clock}: ${out.pathname}\n`);
