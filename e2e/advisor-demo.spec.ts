import { mkdirSync } from "node:fs";
import { expect, test } from "./support/fixtures";

/**
 * THE ADVISOR ON THE SEEDED FIXTURE (draft advisor round, spec 5): open the Draft HQ demo, see
 * the three bands, queue a target off the clock, step to your turn and draft from the card
 * through the confirmation. The demo renders the SAME `AdvisorPanel` the live room's tab renders,
 * over real `advisorCore` views precomputed from a replayed room, so this is the one browser
 * proof of the bands and the two verbs without a live simulator behind a mock room.
 *
 * Also the design-review artifact: the three states are photographed into
 * `.superpowers/mocks/screenshots/` beside the mocks they were judged against.
 */
const OUT_DIR = ".superpowers/mocks/screenshots";

test("advisor demo -> three bands, queue a target, draft on the clock", async ({ managerA }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 1440, height: 1000 });

  await managerA.goto("/app/draft/assistant");
  await expect(managerA.getByTestId("demo-replay-label")).toBeVisible({ timeout: 30_000 });

  // --- The three bands, before pick 1 ---------------------------------------------------------
  const signals = managerA.getByTestId("advisor-signals");
  const plan = managerA.getByTestId("advisor-plan");
  const now = managerA.getByTestId("advisor-now");
  await expect(signals).toBeVisible();
  await expect(plan).toBeVisible();
  await expect(now).toBeVisible();
  await expect(managerA.getByTestId("advisor-plan-turn")).toHaveCount(3);
  await expect(managerA.getByTestId("advisor-stamp")).toContainText("As of 1.01");
  await expect(managerA.getByTestId("advisor-strategy")).toHaveAttribute("data-voice", "template");
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-off-clock.png`, fullPage: true });

  // --- Queue a target off the clock: the row says where it sits ------------------------------
  const rows = now.getByTestId("advisor-now-row");
  await expect(rows).toHaveCount(5);
  await rows.nth(0).getByRole("button", { name: "Queue", exact: true }).click();
  await expect(rows.nth(0).getByRole("button", { name: "Queued 1", exact: true })).toBeVisible();
  await rows.nth(2).getByRole("button", { name: "Queue", exact: true }).click();
  await expect(rows.nth(2).getByRole("button", { name: "Queued 2", exact: true })).toBeVisible();

  // --- Step to your first turn: Draft is the verb on every row -------------------------------
  const forward = managerA.getByRole("button", { name: "Forward" });
  for (let i = 0; i < 3; i += 1) await forward.click();
  await expect(managerA.getByTestId("demo-step-label")).toHaveText("Pick 3 of 40");
  await expect(now).toHaveAttribute("data-on-clock", "true");
  await expect(now.getByRole("button", { name: "Draft", exact: true })).toHaveCount(5);
  await expect(managerA.getByTestId("advisor-changed")).toBeVisible();
  // The verb buttons ride `transition-colors` from their off-clock style; let the paint settle
  // so the photograph shows the resting state rather than a frame mid-transition.
  await managerA.waitForTimeout(500);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-on-clock.png`, fullPage: true });

  // --- Draft from the card, through the confirmation --------------------------------------------
  const topName = await rows.nth(0).getByTestId("advisor-now-name").innerText();
  await rows.nth(0).getByRole("button", { name: "Draft", exact: true }).click();
  const dialog = managerA.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Draft ${topName}?`);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-confirm.png` });
  await dialog.getByRole("button", { name: "Confirm pick" }).click();
  await expect(managerA.getByTestId("demo-draft-note")).toContainText(`You took ${topName}.`);
  await expect(managerA.getByTestId("demo-step-label")).toHaveText("Pick 4 of 40");
  await expect(managerA.getByTestId("assistant-beat")).toBeVisible();

  // --- The phone composition: three bands stacked ------------------------------------------------
  await managerA.setViewportSize({ width: 390, height: 844 });
  await expect(managerA.getByTestId("advisor-plan-turn")).toHaveCount(3);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-mobile.png`, fullPage: true });
});
