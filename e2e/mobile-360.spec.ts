import type { Clock } from "../src/domain/timing";
import { createDraftStore, type DraftStore } from "../src/draft-service/store";
import { getPublisher } from "../src/lib/realtime/publisher";
import { DEV_SEED } from "../src/data/seed/config";
import { createDb, getDb } from "../src/db/client";
import type { MockLifecycleDeps } from "../src/mock-draft-service/claim";
import { createMockRoom } from "../src/mock-draft-service/creation";
import { ensureOpenHoldLeague, ensureRoomJourneyLeague, expect, managerAUserId, SEEDED_SEASON_LEAGUE_ID, startDraftAndEnterRoom, test } from "./support/fixtures";
import { E2E_HELD_TRADE_LEAGUE_ID, MANAGER_A_STATE, SEEDED_SEASON_CURRENT_WEEK } from "./global-setup";

/**
 * The production `mockLifecycleDeps()` (`@/app/api/mock-drafts/_shared.ts`) is NOT safe to
 * import from `e2e/**`: that file also exports the route's rate-limit helpers, which pull in
 * `@/lib/api/respond` and, through it, `next/server` — a module Playwright's own Node process
 * (outside Next's bundler) cannot resolve, and a whole-file import loads every top-level import
 * whether or not this caller uses it. `getDraftStore()` (`@/draft-service`'s own barrel) carries
 * the identical hazard one door over — it re-exports `resolveDraftActor` from `./authz`, which
 * imports `@/lib/leagues/membership` and, through it, `next/server` too — so this builds the
 * store directly from `./store` instead, the same avoid-the-barrel idiom `mock-draft.spec.ts`'s
 * own `draftStoreForE2e` uses for the identical reason. This is the identical five collaborators
 * `_shared.ts`'s own builder assembles (the real store, the wall clock, `crypto.randomUUID` ids,
 * and two `crypto`-derived draws), copied rather than imported for that one reason —
 * `global-setup.ts`'s own `cryptoRandom` already sets this precedent for the identical hazard.
 */
let cachedStore: DraftStore | undefined;
function mockLifecycleDepsForE2e(): MockLifecycleDeps {
  if (cachedStore === undefined) {
    cachedStore = createDraftStore({ db: getDb(), publish: (input) => getPublisher().publish(input), clock: { now: () => new Date().toISOString() } });
  }
  const clock: Clock = { now: () => new Date().toISOString() };
  const cryptoFloat = (): number => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! / 2 ** 32;
  };
  const cryptoSeed32 = (): number => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! | 0;
  };
  return { store: cachedStore, clock, newId: () => crypto.randomUUID(), newSeed: cryptoSeed32, random: cryptoFloat };
}

// Phase 3.6, Task 13, Step 1: the v2 surface set adds a hold interstitial (anonymous), a waiting
// room and a draft room — none of which this spec's pre-existing fixtures reach. Both new
// leagues are dedicated to THIS file (see `support/fixtures.ts`'s own docblock on why they are
// not shared with `enforcement.spec.ts`'s `E2E_DRAFT_SCHEDULE_LEAGUE_ID`), wiped and rebuilt
// every run, the same reason every other per-spec fixture league in this suite is.
const E2E_MOBILE360_HOLD_LEAGUE_ID = "e2e_mobile360_hold_league";
const E2E_MOBILE360_HOLD_COMMISH_ID = "e2e_mobile360_hold_commish";
const E2E_MOBILE360_ROOM_LEAGUE_ID = "e2e_mobile360_room_league";
const E2E_MOBILE360_ROOM_DRAFT_ID = "e2e_mobile360_room_draft";
const E2E_MOBILE360_ROOM_TEAM_A_ID = "e2e_mobile360_room_team_a";
const E2E_MOBILE360_ROOM_TEAM_B_ID = "e2e_mobile360_room_team_b";

/**
 * Phase 4.5, Task 11's own two surfaces: the practice draft's share landing (a `link`-mode room,
 * never started) and the room's own mock dressing (a `solo`-mode room, in progress the instant
 * `createMockRoom` returns). Set by `beforeAll`, read by the main test below.
 *
 * Minted fresh through the REAL `createMockRoom` writer every run — never a `delete-then-
 * recreate` against a fixed id the way `E2E_MOBILE360_HOLD_LEAGUE_ID`/`E2E_MOBILE360_ROOM_
 * LEAGUE_ID` above are. A mock room needs no such care: it is `is_mock`, invisible to every
 * real-league query this spec's OWN dispute-queue count below reads, and it self-expires through
 * the running server's own retention sweep (`MOCK_CONFIG.retention`) whether or not this run
 * ever gets to it — the identical accepted deviation `mock-draft.spec.ts`'s own docblock states
 * for its two journeys.
 */
let mobile360LinkRoomPath = "";
let mobile360SoloDraftId = "";

test.beforeAll(async () => {
  const db = createDb();
  try {
    await ensureOpenHoldLeague(db, { leagueId: E2E_MOBILE360_HOLD_LEAGUE_ID, commishId: E2E_MOBILE360_HOLD_COMMISH_ID, name: "Mobile360 Hold League" });
    await ensureRoomJourneyLeague(db, {
      leagueId: E2E_MOBILE360_ROOM_LEAGUE_ID,
      draftId: E2E_MOBILE360_ROOM_DRAFT_ID,
      teamAId: E2E_MOBILE360_ROOM_TEAM_A_ID,
      teamBId: E2E_MOBILE360_ROOM_TEAM_B_ID,
      name: "Mobile360 Room League",
    });

    const hostUserId = await managerAUserId(db);
    const deps = mockLifecycleDepsForE2e();
    const linkRoom = await createMockRoom(db, { hostUserId, mode: "link", teamCount: 8, pickSeconds: 60, scoringPreset: "half_ppr", rosterShape: "standard" }, deps);
    if (!linkRoom.ok) throw new Error(`[e2e] mobile-360: could not create the link-mode fixture room: ${linkRoom.reason}`);
    mobile360LinkRoomPath = `/app/mock-drafts/${linkRoom.shareCode}`;

    const soloRoom = await createMockRoom(db, { hostUserId, mode: "solo", teamCount: 8, pickSeconds: 60, scoringPreset: "half_ppr", rosterShape: "standard" }, deps);
    if (!soloRoom.ok) throw new Error(`[e2e] mobile-360: could not create the solo-mode fixture room: ${soloRoom.reason}`);
    mobile360SoloDraftId = soloRoom.draftId;
  } finally {
    await db.$client.end();
  }
});

/**
 * The 360px baseline, which nothing in this suite had ever rendered at.
 *
 * Three separate persona panels each logged a narrow-viewport item as UNVERIFIED-VISUAL backlog
 * (Task 3's standings cell, Task 5's disclosure scroll, Task 10's picker grid). `playwright.
 * config.ts` runs one project, Desktop Chrome, so in aggregate no Plan C surface had any
 * narrow-viewport verification at all. Three panels deferring the same check is not three LOWs;
 * it is one missing check, and this is it.
 *
 * ONE context, serial navigations, no realtime and no second manager: this is a smoke spec, not
 * a second copy of the lifecycle spec. What it proves is that each surface fits — the page body
 * never scrolls sideways — and that the control a manager needs on each one is actually on
 * screen rather than pushed off the edge.
 *
 * Phase 3 Plan D, Task 10 adds the two newest long-sentence-in-a-bordered-panel surfaces: the
 * held-trade banner (`HeldTradeBanner`) and the tier-blocked join refusal — both flagged by name
 * in that task's own brief as the surfaces most likely to overflow at this width.
 */
const VIEWPORT = { width: 360, height: 740 };

/**
 * The failure this spec exists to catch. A page that overflows horizontally at 360px is a page a
 * phone user has to pan around; `scrollWidth` is measured against the layout viewport rather than
 * `VIEWPORT.width` directly so a scrollbar or a device-pixel rounding difference cannot make this
 * flake. Wide content is allowed to scroll INSIDE its own container — that does not move the
 * document.
 */
async function expectNoHorizontalScroll(page: import("@playwright/test").Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(overflow.scrollWidth, `${where} scrolls sideways at ${VIEWPORT.width}px`).toBeLessThanOrEqual(overflow.clientWidth);
}

test("every Plan C surface fits a 360px phone, with its controls reachable", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MANAGER_A_STATE, viewport: VIEWPORT });
  const page = await context.newPage();

  try {
    // --- Phase 3.6, Task 13: the front door, the v2 set's first surface --------------------
    // The headline/`ProofStrip`/shelf never branch on session (Phase 4.5, Task 9's own
    // `PracticeEntryLink` is the one exception, and it changes only an href, never the layout
    // this spec checks), so this reuses the one signed-in context the rest of the spec already
    // holds rather than opening a second one just for this page.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Real leagues. Real seats. Drafting this week." })).toBeVisible();
    await expectNoHorizontalScroll(page, "the front door");

    // --- Create the league whose NAME is the test input -------------------------------------
    // The defect this spec caught was a grid item's min-content width pushing its track wider
    // than the container, and only a long unbroken name does that. So the league is created
    // FIRST and every card assertion below runs with it present: asserting `/app` fits before
    // anything long exists on it would pass on a fresh database while proving nothing. Public,
    // so `/browse`'s grid — the other half of the same fix — carries the same long name.
    // One long UNBROKEN token, which is the exact min-content stressor the fix is about — and
    // deliberately not containing the words "League name", which would collide with the create
    // form's own field label through a card's "Invite managers for <name>" accessible name.
    // Deterministic, not per-run: a fresh league every run would accumulate one public row per
    // run until the newest sorts off /browse's 48-cap page and this spec reddens for an
    // unrelated reason (the same self-inflicted-flake class the lifecycle spec already cost an
    // investigation). Reuse-if-exists, the stable-identity pattern global-setup established.
    const leagueName = "Mobile360UnbrokenOverlongIdentifierFixture";
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
    // Scoped to `main` (Task 2's shell): the league rail's own crest now ALSO carries the
    // league's real name as its accessible name (Step 1's own requirement — the crest names
    // the league, never its initials), so the bare `getByRole` below would match both it and
    // the home board's card link. `main` is the content column the shell renders `HomeBoard`
    // into; the rail is a sibling `<nav>`, never inside it.
    const existing = page.locator("main").getByRole("link", { name: leagueName, exact: true });
    if ((await existing.count()) === 0) {
      await page.getByText("Start or join another league").click();
      await page.getByLabel("League name", { exact: true }).fill(leagueName);
      await page.getByText(/Advanced settings/).click();
      await page.getByLabel("Who can join").selectOption("public");
      // OPEN TO EVERYONE, NAMED RATHER THAN INHERITED (final review round 2, R1). Manager A is
      // the platform's own real veteran — `enforcement.spec.ts` requires exactly that, and it is
      // the point of that file's arc — so a PUBLIC league declared for beginners is the one thing
      // the creation gate refuses this account (`tierJoinPrecondition`, ruling 6). Before the
      // designation control shipped, this form sent no tier at all and the route defaulted to the
      // creator's own self-reported `beginner`, so this step was refused on any correctly seeded
      // database and this whole spec could not run. The choice is made explicitly here rather than
      // left to the control's default, so the spec states its own requirement.
      // "Who it is for": the gauntlet fix wave's contraction sweep renamed this label from
      // "Who it's for"; this line only runs on a fresh database (the league-exists branch above
      // skips it on the shared dev DB), which is why the stale label survived that wave's own
      // green run. Assertion updated to the shipped copy, not loosened.
      await page.getByLabel("Who it is for").selectOption("experienced");
      await page.getByRole("button", { name: "Create league" }).click();
    } else {
      await existing.click();
    }

    // --- A league home: terms panel and members panel, the two Task 3/8 surfaces ----------
    await expect(page.getByRole("heading", { name: leagueName })).toBeVisible();
    // e2e checkpoint (P9-P11): `exact: true` — Task 9 gave `RoomRoster` its own seated-managers
    // list, `aria-label="Seated managers"`, which is a substring superset of the members panel's
    // `aria-label="Managers"` this assertion means to check; `exact` disambiguates the two.
    await expect(page.getByRole("list", { name: "Managers", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "a league home");

    // --- Task 10: the league activity page, whose one seeded row (the league's own creation)
    // carries the long unbroken name this spec exists to stress the headline wrap with -------
    const leagueId = new URL(page.url()).pathname.split("/").pop()!;
    await page.goto(`/app/leagues/${leagueId}/activity`);
    await expect(page.getByRole("heading", { name: "League activity" })).toBeVisible();
    await expectNoHorizontalScroll(page, "the league activity page");

    // --- Task 10: the header's notice inbox, full-width at 360px rather than a floating card
    // the viewport would clip -------------------------------------------------------------
    // Click-and-verify, retried: a server-rendered trigger is visible and "stable" before React
    // attaches its click handler (the same pre-hydration hazard `league-lifecycle.spec.ts`
    // documents for the draft room's Draft button), so a click that lands too early is a silent
    // no-op. Retrying the click until the panel actually opens proves the click was real.
    await expect(async () => {
      await page.getByRole("button", { name: /^Notices/ }).click();
      await expect(page.getByRole("region", { name: "Notices" })).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 15_000 });
    await expectNoHorizontalScroll(page, "the league activity page with the notice inbox open");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Notices" })).toBeHidden();

    // Back to the league home — every step below assumes it, and this page detoured to the
    // activity page and back rather than staying on it throughout.
    await page.goto(`/app/leagues/${leagueId}`);
    await expect(page.getByRole("heading", { name: leagueName })).toBeVisible();

    // --- The invite preview, the surface an invitee actually lands on ---------------------
    await page.getByRole("button", { name: "Create invite link" }).click();
    const invitePath = await page.getByLabel("Invite link").inputValue();
    await expectNoHorizontalScroll(page, "a league home with the invite panel open");

    await page.goto(invitePath);
    await expect(page.getByRole("heading", { name: leagueName })).toBeVisible();
    // The decision this page exists for has to be on screen, not off the right edge.
    await expect(page.getByRole("button", { name: `Join ${leagueName}` })).toBeVisible();
    await expectNoHorizontalScroll(page, "the invite preview");

    // --- The home board, NOW carrying that name in its card grid ---------------------------
    await page.goto("/app");
    // `exact`: the card's action link is named "Invite managers for <league name>", which the
    // default substring match also picks up. Scoped to `main`, same reason as above: the rail's
    // own crest for this league carries the identical accessible name.
    await expect(page.locator("main").getByRole("link", { name: leagueName, exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "/app");

    // --- The public browse grid, the second consumer of the same `min-w-0` fix -------------
    await page.goto("/browse");
    await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();
    await expect(page.getByRole("heading", { name: leagueName })).toBeVisible();
    await expectNoHorizontalScroll(page, "/browse");

    // --- The public review feed -----------------------------------------------------------
    await page.goto("/reviews");
    await expect(page.getByRole("heading", { name: "What managers are saying" })).toBeVisible();
    await expectNoHorizontalScroll(page, "/reviews");

    // --- Phase 3.6 addendum (Task 22): the whole-site surfaces join the existing loop, with
    // this spec's own standing assertion unchanged — no horizontal overflow, the control the
    // page exists for on screen. The four trust pages are measured-paragraph reading pages;
    // the two edges (`/sign-in/problem`, the 404) are the addendum's own error chrome. All are
    // public geometry and render fine under this spec's signed-in context. ------------------
    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Support", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "/support");

    await page.goto("/league-rules");
    await expect(page.getByRole("heading", { name: "How it works", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "/league-rules");

    await page.goto("/legal/terms");
    await expect(page.getByRole("heading", { name: "Terms", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "/legal/terms");

    await page.goto("/legal/privacy");
    await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "/legal/privacy");

    await page.goto("/sign-in/problem");
    await expect(page.getByRole("heading", { name: "Sign-in did not go through" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
    await expectNoHorizontalScroll(page, "/sign-in/problem");

    await page.goto("/definitely-not-a-page");
    await expect(page.getByRole("heading", { name: "We could not find that page." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse open leagues" })).toBeVisible();
    await expectNoHorizontalScroll(page, "the 404 page");

    // --- The profile: name, avatar tiles, help level, review composer ----------------------
    await page.goto("/app/profile");
    await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Avatar" })).toBeVisible();
    await expect(page.getByLabel("How much help")).toBeVisible();
    // `exact`: the review composer below this form has its own "Save changes" button, and
    // manager A has already left a review by the time the onboarding spec has run once.
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "/app/profile");

    // --- Task 9: the trades page, one of Plan C's own real-money surfaces -------------------
    // Manager A already has a team in the seeded season league (`global-setup.ts`'s own claim),
    // so this reuses that league rather than minting a third — the trades page fits at 360px
    // whichever league it renders for, and this is the one already on hand.
    await page.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}/trades`);
    // `exact`: the empty state's own `h2` "No trades yet." substring-matches a bare "Trades",
    // and the page `h1` is the heading this walk has always meant — the same `exact` precedent
    // the "Save" button above and the 3.6 waiting-room heading below already set.
    await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "the trades page");

    // --- Phase 3.6, Task 13: league home (post-draft, standings included) and standings -----
    // The seeded season league is already fully drafted and played (`global-setup.ts`), so its
    // own `/app/leagues/[leagueId]` renders the real `LeagueHome` — `StandingsTable` and all —
    // rather than `WaitingRoom`. Standings has no route of its own (it renders inline on this
    // same page, `league-home.tsx`'s own `<StandingsTable>`), so this reuses the one navigation
    // for both surfaces rather than a second, identical page load.
    await page.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expectNoHorizontalScroll(page, "league home (standings included)");

    // --- Phase 3.6, Task 13: a matchup week ------------------------------------------------
    await page.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}/matchups/${SEEDED_SEASON_CURRENT_WEEK}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page, "a matchup week");

    // --- Phase 3.6, Task 13: the hold interstitial, signed OUT — a second, short-lived context,
    // since the rest of this spec's own `page` carries a real session and this page renders
    // completely differently for one (`src/app/join/[leagueId]/hold/page.tsx`'s own docblock).
    const anonContext = await browser.newContext({ viewport: VIEWPORT });
    try {
      const anonPage = await anonContext.newPage();
      await anonPage.goto(`/join/${E2E_MOBILE360_HOLD_LEAGUE_ID}/hold`);
      await expect(anonPage.getByRole("heading", { name: "Mobile360 Hold League" })).toBeVisible();
      // `SeatHoldPanel` claims the hold on mount — the countdown is the receipt.
      await expect(anonPage.getByTestId("seat-hold-countdown")).toBeVisible();
      await expect(anonPage.getByRole("link", { name: /^Sign in to finish joining/ })).toBeVisible();
      await expectNoHorizontalScroll(anonPage, "the hold interstitial");
    } finally {
      await anonContext.close();
    }

    // --- Phase 3.6, Task 13: the waiting room, then the draft room -------------------------
    // A dedicated two-team league (`support/fixtures.ts`), manager A already seated, draft
    // scheduled and not yet started: `/app/leagues/[leagueId]` renders `WaitingRoom` for exactly
    // that state.
    await page.goto(`/app/leagues/${E2E_MOBILE360_ROOM_LEAGUE_ID}`);
    await expect(page.getByRole("heading", { name: "Mobile360 Room League", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start the draft" })).toBeVisible();
    await expectNoHorizontalScroll(page, "the waiting room");

    await startDraftAndEnterRoom(page, E2E_MOBILE360_ROOM_LEAGUE_ID);
    await expect(page.getByLabel("Player pool")).toBeVisible();
    await expectNoHorizontalScroll(page, "the draft room");

    // --- D1 (2026-08-26 design review): the phantom sideways pan. The defect only reproduces
    // once the dock's queue rail holds a chip — the first chip's box leaked past the queue
    // list's `overflow-x-auto` clip into the page's own scrollable overflow (scrollWidth 546
    // vs 360). So this check queues a real player FIRST and then asserts the page still does
    // not pan: the exact state the review pinned, against the real engine. -------------------
    await page.getByRole("button", { name: /^Queue / }).first().click();
    await expect(page.getByRole("list", { name: "Your queue" })).toBeVisible();
    await expectNoHorizontalScroll(page, "the mid-draft room with a queued chip");

    // --- Phase 3 Plan D, Task 10: the held-trade banner — a long sentence inside a bordered
    // panel, and one of the two new surfaces this task adds to this spec's own 360px walk.
    // `e2e/enforcement.spec.ts` sorts alphabetically before this file and already held a real
    // trade between manager A and manager B here (`e2e_held_trade_league`) — reused, never
    // re-proposed: a second identical offer between the same two teams is exactly the
    // accumulation the reuse-if-exists discipline exists to avoid, and this section only READS
    // what that spec already made real. -------------------------------------------------------
    await page.goto(`/app/leagues/${E2E_HELD_TRADE_LEAGUE_ID}/trades`);
    // `exact`: same reason as the seeded season league's trades visit above.
    await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeVisible();
    await expect(page.getByText("Your trade is waiting on a fairness review").first()).toBeVisible();
    await expectNoHorizontalScroll(page, "the trades page with a held trade's own banner");

    // --- Phase 3 Plan D, Task 10: the blocked-join refusal — the other long sentence inside a
    // bordered panel this task adds. Manager A is the platform's own real veteran by this point
    // in the seed (`VETERAN_SEASON_LEAGUES`), so pressing Join on a seeded `beginner` public
    // league is the real `publicJoinPrecondition` gate refusing for real, never a synthesized
    // 409 this spec typed in by hand. --------------------------------------------------------
    const tierBlockTarget = DEV_SEED.publicLeagues.find((plan) => plan.leagueId === "dev_public_tier_demo")!;
    await page.goto("/browse");
    await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();
    const tierBlockCard = page.locator("li").filter({ has: page.getByRole("heading", { name: tierBlockTarget.name }) });
    await tierBlockCard.getByRole("button", { name: `Join ${tierBlockTarget.name}` }).click();
    await expect(
      tierBlockCard.getByText("This league is reserved for newer players so everyone starts on a level footing. Browse the open leagues to find one you can join."),
    ).toBeVisible();
    await expectNoHorizontalScroll(page, "/browse with the tier-blocked refusal open");

    // --- Task 5: the operator's dispute queue -----------------------------------------------
    // Manager A IS the operator in this environment, DETERMINISTICALLY: `global-setup.ts`'s
    // `ensureE2eOperator` grants it through the real `grantAdmin` writer, idempotently and
    // regardless of who (if anyone) already holds the database's one bootstrap slot — fix round
    // 1, FIX 2's own finding was that the seed pipeline's own attempt (`seedOperator`) can lose
    // that race silently on a shared, reused database, which is exactly what made this section
    // read as passing while never actually reaching the queue. An operator triaging on a phone
    // at 11pm is the realistic case this spec exists to check, not an exotic second identity to
    // mint. FOUR real, permanently-open flags sit here now, none of them decorative: `npm run
    // seed`'s own multi-account fixture (`dev_league_integrity`); Task 9's own trade-fairness
    // fixture (`seedTrades`, `dev_league_trades`); and (Phase 3 Plan D, Task 10) TWO real
    // `trade_hold` flags — one from `npm run seed` itself (`seed-enforcement.ts`,
    // `dev_public_trade_hold`) and one from `e2e/enforcement.spec.ts`'s own held trade above.
    // `league-lifecycle.spec.ts` (which runs before this spec, alphabetically, under this
    // suite's single worker) resolves its own report flag within its own test, so it never adds
    // a fifth row here. `e2e/trades.spec.ts` runs its own trade AND resolves its own fairness
    // flag within its own test (alphabetically after this spec), so it never adds a sixth.
    await page.goto("/app/admin/queue");
    await expect(page.getByRole("heading", { name: "Dispute queue" })).toBeVisible();
    // STRUCTURAL MOVE, followed deliberately (Task 22; the e2e-under-redesign rule): Task 19
    // rebuilt the queue from a `<ul aria-label="Open flags">` of cards into the dense
    // `QueueTable` (`Table caption="Open flags"`), so the row locator is now table rows. The
    // COUNT and every flag-text assertion survive unchanged — same four flags, same sentences.
    // (A20's report saw this section fail 0-rows and attributed it to shared-DB drift; the real
    // cause was this list-to-table move, which no e2e run had crossed until now.)
    const queueRows = page.getByRole("table", { name: "Open flags" }).locator("tbody").getByRole("row");
    await expect(queueRows).toHaveCount(4);
    await expect(queueRows.getByText("The platform flagged two accounts that may be the same person")).toBeVisible();
    const tradeFlagRow = queueRows.filter({ hasText: "The platform flagged a trade for a fairness review" });
    await expect(tradeFlagRow).toBeVisible();
    const tradeHoldRows = queueRows.filter({ hasText: "The platform held a trade until an operator decides" });
    await expect(tradeHoldRows).toHaveCount(2);
    await expectNoHorizontalScroll(page, "the dispute queue");

    // --- Task 5/9: one flag's own detail page — the admin field set, raw scores included,
    // opposite the member feed's (ruling 16), and (Task 9) a TRADE flag's own detail page
    // specifically, the one Plan C's operator arm actually reads most often now ---------------
    // The flagId is read off this row's own link rather than hardcoded: the seed is
    // deterministic, but its id is not this spec's to know in advance, and deriving it here is
    // what keeps this route check honest against whatever the queue actually shows.
    await tradeFlagRow.getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Flag detail" })).toBeVisible();
    await expect(page.getByText("Trade", { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "a trade flag's detail page");

    // --- Phase 4.5, Task 11: the practice lobby --------------------------------------------
    await page.goto("/app/mock-drafts");
    await expect(page.getByRole("heading", { name: "Practice drafts", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start a practice draft" })).toBeVisible();
    await expectNoHorizontalScroll(page, "the practice lobby");

    // --- Task 11: the practice draft's share-link landing -----------------------------------
    await page.goto(mobile360LinkRoomPath);
    await expect(page.getByRole("heading", { name: "Join this practice draft" })).toBeVisible();
    // Manager A is this fixture room's own host (`beforeAll` above), so the real claim door
    // answers a re-entry — "Enter", never "Join" — the same honest server answer every caller
    // gets (`MockShareLanding`'s own docblock).
    await expect(page.getByRole("button", { name: "Enter this practice draft" })).toBeVisible();
    await expectNoHorizontalScroll(page, "the practice draft share landing");

    // --- Task 11: the room's own mock dressing — the practice banner and the board itself ---
    await page.goto(`/app/drafts/${mobile360SoloDraftId}`);
    const mockRoomGotIt = page.getByRole("button", { name: "Got it" });
    if ((await mockRoomGotIt.count()) > 0) await mockRoomGotIt.click();
    await expect(page.getByTestId("practice-banner")).toBeVisible();
    await expect(page.getByLabel("Player pool")).toBeVisible();
    await expectNoHorizontalScroll(page, "the practice draft room");
  } finally {
    await context.close();
  }
});
