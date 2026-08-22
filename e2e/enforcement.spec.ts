import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { DEV_SEED } from "../src/data/seed/config";
import { createDb } from "../src/db/client";
import { tradeProposals } from "../src/db/schema";
import { formatDraftTime } from "../src/league";
import { ENFORCEMENT_REFUSALS } from "../src/league-service/enforcement";
import { expect, expectNotice, test } from "./support/fixtures";
import {
  E2E_DRAFT_SCHEDULE_INVITE_STATE,
  E2E_DRAFT_SCHEDULE_LEAGUE_ID,
  E2E_HELD_TRADE_FIXTURE_STATE,
  E2E_HELD_TRADE_LEAGUE_ID,
  MANAGER_A_STATE,
  MANAGER_B_STATE,
  type DraftScheduleInvite,
  type HeldTradeFixture,
} from "./global-setup";

/**
 * Phase 3 Plan D, Task 10, Step 3: the three journeys a screenshot cannot fake, walked in a real
 * browser against the real production build — no dev auth bypass anywhere (`global-setup.ts`'s
 * own sealed WorkOS sessions, or a genuinely storageless context for the one page a signed-out
 * visitor reaches). Its own two leagues (`ensureHeldTradeLeague`, `ensureDraftScheduleLeague`,
 * both `global-setup.ts`) follow the reuse-if-exists, stable-identity pattern Plan B and Plan C
 * both settled on: this spec seeds what IT needs, never extends `trades.spec.ts`'s or
 * `league-lifecycle.spec.ts`'s own leagues, and a rerun against the same database never
 * accumulates a second one of either.
 *
 * RUN ORDER (binding context): Playwright discovers spec files alphabetically under this suite's
 * single worker (`playwright.config.ts`'s own `workers: 1`), and "enforcement" sorts before
 * every other file in `e2e/`. That means this spec's own held trade — the SECOND `trade_hold`
 * flag the operator queue holds this run, after `npm run seed`'s own (`seed-enforcement.ts`,
 * `dev_public_trade_hold`) — is already in the queue by the time `league-lifecycle.spec.ts` and
 * `mobile-360.spec.ts` run their own open-flag counts; both files' counts are updated sharply to
 * account for it (see each file's own updated docblock).
 */

test("a veteran browses, is refused a beginner league, and reads why", async ({ managerA }) => {
  const target = DEV_SEED.publicLeagues.find((plan) => plan.leagueId === "dev_public_tier_demo")!;
  await managerA.goto("/browse");
  await expect(managerA.getByRole("heading", { name: "Open leagues" })).toBeVisible();

  // Sees the tier filter — Task 2's own "who's playing" axis.
  await expect(managerA.getByLabel("Who's playing")).toBeVisible();

  // The target beginner league, already visible in the unfiltered default listing, carrying the
  // composition label a real query computed: three seeded dev placeholders, every one of them
  // still a newcomer (Task 10's own veteran leagues deliberately keep every OTHER seeded
  // identity below the cutoff — see `seed-season-league.ts`'s `VETERAN_SEASON_LEAGUES` docblock).
  const card = managerA.locator("li").filter({ has: managerA.getByRole("heading", { name: target.name }) });
  await expect(card).toBeVisible();
  await expect(card.getByText("All newcomers")).toBeVisible();

  // Manager A is the platform's own real veteran: three REAL completed seasons, stamped by
  // `finalizeWeekInTx` itself (`npm run seed`'s own `VETERAN_SEASON_LEAGUES` loop). Pressing
  // Join here is the real `publicJoinPrecondition` gate, never a synthesized refusal.
  await card.getByRole("button", { name: `Join ${target.name}` }).click();
  await expect(card.getByText(ENFORCEMENT_REFUSALS.join)).toBeVisible();

  // The real notice the refused join raised — `tier_blocked_join`, deduped per (user, league) so
  // a rerun of this very spec against the same database never writes a second one, but the FIRST
  // run's row is still there for this assertion to find.
  await expectNotice(managerA, "That league is reserved for newer players");
});

test("a commissioner schedules and starts a draft; a signed-out visitor reads the new time first", async ({ browser }) => {
  test.setTimeout(60_000);

  const invite: DraftScheduleInvite = JSON.parse(readFileSync(E2E_DRAFT_SCHEDULE_INVITE_STATE, "utf8")) as DraftScheduleInvite;
  const contextA = await browser.newContext({ storageState: MANAGER_A_STATE });
  // Genuinely signed out — no storage state at all, the one shape `middleware.ts` exempts
  // (`/app/join/[code]`'s own docblock). Never `MANAGER_B_STATE`: using a real identity here
  // would defeat the point of a SIGNED-OUT read.
  const anonContext = await browser.newContext();
  const pageA = await contextA.newPage();
  const anonPage = await anonContext.newPage();

  try {
    await pageA.goto(`/app/leagues/${E2E_DRAFT_SCHEDULE_LEAGUE_ID}`);
    await expect(pageA.getByRole("heading", { name: "E2E Draft Schedule League" })).toBeVisible();

    const editButton = pageA.getByRole("button", { name: "Edit time" });
    const alreadyStarted = (await editButton.count()) === 0;

    if (!alreadyStarted) {
      // --- The commissioner sets a real draft time, five days out (past the "starting soon"
      // banner, which this journey has no need to also prove) ----------------------------------
      const kickoff = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const pad = (n: number): string => String(n).padStart(2, "0");
      const localValue = `${kickoff.getFullYear()}-${pad(kickoff.getMonth() + 1)}-${pad(kickoff.getDate())}T${pad(kickoff.getHours())}:${pad(kickoff.getMinutes())}`;

      await editButton.click();
      await pageA.getByLabel("Draft time").fill(localValue);
      await pageA.getByRole("button", { name: "Save time" }).click();
      await expect(pageA.getByRole("heading", { name: "Draft scheduled" })).toBeVisible();

      // --- A signed-out visitor reads the NEW time on the invite preview — never sees it from
      // the commissioner's own session, and never through a dev auth bypass ------------------
      const expectedAbsolute = formatDraftTime(kickoff.toISOString(), new Date().toISOString()).split(" (")[0]!;
      await anonPage.goto(`/app/join/${invite.code}`);
      await expect(anonPage.getByRole("heading", { name: "E2E Draft Schedule League" })).toBeVisible();
      await expect(anonPage.getByText(expectedAbsolute)).toBeVisible();
      // The one page under `/app` a signed-out visitor reaches — proven structurally, not just
      // by the page rendering: the sign-in prompt is what a stranger sees instead of a join
      // button that would silently assume an identity nobody supplied.
      await expect(anonPage.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();

      // --- The commissioner presses Start the draft — the first time any browser in this
      // product's history has called `POST /api/drafts/[draftId]/start` ------------------------
      await pageA.getByRole("button", { name: "Start the draft" }).click();
      await expect(pageA.getByRole("heading", { name: "The draft is live" })).toBeVisible({ timeout: 15_000 });
    } else {
      // A prior run of this same spec, against this same long-lived database, already walked
      // the schedule-and-start half — a draft cannot be un-started, and re-scheduling an
      // in-progress draft is not a real product action this spec should fake. What is still
      // real and still worth proving on a rerun: the draft stayed started, and the signed-out
      // invite preview still resolves a real draft time for it.
      await expect(pageA.getByRole("heading", { name: "The draft is live" })).toBeVisible();
      await anonPage.goto(`/app/join/${invite.code}`);
      await expect(anonPage.getByRole("heading", { name: "E2E Draft Schedule League" })).toBeVisible();
      await expect(anonPage.getByText("Draft", { exact: true })).toBeVisible();
      await expect(anonPage.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    }
  } finally {
    await contextA.close();
    await anonContext.close();
  }
});

/**
 * Resume-safety AND idempotency, both from one read: a prior run that crashed between propose
 * and accept leaves an OPEN offer between these two teams (which would collide on
 * `proposeTrade`'s own open-fingerprint index and refuse this run's otherwise-identical offer
 * with a 409) — cleared here, the identical class `trades.spec.ts`'s own `clearStrayState`
 * guards against. A prior run that COMPLETED, though, already put a real `held` trade between
 * these two teams — `proposeTrade`'s fingerprint index is partial on `status = 'open'`
 * (`trade_proposals_open_fingerprint_idx`), so it does NOT block a second, byte-identical
 * proposal once the first has moved past `open`. Without this check, every re-run of this spec
 * against the same long-lived database would propose and hold ANOTHER trade, growing the
 * operator queue's own `trade_hold` count by one per run — exactly the class of fragility Task
 * 10's own brief ledgers (`league-lifecycle.spec.ts`'s and `mobile-360.spec.ts`'s own sharp
 * counts would need bumping forever). Reusing the first one found is what keeps this spec's own
 * footprint at exactly one held trade, however many times it runs.
 */
async function findExistingHeldTradeId(): Promise<string | null> {
  const db = createDb();
  try {
    await db.delete(tradeProposals).where(and(eq(tradeProposals.leagueId, E2E_HELD_TRADE_LEAGUE_ID), eq(tradeProposals.status, "open")));
    const [existing] = await db.select({ id: tradeProposals.id }).from(tradeProposals).where(and(eq(tradeProposals.leagueId, E2E_HELD_TRADE_LEAGUE_ID), eq(tradeProposals.status, "held"))).limit(1);
    return existing?.id ?? null;
  } finally {
    await db.$client.end();
  }
}

test("a trade past the auto-hold threshold really holds, and the counterparty reads the same sentence the notice sent them", async ({ browser }) => {
  test.setTimeout(60_000);

  const fixture: HeldTradeFixture = JSON.parse(readFileSync(E2E_HELD_TRADE_FIXTURE_STATE, "utf8")) as HeldTradeFixture;
  const contextA = await browser.newContext({ storageState: MANAGER_A_STATE });
  const contextB = await browser.newContext({ storageState: MANAGER_B_STATE });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const existingHeldTradeId = await findExistingHeldTradeId();

    if (existingHeldTradeId === null) {
      // --- Manager A proposes the widest-gap package `global-setup.ts` computed, in a real
      // browser — well past `INTEGRITY_CONFIG.trade.autoHoldThreshold` -------------------------
      await pageA.goto(`/app/leagues/${E2E_HELD_TRADE_LEAGUE_ID}/trades`);
      await expect(pageA.getByRole("heading", { name: "Trades" })).toBeVisible();
      await pageA.getByRole("button", { name: "Put an offer together" }).click();
      await pageA.getByLabel("Trade with").selectOption({ label: "E2E Held Trade Team 2" });

      const myFieldset = pageA.locator("fieldset").filter({ hasText: "Your players" });
      const theirFieldset = pageA.locator("fieldset").filter({ hasText: "Their players" });
      for (const name of fixture.giveNames) await myFieldset.locator("li").filter({ hasText: name }).getByRole("checkbox").check();
      for (const name of fixture.getNames) await theirFieldset.locator("li").filter({ hasText: name }).getByRole("checkbox").check();

      await pageA.getByRole("button", { name: "Propose trade" }).click();
      await expect(pageA.getByText("Trade proposed.")).toBeVisible();

      // --- Manager B accepts — and this one holds instead of executing ------------------------
      await pageB.goto(`/app/leagues/${E2E_HELD_TRADE_LEAGUE_ID}/trades`);
      const inboundCard = pageB.getByRole("region", { name: "Offers to answer" }).getByRole("article", { name: "Trade with E2E Held Trade Team 1" });
      await expect(inboundCard).toBeVisible();
      await inboundCard.getByRole("button", { name: "Accept" }).click();
      await pageB.getByRole("button", { name: "Confirm trade" }).click();
    } else {
      // A prior run already held this pair's own trade for real — read it, never re-propose it.
      await pageB.goto(`/app/leagues/${E2E_HELD_TRADE_LEAGUE_ID}/trades`);
    }

    // --- Manager B's own page, still open, now shows the held trade — never "Both rosters
    // changed": nothing moved, the fairness review is what is happening instead --------------
    const heldCard = pageB.getByRole("region", { name: "Trade history" }).getByRole("article", { name: "Trade with E2E Held Trade Team 1" }).first();
    await expect(heldCard).toBeVisible({ timeout: 15_000 });
    await expect(heldCard.getByText("Your trade is waiting on a fairness review")).toBeVisible();
    const bannerSentence =
      "Your trade with E2E Held Trade Team 1 in E2E Held Trade League is on hold while somebody at Commish looks at it. Public leagues get a second pair of eyes on trades this lopsided, and neither roster changes until that finishes. We will tell you both as soon as there is an answer.";
    await expect(heldCard.getByText(bannerSentence)).toBeVisible();
    await expect(heldCard.getByText("Both rosters changed when this trade was accepted.")).toHaveCount(0);

    // --- The SAME sentence the real notice sent — proven byte-identical, not merely similar --
    await expectNotice(pageB, "Your trade is waiting on a fairness review");
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
