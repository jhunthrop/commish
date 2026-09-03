import { expect, test } from "./support/fixtures";

/**
 * THE QUILT'S PICTURES — the design-review harness for the 2026-09-02 draft room rebuild, the
 * same picture-not-rulebook idea as `draft-room-shot.spec.ts` (see its docblock for why a
 * screenshot is the only artifact that catches a composition). Drives a real solo mock draft
 * (mock rooms are snake, so they render the quilt) and photographs the room's key states into
 * `.superpowers/mocks/screenshots/`, beside the blueprint mocks they are reviewed against.
 *
 * SKIPPED unless `QUILT_SHOTS` is set — a design tool, not an assertion. To use it:
 *
 *   npm run e2e:build
 *   QUILT_SHOTS=1 dotenv -e .env.local -v STATS_PROVIDER=mock -- npx playwright test e2e/quilt-shots.spec.ts
 */
const TEAM_COUNT = 12;
const PICK_SECONDS = 90;
const ON_CLOCK_TIMEOUT_MS = 240_000;
const OUT_DIR = ".superpowers/mocks/screenshots";

test("photograph the quilt's key states", async ({ managerA }) => {
  test.skip(process.env.QUILT_SHOTS === undefined, "design tool; set QUILT_SHOTS=1 to run");
  test.setTimeout(480_000);

  await managerA.setViewportSize({ width: 1680, height: 1050 });
  await managerA.goto("/");
  await managerA.getByRole("link", { name: "Try a mock draft" }).click();
  await expect(managerA).toHaveURL(/\/app\/mock-drafts$/);
  // The lobby's config is segment groups now, not selects — click the option's own button.
  await managerA.getByRole("group", { name: "Teams" }).getByRole("button", { name: String(TEAM_COUNT), exact: true }).click();
  await managerA.getByRole("group", { name: "Pick clock" }).getByRole("button", { name: `${PICK_SECONDS}s`, exact: true }).click();
  await managerA.getByRole("group", { name: "Draft position" }).getByRole("button", { name: String(TEAM_COUNT), exact: true }).click();
  await expect(async () => {
    await managerA.getByRole("button", { name: "Start mock draft" }).click();
    await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });

  // The tour (anchored coach marks in the quilt, modal elsewhere) photographs over the room.
  const gotIt = managerA.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();

  const strip = managerA.getByTestId("clock-strip");

  // A 12-team solo room on the last slot reaches the host's turn fast (bot picks are seconds),
  // so the states are photographed in the order the room actually produces them.

  // 1 — YOUR TURN: the strip swells amber; eleven bot picks are already on the quilt.
  await expect(strip).toHaveAttribute("data-strip-state", "your-turn", { timeout: ON_CLOCK_TIMEOUT_MS });
  await managerA.waitForTimeout(1_000);
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-your-turn.png` });

  // 2 — DRAWER AT HALF: space borrows the stage's lower edge.
  await managerA.keyboard.press(" ");
  await expect(managerA.getByTestId("pool-drawer")).toHaveAttribute("data-drawer-height", "half");
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-drawer-half.png` });
  await managerA.keyboard.press("Escape");

  // 3 — PEEK: a landed pick's cell opens the dense card over the right edge.
  await managerA.getByTestId("quilt-pick-cell").first().click();
  await expect(managerA.getByTestId("peek-sheet")).toBeVisible();
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-peek.png` });
  await managerA.keyboard.press("Escape");

  // 4 — THE PICK MOMENT: DRAFT opens the undo window; the pick leaves only when it expires.
  await strip.getByRole("button", { name: "Draft" }).first().click();
  await expect(managerA.getByTestId("quilt-room").getByTestId("undo-pill")).toBeVisible();
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-undo-pill.png` });
  await expect(managerA.getByTestId("quilt-room").getByTestId("undo-pill")).toBeHidden({ timeout: 10_000 });

  // 5 — RESTING: the room's clock is somebody else's. A solo mock's bots pick in seconds, so
  // the resting state is a short window — keep making our own picks (the snake's last seat
  // picks twice back to back) and photograph the first resting frame that shows itself. If the
  // bots chain too fast to ever catch one, say so and move on: the shot is a design tool.
  let restingShot = false;
  for (let attempt = 0; attempt < 4 && !restingShot; attempt += 1) {
    try {
      await expect(strip).toHaveAttribute("data-strip-state", "resting", { timeout: 20_000 });
      await managerA.screenshot({ path: `${OUT_DIR}/quilt-resting.png` });
      restingShot = true;
    } catch {
      const drafts = strip.getByRole("button", { name: "Draft" });
      if ((await drafts.count()) === 0) break;
      await drafts.first().click();
      await expect(managerA.getByTestId("quilt-room").getByTestId("undo-pill")).toBeHidden({ timeout: 10_000 });
    }
  }
  if (!restingShot) console.log("[shot] resting state never held long enough to photograph");

  // 6 — PHONE: the inversion, pool first with big verbs.
  await managerA.setViewportSize({ width: 390, height: 844 });
  await managerA.waitForTimeout(500);
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-mobile-pool.png` });

  // 7 — PHONE, THE BOARD TAB: the quilt as micro tiles.
  await managerA.getByRole("button", { name: "BOARD" }).click();
  await managerA.waitForTimeout(300);
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-mobile-board.png` });
  console.log(`[shot] wrote 7 states into ${OUT_DIR}`);
});
