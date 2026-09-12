import { getDb } from "../src/db/client";
import { DRAFT_ACTION_VERSION } from "../src/domain/draft";
import type { DraftState } from "../src/draft-engine";
import { createDraftStore, type DraftStore } from "../src/draft-service/store";
import { getPublisher } from "../src/lib/realtime/publisher";
import { MOCK_CONFIG, MOCK_COPY } from "../src/mock-draft/config";
import { expect, test } from "./support/fixtures";

/**
 * The production `getDraftStore()` (`@/draft-service`'s own barrel, `index.ts`) is NOT safe to
 * import from `e2e/**`: that barrel also re-exports `resolveDraftActor` from `./authz`, which
 * imports `@/lib/leagues/membership` and, through it, `next/server` — a module Playwright's own
 * Node process (outside Next's bundler) cannot resolve, and importing the barrel loads every one
 * of its re-exports whether or not this caller uses them. This builds the SAME store the barrel's
 * `getDraftStore()` does (`createDraftStore` over the real `getDb()`, publishing through the real
 * shared `getPublisher()`, a plain wall clock) by calling `./store` directly instead — the
 * identical avoid-the-barrel idiom `mobile-360.spec.ts`'s own `mockLifecycleDepsForE2e` uses for
 * the identical hazard one door over (`@/app/api/mock-drafts/_shared.ts`).
 */
let cachedStore: DraftStore | undefined;
function draftStoreForE2e(): DraftStore {
  if (cachedStore === undefined) {
    cachedStore = createDraftStore({ db: getDb(), publish: (input) => getPublisher().publish(input), clock: { now: () => new Date().toISOString() } });
  }
  return cachedStore;
}

/**
 * Task 11: the mock draft journey, end to end on the real stack, plus the share-link beat.
 *
 * NO ORDERING DEPENDENCY on any other spec file (the suite's own convention, `docs/
 * conventions.md:616`, requires this be stated either way): both tests below mint their own
 * mock room live, through the real UI/routes, using the stable `managerA`/`managerB` sessions
 * every other spec already shares — nothing here reads or depends on a database row any other
 * file wrote, and nothing here writes a row any other file's own assertions could see (a mock
 * league is `is_mock`, invisible to every real-league query `enforcement.spec.ts`'s or `mobile-
 * 360.spec.ts`'s own dispute-queue counts read). A leftover room from a failed run needs no
 * manual cleanup either: `MOCK_CONFIG.retention` self-expires it (2 hours unstarted, 24 hours
 * complete) through the running server's own sweep, unlike this suite's other per-spec league
 * fixtures, which live forever until a future run's own `delete-then-recreate` touches them —
 * that idiom is deliberately NOT copied here, since a mock room's whole point is that nothing
 * about it needs to survive.
 */

const TEAM_COUNT = 12;
const BOT_COUNT = TEAM_COUNT - 1;
/**
 * `MOCK_CONFIG.pickClockSecondsOptions`' own WIDEST tier (90s), not its narrowest (30s) —
 * deliberately, even though every one of these three is a "fast clock" next to any real
 * league's own (minutes to hours): `MOCK_CONFIG.botDelay` (under a second) governs how fast BOTS move
 * regardless of which tier a room picks, so 90s costs the bot-driven portions of this journey
 * nothing. What it buys is real reliability for the HUMAN'S own one live click: 30s measured
 * true against a real browser proved fragile in practice (a real run's own autopick fired before
 * this test's click landed, under nothing more than this repo's own background load — Postgres,
 * Redis, the ticker, the browser itself) — the exact class of flake a CI runner is more, not
 * less, exposed to. 90s gives that one click the room it needs without ever slowing the parts of
 * this journey the brief actually means by "fast."
 */
const PICK_SECONDS = 90;

/**
 * The workflow pass (law 1): a setting is changed by tapping its chip and choosing inside the
 * borrowed editor row. Click-and-verify, retried, because the chips are server-rendered before
 * the editors hydrate (the pre-hydration hazard `design-v2.spec.ts` documents); the chosen
 * option closes the row, so the group's own disappearance is the confirmation.
 */
async function setTableChip(page: import("@playwright/test").Page, chip: string, groupLabel: string, optionName: string): Promise<void> {
  await expect(async () => {
    const group = page.getByRole("group", { name: groupLabel });
    if ((await group.count()) === 0) {
      await page.getByTestId(`table-chip-${chip}`).click();
      await expect(group).toBeVisible({ timeout: 2_000 });
    }
    await group.getByRole("button", { name: optionName, exact: true }).click();
    await expect(group).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** The slowest seeded bot delay (`MOCK_CONFIG.botDelay`, base plus jitter) times the widest gap
 *  a solo room's own shuffled draft order (`drawSequenceFor`, `@/draft-service/order.ts` —
 *  seeded from the draft id, never predictable ahead of creation) could ever put between the
 *  host's own seat and pick 1: every other seat is a bot, so the worst case is the host landing
 *  last in the shuffle. Padded well past the arithmetic bound for real scheduler jitter. */
const ON_CLOCK_TIMEOUT_MS = (BOT_COUNT + 2) * (MOCK_CONFIG.botDelay.baseMs + MOCK_CONFIG.botDelay.jitterMs) + 15_000;

/** The exact conflict `DraftStore.applyAction` answers when another actor's action already
 *  advanced the log first (`store.ts`'s own `isSequenceConflict` branch) — never guessed, this
 *  is the literal string the store returns. */
const RETRY_REASON = "Someone else acted first. Try again.";

/** Comfortably longer than the widest real pick clock tier plus the widest pause window this
 *  engine could ever be mid-observing — the identical `TIME_STEP_MS` argument `seedFormatDemos`'s
 *  own `driveToCompletion` makes (`src/data/seed/seed-format-demos.ts`), copied rather than
 *  imported: that constant is module-private there, and this file needs its own for the
 *  identical reason, against a room this suite drives live rather than at seed time. */
const FAR_FUTURE_STEP_MS = 100_000_000;

function laterTimestamp(from: string): string {
  return new Date(Date.parse(from) + FAR_FUTURE_STEP_MS).toISOString();
}

/**
 * Fast-forwards a REAL, store-backed mock draft to completion, through nothing but the real
 * `DraftStore.applyAction` — the identical mechanism `seedFormatDemos`'s own `driveToCompletion`
 * uses to drive a real league's draft in scripted setup, applied here to a room this test drove
 * live through the browser first. A `TIMER_EXPIRE` carrying a constructed far-future timestamp
 * lets the ENGINE's own autopick/skip logic resolve whichever team is on the clock, human or
 * bot — never a hand-picked player this test would have to keep in sync with the pool.
 *
 * Waiting out this same draft in real time would mean roughly `TEAM_COUNT *
 * totalRosterSlots(STANDARD_ROSTER_SLOTS)` (180) picks at the bot delay's own multi-second
 * cadence — tens of minutes, no CI run should pay for a fact this file's `MOCK_CONFIG.botDelay`
 * unit tests already price out. This is the sanctioned shortcut the brief calls for: the human's
 * own pick and the bots picking around it (both asserted live, above, through the real SSE
 * stream) already prove the room drives itself; this harness only proves the room REACHES
 * results, which needs the engine's own completion logic exercised for real, not a database row
 * hand-set to `'complete'`.
 *
 * `draftStoreForE2e()` builds the SAME kind of store the running server's own routes and ticker
 * use (see its own docblock for why this test builds it directly rather than importing the
 * barrel) — its `publish` really reaches the shared Redis this test's own open browser page is
 * subscribed to over SSE, so the board itself keeps folding every one
 * of these picks live (`applyDraftEvent`'s own clock spread updates `view.phase` from each
 * frame's payload, the same mechanism the bot-pick proof above already exercises). `room.mock.
 * results` is a SEPARATE field the snapshot route only computes at request time
 * (`view.phase === "complete" ? mockResultsCopy() : null`, `GET /api/drafts/[draftId]`'s own
 * route) — nothing in `use-draft-room.ts`'s event handler ever refetches the snapshot on a plain
 * phase change (only on mount, an SSE reconnect, or a genuine sequence gap), so this test reads
 * it the same honest way a member returning to an already-finished room would: a fresh load.
 *
 * The running server's own bot driver is STILL ticking this same draft in the background while
 * this loop runs — a real, expected race, not a bug this harness papers over. A conflict
 * (`RETRY_REASON`, the store's own text for "somebody else's action landed first") means the
 * live driver won that particular pick; this refetches the state it left behind and keeps going,
 * the same way any well-behaved caller of a store built for concurrent writers would.
 */
async function fastForwardMockDraft(draftId: string): Promise<void> {
  const store = draftStoreForE2e();
  let state = await store.getDraftState(draftId);
  if (state === null) throw new Error(`[e2e] fastForwardMockDraft: draft ${draftId} does not exist.`);

  while (state.phase !== "complete") {
    const timestamp = laterTimestamp(state.turnStartedAt ?? new Date(0).toISOString());
    const result = await store.applyAction(draftId, { v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp });
    if (result.ok) {
      state = result.state;
      continue;
    }
    if (result.reason !== RETRY_REASON) {
      throw new Error(`[e2e] fastForwardMockDraft: TIMER_EXPIRE rejected against ${draftId}: ${result.reason}`);
    }
    const refetched: DraftState | null = await store.getDraftState(draftId);
    if (refetched === null) throw new Error(`[e2e] fastForwardMockDraft: draft ${draftId} disappeared mid-drive.`);
    state = refetched;
  }
}

const AVAILABLE_PLAYERS_LIST = "Available players, best first";

/**
 * Click-and-verify, retried (the SSR-fake discipline every other spec in this suite keeps) — the
 * identical mechanism `league-lifecycle.spec.ts` already established for this exact button,
 * reused rather than reinvented: the pool is a TRUNCATED top-N window
 * (`DRAFT_ROOM_CONFIG.poolPageSize`, `player-pool.tsx`'s own `truncated` slice), not the whole
 * remaining pool, so its raw row COUNT never shrinks as long as more than that many players are
 * still available — the next-ranked player slides straight into the vacated slot, and a receipt
 * built on a falling total count would wait forever. The real receipt is the TOP ROW'S OWN
 * name+team pair leaving the list; the click targets that SAME row (never `.first()` again,
 * which the pool can reorder out from under a naive retry the moment anything else lands).
 */
async function makeTopPick(page: import("@playwright/test").Page): Promise<void> {
  const pool = page.getByRole("list", { name: AVAILABLE_PLAYERS_LIST });
  await pool.getByRole("button", { name: "Draft" }).first().waitFor({ timeout: 15_000 });
  // `data-testid`, not DOM adjacency. These two facts used to be read as "the name span" and
  // "the span right after it", which was true until the pool row became TWO lines (the headshot
  // and name on one, the team code and the act controls on the next) — after which the name span
  // was the last child of its own div, `following-sibling::span[1]` matched nothing, and this
  // helper hung until the whole test timed out, eight minutes at a time. A row's layout is a
  // design decision that will change again; which span carries the team is not.
  const firstRow = pool.getByRole("listitem").first();
  const pickedName = await firstRow.getByTestId("pool-player-name").innerText();
  const pickedTeam = await firstRow.getByTestId("pool-player-team").innerText();
  const uniqueRow = pool.getByRole("listitem").filter({ hasText: pickedName }).filter({ hasText: pickedTeam });
  // Checks for the row's own departure BEFORE clicking again on each retry: a prior attempt's
  // click can land (the row leaves) even when that SAME attempt's own `toHaveCount(0)` check
  // missed the window, and re-clicking `uniqueRow`'s Draft button once it no longer exists would
  // otherwise hang the whole `toPass` budget waiting for an element that will never reappear.
  await expect(async () => {
    if ((await uniqueRow.count()) > 0) {
      await uniqueRow.getByRole("button", { name: "Draft" }).click({ timeout: 5_000 });
    }
    await expect(uniqueRow).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
}

/** `"Round 2 · Pick 13"` -> `13` — `room-rail.tsx`'s own `turnLabel` format, the one text this
 *  file reads to prove a pick landed without depending on the pool's own truncated count. */
function pickNumberFromTurnLabel(text: string): number {
  const match = /Pick (\d+)/.exec(text);
  if (match === null) throw new Error(`[e2e] could not parse a pick number from turn-label text: "${text}"`);
  return Number(match[1]);
}

/**
 * -------------------------------------------------------------------------------------------
 * Scenario 1: the whole solo journey — front door -> the practice CTA -> setup -> the real
 * room -> a real human pick -> bots picking around it, proven live over SSE -> results ->
 * "Run it again" honoring its own contract.
 *
 * `TEAM_COUNT` is 12 deliberately (the widest `MOCK_CONFIG.teamCountOptions` offers): eleven
 * bots is what makes the room's own `practice opponent` marker count a real, countable fact
 * rather than an incidental one or two.
 * -------------------------------------------------------------------------------------------
 */
test("front door -> mock draft lobby -> a solo mock -> a real pick -> bots pick around it -> results -> run it again", async ({ managerA }) => {
  test.setTimeout(480_000);

  // --- Front door -> the practice CTA -------------------------------------------------------
  await managerA.goto("/");
  // The front-door rebuild's hero (2026-09-02): "There is always a seat." replaced the old
  // "Real leagues. Real seats. Drafting this week." — reconciled by the 2026-09-04 link audit.
  await expect(managerA.getByRole("heading", { name: "There is always a seat." })).toBeVisible();
  await managerA.getByRole("link", { name: "Try a mock draft" }).click();
  await expect(managerA).toHaveURL(/\/app\/mock-drafts$/);
  await expect(managerA.getByRole("heading", { name: "Mock drafts", level: 1 })).toBeVisible();

  // --- Setup (the workflow pass, law 1): the chip sentence edited in place — the widest room,
  // a fast clock (see `PICK_SECONDS`'s own docblock for why this is the 90s tier, not the 30s
  // one). Each chip open is click-and-verify, retried: chips are server-rendered before the
  // editors hydrate, the identical pre-hydration hazard `design-v2.spec.ts` documents.
  await setTableChip(managerA, "teams", "Teams", String(TEAM_COUNT));
  await setTableChip(managerA, "clock", "Pick clock", `${PICK_SECONDS}s`);
  // Founder directive 2026-08-26: "users should be able to select their draft position." The
  // LAST slot is the one choice `assignDraftSlots` (`@/draft-service/order`) honors under EVERY
  // possible shuffle (see `creation.test.ts`'s own note on this) — the one deterministic pick
  // available to a real-UUID room this spec cannot seed. Choosing it here also means the host
  // now ALWAYS lands in the exact worst case `ON_CLOCK_TIMEOUT_MS` was already sized for (the
  // host drafting last), so this changes nothing about that bound's own margin.
  await setTableChip(managerA, "seat", "Your seat", String(TEAM_COUNT));
  await expect(async () => {
    await managerA.getByRole("button", { name: "Start mock draft" }).click();
    await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  const draftId = new URL(managerA.url()).pathname.split("/").pop()!;

  // --- Land in the real room: the practice banner and every bot's own marker ---------------
  const gotIt = managerA.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();
  await expect(managerA.getByTestId("practice-banner")).toHaveText(MOCK_COPY.practiceBanner);
  // The visible "Bot" badge carries this accessible label alongside it, once per bot seat
  // (`DraftBoard`'s own column-header marker, `MOCK_COPY.botMarkerLabel`) — eleven for a
  // twelve-team solo room, never "AI opponent" anywhere on this surface. Scoped to the board's
  // own grid (`data-testid="draft-board-grid"`, the desktop-width column-header table) rather
  // than the whole page, so this can never accidentally count a second, unrelated mention.
  await expect(managerA.getByTestId("draft-board-grid").getByText(MOCK_COPY.botMarkerLabel)).toHaveCount(BOT_COUNT);
  // The chosen seat landed exactly where picked: the host's own column ("You", `draft-board.tsx`'s
  // own marker) carries the sr-only "Draft slot 12" label — the last column, matching the LAST
  // slot selected above.
  await expect(managerA.getByTestId("draft-board-grid").locator("th").filter({ hasText: "You" })).toContainText(`Draft slot ${TEAM_COUNT}:`);

  // --- Wait for the human's own turn — the shuffled draft order (`drawSequenceFor`) makes no
  // promise about WHERE the host lands, so this bound covers every seat, not just pick 1. Any
  // pick a bot makes before this resolves is ALREADY a bot pick arriving without user action,
  // over the room's real SSE stream — this assertion is what proves the room got there at all.
  // Scoped to `room-rail` (`data-testid="room-rail"`, `room-rail.tsx`'s own masthead): a slow
  // human turn also earns the moderator's own nudge banner ("Commish Lab, you're on the clock
  // with about N seconds left..."), which repeats the identical phrase in a SIBLING `role=
  // "status"` toast — an unscoped locator resolves both once that banner appears.
  await expect(managerA.getByTestId("room-rail").getByText("You are on the clock")).toBeVisible({ timeout: ON_CLOCK_TIMEOUT_MS });

  // --- The room viewport is owned once (founder screenshot, 2026-08-26): with the practice
  // banner mounted, the PAGE itself never scrolls at desktop — a band above the old h-dvh
  // frame scrolled the whole room by exactly its own height ("the weird scroll border").
  const pageScroll = await managerA.evaluate(() => ({
    w: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    h: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
  }));
  expect(pageScroll.h[0], "the mock room's page scrolls vertically at desktop").toBeLessThanOrEqual(pageScroll.h[1]! + 1);
  expect(pageScroll.w[0], "the mock room's page scrolls sideways at desktop").toBeLessThanOrEqual(pageScroll.w[1]! + 1);

  // --- Laptop fit (founder question, 2026-08-26): at 1280x800 — the smallest common laptop —
  // the page still never scrolls, and the stage shows at least FOUR full board columns (two
  // fixed rails once squeezed it to ~three; the lg rail step and the xl-only sticker faces are
  // what this asserts against regression).
  await managerA.setViewportSize({ width: 1280, height: 800 });
  await managerA.waitForTimeout(400);
  const laptop = await managerA.evaluate(() => {
    const grid = document.querySelector('[data-testid="draft-board-grid"]');
    // Measured AT REST: the auto-scroll centers the current pick, leaving both edge columns
    // legitimately partial — the question here is what the composition AFFORDS a laptop, so
    // count from the board's origin.
    grid!.scrollLeft = 0;
    const gridBox = grid!.getBoundingClientRect();
    const headers = Array.from(grid!.querySelectorAll("thead th")).slice(1);
    const fullyVisible = headers.filter((th) => {
      const r = th.getBoundingClientRect();
      return r.left >= gridBox.left - 1 && r.right <= gridBox.right + 1;
    }).length;
    return {
      fullyVisible,
      pageScrollH: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
      pageScrollW: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    };
  });
  expect(laptop.pageScrollH[0], "the room's page scrolls vertically at 1280x800").toBeLessThanOrEqual(laptop.pageScrollH[1]! + 1);
  expect(laptop.pageScrollW[0], "the room's page scrolls sideways at 1280x800").toBeLessThanOrEqual(laptop.pageScrollW[1]! + 1);
  expect(laptop.fullyVisible, "a 1280px laptop sees too few board columns").toBeGreaterThanOrEqual(4);
  await managerA.setViewportSize({ width: 1280, height: 720 });
  await managerA.waitForTimeout(300);
  const short = await managerA.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.clientHeight]);
  expect(short[0], "the room's page scrolls vertically at 1280x720").toBeLessThanOrEqual(short[1]! + 1);

  // --- The human's own real pick — with the board's pick number captured FIRST, so the
  // post-sim assertion below measures movement against the state the human acted from ---------
  const pickNumberBeforeOurTurn = pickNumberFromTurnLabel(await managerA.getByTestId("turn-label").innerText());
  await makeTopPick(managerA);

  // --- Bots pick around it at a lifelike pace (founder report 2026-09-08): each bot's pick
  // lands `MOCK_CONFIG.botDelay` (450 to 950 ms) after the previous one, driven by the room's
  // own SSE advance loop, so the receipt of "the bots picked around me" is the human being back
  // ON the clock with the board's own pick number already advanced past their own pick. A
  // 12-team snake's last seat picks twice in a row, so "back on the clock" covers every seat;
  // the pick number strictly exceeding the human's own pick is what proves other seats (or the
  // wrap's own second turn) genuinely moved without one further action from this page.
  await expect(managerA.getByTestId("room-rail").getByText("You are on the clock")).toBeVisible({ timeout: ON_CLOCK_TIMEOUT_MS });
  await expect
    .poll(async () => pickNumberFromTurnLabel(await managerA.getByTestId("turn-label").innerText()), { timeout: ON_CLOCK_TIMEOUT_MS })
    .toBeGreaterThan(pickNumberBeforeOurTurn);

  // --- Fast-forward the remaining board server-side (the sanctioned shortcut — see the
  // function's own docblock), then reload to read the results the same honest way a returning
  // member would (see the docblock above for why this is a reload, not a live SSE wait) --------
  await fastForwardMockDraft(draftId);
  await expect(async () => {
    await managerA.reload();
    await expect(managerA.getByRole("heading", { name: MOCK_COPY.resultsHeading, level: 1 })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
  // E3 (results review): the panel restates NO retention — the practice banner above it owns
  // the one clearing fact per view.
  await expect(managerA.getByText(MOCK_COPY.resultsRetentionSentence)).toHaveCount(0);
  // The debrief's team card replaced the roster list (the workflow pass, law 4).
  await expect(managerA.getByText(MOCK_COPY.resultsTeamHeading)).toBeVisible();
  // At least the one pick this test's own human made lands in the verdict lane — a fact of this
  // draft's own log, not a live ranking (`MockResults`'s own docblock).
  await expect(managerA.getByRole("list", { name: "Your picks" }).getByRole("listitem")).not.toHaveCount(0);

  // --- RUN IT BACK, SAME TABLE honors its own contract: a NEW solo room, not this one reopened.
  // `waitForURL` with a predicate, not a bare `toHaveURL(/\/app\/drafts\//)`: this page was
  // ALREADY on such a URL before the click (the reload above never left it), so a pattern-only
  // wait would pass the instant it started polling, proving nothing about whether the click's
  // own POST-and-navigate ever actually landed anywhere.
  await managerA.getByRole("button", { name: MOCK_COPY.resultsRunBackVerb }).click();
  await managerA.waitForURL((url) => url.pathname !== `/app/drafts/${draftId}`, { timeout: 20_000 });
  await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 20_000 });
  const secondDraftId = new URL(managerA.url()).pathname.split("/").pop()!;
  expect(secondDraftId).not.toBe(draftId);
  await expect(managerA.getByTestId("practice-banner")).toHaveText(MOCK_COPY.practiceBanner);
  await expect(managerA.getByTestId("turn-label")).toBeVisible();
});

/**
 * -------------------------------------------------------------------------------------------
 * Scenario 2: the share-link beat. `managerB` creates a `link`-mode room; `managerA`, a second
 * seeded identity in a wholly separate browser context, visits the landing URL signed in,
 * claims a seat, and `managerB`'s own room, reloaded, shows the seat count moved.
 *
 * Deliberately never waits for the room to START: the claim itself, and the count it moves, are
 * the whole beat here. `MOCK_CONFIG.fillWindowSeconds` (180) is not something this test should
 * ever have to wait out.
 *
 * The seat count is read fresh (a reload), not awaited live over SSE: `claimMockSeatInTx`
 * (`@/mock-draft-service/claim.ts`) writes the new `teams` row and publishes NOTHING — a claim
 * is not a draft action, so it never rides the draft's own event stream `ShareLinkPanel`'s host
 * page is subscribed to, and no gap-then-refetch this room's own hook keeps ever fires for it
 * (`use-draft-room.ts`'s own docblock: refetch on mount, on an SSE reconnect, or on a genuine
 * event gap — never on a timer, never on an unrelated write). Reloading is the honest way to
 * observe a fact this surface only ever reads at request time, the identical "request-time
 * truth" rule the mock lobby listing itself keeps (ruling 10).
 * -------------------------------------------------------------------------------------------
 */
test("a link room's share code, claimed by a second seeded identity, moves the seat count live", async ({ managerA, managerB }) => {
  const teamCount = 8;

  // --- managerB hosts a private link room -----------------------------------------------------
  await managerB.goto("/app/draft/mock-drafts");
  await expect(managerB.getByRole("heading", { name: "Mock drafts", level: 1 })).toBeVisible();
  // Law 2: people are a door — the crew room is minted from the same chip sentence.
  await setTableChip(managerB, "teams", "Teams", String(teamCount));
  await expect(async () => {
    await managerB.getByRole("button", { name: "Mint a link" }).click();
    await expect(managerB).toHaveURL(/\/app\/drafts\//, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });

  const gotIt = managerB.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();

  const sharePanel = managerB.getByTestId("share-link-panel");
  await expect(sharePanel).toBeVisible();
  // ABSOLUTE now (link audit 2026-09-04, the C-01 idiom the invite panel already keeps): the
  // panel shows a URL a member can paste anywhere, and `managerA.goto` below follows it exactly
  // as a recipient would.
  const shareUrl = await managerB.getByLabel("Share link").inputValue();
  expect(shareUrl).toMatch(/^https?:\/\/[^/]+\/app\/mock-drafts\//);
  // THE QUILT (2026-09-02) retired the scheduled rail from this room — R2's two-views-of-one
  // window (the rail's `kickoff-countdown` beside the panel's) is one view now: the fill
  // window's clock lives on `ShareLinkPanel` itself. Reconciled by the 2026-09-04 link audit.
  await expect(managerB.getByTestId("share-link-countdown")).toBeVisible();
  await expect(managerB.getByText(`1 of ${teamCount} seated`)).toBeVisible();

  // --- managerA, a second seeded identity in a wholly separate browser context, arrives signed
  // in at the exact share link and claims a seat ---------------------------------------------
  await managerA.goto(shareUrl);
  await expect(managerA.getByRole("heading", { name: "You are invited to a mock draft" })).toBeVisible();
  await expect(managerA.getByText(`${teamCount} teams`)).toBeVisible();
  await managerA.getByRole("button", { name: "Join this mock draft" }).click();
  await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 20_000 });
  const claimedDraftId = new URL(managerA.url()).pathname.split("/").pop()!;
  const hostDraftId = new URL(managerB.url()).pathname.split("/").pop()!;
  expect(claimedDraftId).toBe(hostDraftId);

  // --- The host reloads their own room and sees the count move (see the docblock above for
  // why this is a reload rather than a live SSE wait) -----------------------------------------
  await expect(async () => {
    await managerB.reload();
    await expect(managerB.getByText(`2 of ${teamCount} seated`)).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 15_000 });
});
