import { DEV_SEED } from "../src/data/seed/config";
import { expect, SEEDED_SEASON_LEAGUE_ID, test } from "./support/fixtures";
import { E2E_HELD_TRADE_LEAGUE_ID, MANAGER_A_STATE } from "./global-setup";

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
      await page.getByLabel("Who it's for").selectOption("experienced");
      await page.getByRole("button", { name: "Create league" }).click();
    } else {
      await existing.click();
    }

    // --- A league home: terms panel and members panel, the two Task 3/8 surfaces ----------
    await expect(page.getByRole("heading", { name: leagueName })).toBeVisible();
    await expect(page.getByRole("list", { name: "Managers" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Trades" })).toBeVisible();
    await expectNoHorizontalScroll(page, "the trades page");

    // --- Phase 3 Plan D, Task 10: the held-trade banner — a long sentence inside a bordered
    // panel, and one of the two new surfaces this task adds to this spec's own 360px walk.
    // `e2e/enforcement.spec.ts` sorts alphabetically before this file and already held a real
    // trade between manager A and manager B here (`e2e_held_trade_league`) — reused, never
    // re-proposed: a second identical offer between the same two teams is exactly the
    // accumulation the reuse-if-exists discipline exists to avoid, and this section only READS
    // what that spec already made real. -------------------------------------------------------
    await page.goto(`/app/leagues/${E2E_HELD_TRADE_LEAGUE_ID}/trades`);
    await expect(page.getByRole("heading", { name: "Trades" })).toBeVisible();
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
    const queueRows = page.getByRole("list", { name: "Open flags" }).getByRole("listitem");
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
  } finally {
    await context.close();
  }
});
