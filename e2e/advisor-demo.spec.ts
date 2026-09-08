import { mkdirSync } from "node:fs";
import { expect, test } from "./support/fixtures";

/**
 * THE ADVISOR ON THE SEEDED FIXTURE (spec section 7): open the Draft HQ demo, see the one card,
 * queue its pick off the clock, watch the pool odds move as the room steps, step to your turn
 * and draft from the card through the confirmation. The demo renders the SAME `NextPickCard` the
 * live room's tab renders, over real `advisorCore` views precomputed from a replayed room, so
 * this is the one browser proof of the card and the two verbs without a live simulator behind a
 * mock room.
 *
 * Also the design-review artifact: the states are photographed into
 * `.superpowers/mocks/screenshots/` beside the mocks they were judged against.
 */
const OUT_DIR = ".superpowers/mocks/screenshots";

test("advisor demo -> one card, odds on every row, queue off the clock, draft on it", async ({ managerA }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 1440, height: 1000 });

  await managerA.goto("/app/draft/assistant");
  await expect(managerA.getByTestId("demo-replay-label")).toBeVisible({ timeout: 30_000 });

  // --- The one card, before pick 1 --------------------------------------------------------------
  const card = managerA.getByTestId("advisor-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-on-clock", "false");
  await expect(managerA.getByTestId("advisor-header")).toHaveText("Your next pick is 1.04, 3 picks away");
  await expect(managerA.getByTestId("advisor-odds")).toContainText(/of 100$/);
  await expect(managerA.getByTestId("advisor-stamp")).toContainText("As of 1.01 · 100 runs");
  await expect(managerA.getByTestId("advisor-why")).not.toBeEmpty();
  const rows = managerA.getByTestId("demo-odds-row");
  await expect(rows.first()).toBeVisible();
  const before = await rows.allInnerTexts();
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-off-clock.png`, fullPage: true });

  // --- Queue the card's pick off the clock: the verb says where it sits -------------------------
  await card.getByRole("button", { name: "Queue", exact: true }).click();
  await expect(card.getByRole("button", { name: "Queued 1", exact: true })).toBeVisible();

  // --- Tier headers over one position, none over the mixed list ----------------------------------
  await expect(managerA.getByTestId("advisor-tier-header")).toHaveCount(0);
  await managerA.getByRole("button", { name: "RB", exact: true }).click();
  await expect(managerA.getByTestId("advisor-tier-header").first()).toContainText(/^Tier \d+, \d+ of \d+ left$/);
  await managerA.getByRole("button", { name: "All", exact: true }).click();

  // --- Step to your first turn: the odds moved, Draft is the verb --------------------------------
  const forward = managerA.getByRole("button", { name: "Forward" });
  for (let i = 0; i < 3; i += 1) await forward.click();
  await expect(managerA.getByTestId("demo-step-label")).toHaveText("Pick 3 of 40");
  await expect(card).toHaveAttribute("data-on-clock", "true");
  await expect(managerA.getByTestId("advisor-header")).toHaveText("You're on the clock");
  await expect(card.getByRole("button", { name: "Draft", exact: true })).toBeVisible();
  const after = await rows.allInnerTexts();
  expect(after).not.toEqual(before);
  // The verb rides `transition-colors` from its off-clock style; let the paint settle so the
  // photograph shows the resting state rather than a frame mid-transition.
  await managerA.waitForTimeout(500);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-on-clock.png`, fullPage: true });

  // --- Draft from the card, through the confirmation --------------------------------------------
  const topName = await managerA.getByTestId("advisor-name").innerText();
  await card.getByRole("button", { name: "Draft", exact: true }).click();
  const dialog = managerA.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Draft ${topName}?`);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-confirm.png` });
  await dialog.getByRole("button", { name: "Confirm pick" }).click();
  await expect(managerA.getByTestId("demo-draft-note")).toContainText(`You took ${topName}.`);
  await expect(managerA.getByTestId("demo-step-label")).toHaveText("Pick 4 of 40");
  await expect(managerA.getByTestId("assistant-beat")).toBeVisible();

  // --- The phone composition: the same card, full-width verb -------------------------------------
  await managerA.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-mobile.png`, fullPage: true });
});
