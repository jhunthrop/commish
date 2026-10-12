import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createDb } from "@research-ts/db/client";
import { integrityFlags, tradeProposals } from "@/db/schema";
import { expect, expectNotice, test } from "./support/fixtures";
import {
  E2E_TRADES_FIXTURE_STATE,
  E2E_TRADES_LEAGUE_ID,
  MANAGER_A_STATE,
  MANAGER_B_STATE,
  MANAGER_C_STATE,
  type TradesFixture,
} from "./global-setup";

/**
 * The end-to-end walk Task 9's own brief names: propose (real browser), accept (a second real
 * sealed session), both rosters visibly change, the notice arrives, the seeded-through-real-
 * offer's own genuinely lopsided trade puts a REAL `trade_fairness` flag in the operator queue,
 * a third manager's activity feed shows the trade and nothing about the flag, and the operator
 * reverses it — both rosters back, both managers notified.
 *
 * A NEW spec, not three more steps on `league-lifecycle.spec.ts` (that spec's own docblock
 * already declines a full draft for the identical reason): a trade spec needs a league that has
 * already drafted, with two managers holding known players, and bolting that onto the lifecycle
 * run would make both specs slower and each one's failure ambiguous. This spec's own league
 * (`e2e_trades_league`) is seeded once, in `global-setup.ts`, with the reuse-if-exists idiom
 * `mobile-360.spec.ts` already established (`ensureTradesLeague`'s own guard) — never re-dealt
 * on a rerun, which is what keeps this spec safe to run twice against the same database: this
 * test itself reverses the trade it makes, so a completed run always leaves the rosters back
 * where it found them for the NEXT run to reuse.
 *
 * WHICH PLAYERS: never hardcoded here. `global-setup.ts`'s own `writeTradesFixture` computes,
 * against the real dealt rosters, the widest-gap combination of manager A's and manager B's real
 * players that crosses `INTEGRITY_CONFIG.trade.fairnessFlagThreshold` — the same detector this
 * trade's own acceptance will run — and writes the two name lists this spec reads below. A
 * hand-picked pair here would silently stop being lopsided the moment the committed dataset or
 * the snake draft's own order changed; reading the computed answer never can.
 */
const fixture: TradesFixture = JSON.parse(readFileSync(E2E_TRADES_FIXTURE_STATE, "utf8")) as TradesFixture;

const TEAM_A_NAME = "E2E Trade Team 1";
const TEAM_B_NAME = "E2E Trade Team 2";

async function checkPlayers(fieldset: ReturnType<Page["locator"]>, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await fieldset.locator("li").filter({ hasText: name }).getByRole("checkbox").check();
  }
}

/**
 * Resume-safety, not the tested surface: a prior run of THIS spec that failed midway can leave
 * this league's state stuck between two of its own steps on this long-lived database — an offer
 * between these two teams stuck `open` (which would collide on `proposeTrade`'s own fingerprint
 * index and refuse this run's otherwise-identical offer with a 409), or a `trade_fairness` flag
 * this run's own grotesque offer will raise a second one of, left over from a run that never
 * reached its own resolve step (which would make the queue-row locator below match more than
 * one row). Both cleared directly, never withdrawn/resolved through the product (this is
 * scaffolding cleanup, the same class of direct-DB step `global-setup.ts` already takes before
 * any spec's own assertions begin) — the same "resume from exactly where a crash left off"
 * discipline `seedTrades`'s own resume path (`src/data/seed/seed-trades.ts`) keeps for the
 * identical failure mode.
 */
async function clearStrayState(): Promise<void> {
  const db = createDb();
  try {
    const tradeRows = await db.select({ id: tradeProposals.id }).from(tradeProposals).where(eq(tradeProposals.leagueId, E2E_TRADES_LEAGUE_ID));
    const tradeIds = tradeRows.map((row) => row.id);
    if (tradeIds.length > 0) {
      await db.delete(integrityFlags).where(and(eq(integrityFlags.subjectType, "trade"), inArray(integrityFlags.subjectId, tradeIds), isNull(integrityFlags.resolvedAt)));
    }
    await db.delete(tradeProposals).where(and(eq(tradeProposals.leagueId, E2E_TRADES_LEAGUE_ID), eq(tradeProposals.status, "open")));
  } finally {
    await db.$client.end();
  }
}

test("propose, accept, notice, a real fairness flag, and an operator's reversal — start to finish", async ({ browser }) => {
  test.setTimeout(180_000);

  const contextA = await browser.newContext({ storageState: MANAGER_A_STATE });
  const contextB = await browser.newContext({ storageState: MANAGER_B_STATE });
  const contextC = await browser.newContext({ storageState: MANAGER_C_STATE });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageC = await contextC.newPage();

  try {
    await clearStrayState();

    // --- Manager A builds the offer, in a real browser ------------------------------------
    await pageA.goto(`/app/leagues/${E2E_TRADES_LEAGUE_ID}/trades`);
    await expect(pageA.getByRole("heading", { name: "Trades" })).toBeVisible();

    await pageA.getByRole("button", { name: "Put an offer together" }).click();
    await pageA.getByLabel("Trade with").selectOption({ label: TEAM_B_NAME });

    const myFieldset = pageA.locator("fieldset").filter({ hasText: "Your players" });
    const theirFieldset = pageA.locator("fieldset").filter({ hasText: "Their players" });
    await checkPlayers(myFieldset, fixture.giveNames);
    await checkPlayers(theirFieldset, fixture.getNames);

    // The platform's own advisory read, asked for before the send control is ever reachable
    // (`TradeComposer`'s own docblock) — grotesque enough to read "a long way from even",
    // proving this offer really is the lopsided one `writeTradesFixture` computed, through the
    // real UI rather than trusted from the fixture file alone.
    await expect(pageA.getByText("This is a long way from even in weekly production.")).toBeVisible({ timeout: 15_000 });

    await pageA.getByRole("button", { name: "Propose trade" }).click();
    await expect(pageA.getByText("Trade proposed.")).toBeVisible();

    // --- Manager B sees the offer, and the notice Plan A built --------------------------------
    await pageB.goto(`/app/leagues/${E2E_TRADES_LEAGUE_ID}/trades`);
    await expect(pageB.getByRole("region", { name: "Needs your answer" })).toBeVisible();
    // `TradeCard`'s own `aria-label` — "Trade with <counterparty>" — not `hasText`, which
    // filters on rendered text content and would never see an attribute that renders nothing.
    // Scoped to THIS band specifically: a rerun against this same long-lived database leaves a
    // past (already-reversed) trade with the identical counterparty name sitting in "Trade
    // history" too, and an unscoped locator would match both.
    const inboundCard = pageB.getByRole("region", { name: "Needs your answer" }).getByRole("article", { name: `Trade with ${TEAM_A_NAME}` });
    await expect(inboundCard).toBeVisible();
    // From B's OWN side of an inbound offer, "You give" is what B would send if they accept —
    // the counterparty's own assets, `fixture.getNames` (what manager A asked FOR).
    for (const name of fixture.getNames) await expect(inboundCard.getByText(name)).toBeVisible();

    // `.first()`: notices ACCUMULATE across runs against this same, long-lived dev database
    // (nothing here ever deletes an old one), so a rerun's inbox can hold more than one
    // identically-titled row — the newest (this run's own) is always the one on top.
    await expectNotice(pageB, `${TEAM_A_NAME} sent you a trade offer`);

    // --- Manager B accepts — both rosters change, right here -----------------------------
    await inboundCard.getByRole("button", { name: "Accept" }).click();
    await pageB.getByRole("button", { name: "Confirm trade" }).click();
    await expect(pageB.getByText("Both rosters changed when this trade was accepted.").first()).toBeVisible({ timeout: 15_000 });

    // Both parties' own notice inbox reads "Your trade went through" — the one moment this
    // product tells a member their roster just moved (`notices.ts`'s own docblock).
    await expectNotice(pageB, "Your trade went through");

    // Manager A's own "Your trade went through" notice is not re-checked here — B's own check
    // above already proves the notice arrives, and `INTEGRITY_CONFIG.notices.rateLimit` (30
    // requests/60s, PER USER, shared across every notices fetch a session's header makes on
    // EVERY page load, not just an explicit click) is real: every `AppHeader` mount fires one,
    // and this spec's own operator arc (queue, flag detail, resolve) already spends several of
    // manager A's own budget below. One reload, one heading — this is where "both rosters
    // visibly changed" gets its OWN proof (`TradeCard`'s settled-state sentence), never a second
    // composer reopen this budget cannot afford.
    await pageA.reload();
    await expect(pageA.getByRole("heading", { name: "Trade history" })).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByText("Both rosters changed when this trade was accepted.").first()).toBeVisible();

    // --- A third manager sees the trade in the shared feed, and nothing about the flag ------
    await pageC.goto(`/app/leagues/${E2E_TRADES_LEAGUE_ID}/activity`);
    await expect(pageC.getByRole("heading", { name: "League activity" })).toBeVisible();
    await expect(pageC.getByText(`${TEAM_A_NAME} and ${TEAM_B_NAME} completed a trade.`).first()).toBeVisible();
    await expect(pageC.getByText(/flag/i)).toHaveCount(0);
    await expect(pageC.getByText(/fairness/i)).toHaveCount(0);

    // --- The seeded operator (manager A) finds the real flag in the real queue --------------
    await pageA.goto("/app/admin/queue");
    await expect(pageA.getByRole("heading", { name: "Dispute queue" })).toBeVisible();
    // STRUCTURAL MOVE, followed deliberately (the e2e-under-redesign rule): Phase 3.6 Task 19
    // rebuilt the queue from a `<ul aria-label="Open flags">` of cards into the dense
    // `QueueTable` (`Table caption="Open flags"`), so the row locator is now table rows — the
    // same move `mobile-360.spec.ts` (A22) already made. The team-name filter and the
    // fairness-question assertion below survive unchanged.
    const queueRows = pageA.getByRole("table", { name: "Open flags" }).locator("tbody").getByRole("row");
    const ourFlagRow = queueRows.filter({ hasText: `${TEAM_A_NAME} and ${TEAM_B_NAME}` });
    await expect(ourFlagRow).toBeVisible();
    await expect(ourFlagRow.getByText("The platform flagged a trade for a fairness review")).toBeVisible();

    await ourFlagRow.getByRole("link").click();
    await expect(pageA.getByRole("heading", { name: "Flag detail" })).toBeVisible();
    // The full propose-to-accept trail, and both sides' real players named — never a summary
    // the operator has to take on faith.
    for (const name of [...fixture.giveNames, ...fixture.getNames]) {
      await expect(pageA.getByText(name).first()).toBeVisible();
    }
    await expect(pageA.getByRole("list", { name: "Flag history" })).toBeVisible();

    // --- The operator resolves it `trade_reversed` -------------------------------------------
    await pageA.getByRole("radio", { name: "Reverse the trade" }).check();
    await pageA.getByLabel("Your note").fill("Reversing this one — the gap here is not a coincidence.");
    await pageA.getByRole("button", { name: "Submit decision" }).click();
    // Not `getByRole("status")`'s own transient "Decision recorded." — `ResolutionForm`'s
    // successful submit calls `router.refresh()` in the same breath as `setDone(true)`, and that
    // refresh usually wins the race, swapping the whole form out for `ResolutionSummary` before
    // this test (or a real operator) ever sees the client-only message. `ResolutionSummary`'s
    // own `DECISION_PHRASE` text is the real, durable proof the decision landed.
    await expect(pageA.getByText(/reversed the trade/)).toBeVisible({ timeout: 15_000 });

    // --- Both members' rosters are back, and both have the notice ---------------------------
    await expectNotice(pageA, "An operator reversed your trade");

    // B's one reload does double duty: a fresh mount fetch for its own notice, AND — on the SAME
    // navigation, no second one — `TradeCard`'s own settled-state sentence for the reversed
    // trade, which is this test's proof that B's roster is back without reopening the composer a
    // second time.
    await pageB.reload();
    await expect(pageB.getByText("An operator reversed this trade. Both rosters moved back to how they were.").first()).toBeVisible({ timeout: 15_000 });
    await expectNotice(pageB, "An operator reversed your trade");
  } finally {
    await contextA.close();
    await contextB.close();
    await contextC.close();
  }
});
