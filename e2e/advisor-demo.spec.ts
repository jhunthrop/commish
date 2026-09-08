import { mkdirSync } from "node:fs";
import { expect, test } from "./support/fixtures";

/**
 * THE ADVISOR ON THE SEEDED FIXTURE (spec section 7, the pick count round): open the Draft HQ
 * demo, see the compact lead card with the candidate rows under it, move the "Show 3 / 5 / 10"
 * selector and see the rows follow (and the choice survive a reload), queue from the card and
 * from a row off the clock, watch the pool odds move as the room steps, step to your turn and
 * draft from the card through the confirmation. The demo renders the SAME `AdvisorPanel` the
 * live room's tab renders, over real `advisorCore` views precomputed from a replayed room, so
 * this is the one browser proof of the panel and the two verbs without a live simulator behind a
 * mock room.
 *
 * Also the design-review artifact: the states are photographed into
 * `.superpowers/mocks/screenshots/` beside the mocks they were judged against.
 */
const OUT_DIR = ".superpowers/mocks/screenshots";

test("advisor demo -> compact card, Show 3/5/10 rows, queue off the clock, draft on it", async ({ managerA }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 1440, height: 1000 });

  await managerA.goto("/app/draft/assistant");
  await expect(managerA.getByTestId("demo-replay-label")).toBeVisible({ timeout: 30_000 });

  // --- The lead card and the rows, before pick 1 --------------------------------------------------
  const card = managerA.getByTestId("advisor-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-on-clock", "false");
  await expect(managerA.getByTestId("advisor-header")).toHaveText("Your next pick is 1.04, 3 picks away");
  await expect(managerA.getByTestId("advisor-odds")).toContainText(/of 100$/);
  await expect(managerA.getByTestId("advisor-stamp")).toContainText("As of 1.01 · 100 runs");
  await expect(managerA.getByTestId("advisor-why")).not.toBeEmpty();
  // No filler above the card: the strip, when it renders at all, carries only run and collapse chips.
  await expect(managerA.getByText("Best available.")).toHaveCount(0);
  const strip = managerA.getByTestId("advisor-signals");
  if ((await strip.count()) > 0) expect(await strip.locator("li").count()).toBe(await strip.locator("[data-testid='advisor-run'], [data-testid='advisor-collapse']").count());

  const candidates = managerA.getByTestId("advisor-candidate");
  const selector = managerA.getByRole("group", { name: "Show" });
  await expect(selector.getByRole("button", { name: "5", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(candidates).toHaveCount(4);
  // The cell's text is the figure followed by its screen-reader sentence, so match the start.
  await expect(candidates.first().getByTestId("advisor-odds-runs")).toContainText(/^\d+ of 100/);
  const rows = managerA.getByTestId("demo-odds-row");
  await expect(rows.first()).toBeVisible();
  const before = await rows.allInnerTexts();
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-off-clock.png`, fullPage: true });

  // --- The selector: three states, remembered across a reload -----------------------------------
  await selector.getByRole("button", { name: "10", exact: true }).click();
  await expect(candidates).toHaveCount(9);
  await selector.getByRole("button", { name: "3", exact: true }).click();
  await expect(candidates).toHaveCount(2);
  await managerA.reload();
  await expect(managerA.getByTestId("demo-replay-label")).toBeVisible({ timeout: 30_000 });
  await expect(candidates).toHaveCount(2);
  await selector.getByRole("button", { name: "5", exact: true }).click();
  await expect(candidates).toHaveCount(4);

  // --- Queue from the card and from a row off the clock: each verb says where its pick sits -----
  await card.getByRole("button", { name: "Queue", exact: true }).click();
  await expect(card.getByRole("button", { name: "Queued 1", exact: true })).toBeVisible();
  await candidates.first().getByRole("button", { name: /^Queue / }).click();
  await expect(candidates.first().getByRole("button", { name: /^Queued 2, / })).toBeVisible();

  // --- Tier headers over one position, none over the mixed list ----------------------------------
  await expect(managerA.getByTestId("advisor-tier-header")).toHaveCount(0);
  await managerA.getByRole("button", { name: "RB", exact: true }).click();
  await expect(managerA.getByTestId("advisor-tier-header").first()).toContainText(/^Tier \d+, \d+ of \d+ left$/);
  await managerA.getByRole("button", { name: "All", exact: true }).click();

  // --- Step to your first turn: the odds moved, Draft is the verb on the card and every row -------
  const forward = managerA.getByRole("button", { name: "Forward" });
  for (let i = 0; i < 3; i += 1) await forward.click();
  await expect(managerA.getByTestId("demo-step-label")).toHaveText("Pick 3 of 40");
  await expect(card).toHaveAttribute("data-on-clock", "true");
  await expect(managerA.getByTestId("advisor-header")).toHaveText("You're on the clock");
  await expect(card.getByRole("button", { name: "Draft", exact: true })).toBeVisible();
  await expect(candidates.getByRole("button", { name: /^Draft / })).toHaveCount(4);
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
  await expect(managerA.getByText("Best available.")).toHaveCount(0);

  // --- The phone composition: the same panel, full-width verb -------------------------------------
  await managerA.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  await expect(candidates).toHaveCount(4);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-mobile.png`, fullPage: true });
});
