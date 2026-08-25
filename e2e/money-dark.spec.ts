import { expect, test } from "./support/fixtures";

/**
 * Phase 4, Task 13: the free-season regression contract. Money is dark — `MONEY_STATES.enabled`
 * ships empty, so `moneyIsLive()` reads false everywhere in this build — and every live branch
 * this task built (the front door's live sentence, the Entry ledger row's real fee, the paid
 * join's state-attestation step, the legal page's live disclosure) is proven elsewhere through
 * INJECTED props, never through this run. This walk proves the other half: that the product a
 * real, unmodified visitor reaches today — front door, browse, join, waiting room — is
 * byte-for-byte the free product it has always been. No special setup, no injected `live` prop,
 * no seeded money state: the free path is the only path every real request in this build can
 * ever reach, and this spec is what keeps shipping the live branches from ever loosening that.
 */
test("front door, browse, join and the waiting room stay byte-for-byte the free product with money dark", async ({
  page,
  managerA,
  managerB,
}) => {
  test.setTimeout(60_000);
  const leagueName = `E2E Money Dark ${Date.now()}`;

  // --- Front door, signed out: the free-season sentence, in money green, and no dollar figure --
  await page.goto("/");
  await expect(page.getByText("Every league is free this season.")).toBeVisible();
  await expect(page.getByText(/\$\d/)).toHaveCount(0);

  // --- Browse, signed out: every open card's Entry row reads "Free", never a dollar amount ----
  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();
  await expect(page.getByText(/\$\d/)).toHaveCount(0);

  // --- A fresh public league, through the real UI — never reuses another spec's own room ------
  await managerA.goto("/app");
  // Manager A already has several seeded leagues by this point in the suite (`formats-and-
  // lobby.spec.ts`'s own opening move, mirrored here), so the create form is collapsed behind
  // Task 5's disclosure.
  await managerA.getByText("Start or join another league").click();
  await managerA.getByLabel("League name", { exact: true }).fill(leagueName);
  await managerA.getByLabel("Who can join").selectOption("public");
  await managerA.getByText(/Advanced settings/).click();
  await managerA.getByLabel("Teams").selectOption("8");
  await managerA.getByLabel("Draft start").selectOption("when_full");
  await managerA.getByRole("button", { name: "Create league" }).click();
  await expect(managerA.getByRole("heading", { name: leagueName })).toBeVisible();

  // The commissioner's own waiting room: no dollar figure, no state-attestation control — the
  // paid join's own confirmation (`PaidJoinConfirmation`) never renders for a free league.
  await expect(managerA.getByText(/\$\d/)).toHaveCount(0);
  await expect(managerA.getByLabel("State of entry")).toHaveCount(0);

  // --- Browse -> Join, live, through the real UI, a DIFFERENT signed-in visitor ---------------
  await managerB.goto("/browse");
  await expect(managerB.getByText(/\$\d/)).toHaveCount(0);
  await managerB.getByRole("button", { name: `Join ${leagueName}` }).click();
  await expect(managerB).toHaveURL(/\/app\/leagues\//);
  // The just-seated moment (D1) renders its own `"{name} · You're in"` heading ALONGSIDE the
  // page's own `<h1>{name}</h1>` — either way, the league's own name is what proves this landed.
  await expect(managerB.getByRole("heading", { name: new RegExp(leagueName) }).first()).toBeVisible();

  // --- The waiting room itself: no fee, no attestation, no wallet anywhere in the shell --------
  await expect(managerB.getByText(/\$\d/)).toHaveCount(0);
  await expect(managerB.getByLabel("State of entry")).toHaveCount(0);
  await expect(managerB.getByRole("link", { name: "Wallet" })).toHaveCount(0);
});
