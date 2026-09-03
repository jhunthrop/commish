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
  await managerA.getByLabel("Teams").selectOption(String(TEAM_COUNT));
  await managerA.getByLabel("Pick clock").selectOption(String(PICK_SECONDS));
  await managerA.getByLabel("Draft position").selectOption(String(TEAM_COUNT));
  await expect(async () => {
    await managerA.getByRole("button", { name: "Start mock draft" }).click();
    await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });

  // The tour (anchored coach marks in the quilt, modal elsewhere) photographs over the room.
  const gotIt = managerA.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();

  const strip = managerA.getByTestId("clock-strip");

  // 1 — RESTING: bots are picking, the quilt owns the stage, the drawer is the chip row.
  await expect(strip).toHaveAttribute("data-strip-state", "resting", { timeout: 30_000 });
  await managerA.waitForTimeout(1_500);
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-resting.png` });

  // 2 — DRAWER AT HALF: space borrows the stage's lower edge.
  await managerA.keyboard.press(" ");
  await expect(managerA.getByTestId("pool-drawer")).toHaveAttribute("data-drawer-height", "half");
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-drawer-half.png` });
  await managerA.keyboard.press("Escape");

  // 3 — PEEK: the first landed pick's cell opens the dense card over the right edge.
  const firstCell = managerA.getByTestId("quilt-pick-cell").first();
  await expect(firstCell).toBeVisible({ timeout: 60_000 });
  await firstCell.click();
  await expect(managerA.getByTestId("peek-sheet")).toBeVisible();
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-peek.png` });
  await managerA.keyboard.press("Escape");

  // 4 — YOUR TURN: the strip swells amber. Last slot, so eleven bot picks precede it.
  await expect(strip).toHaveAttribute("data-strip-state", "your-turn", { timeout: ON_CLOCK_TIMEOUT_MS });
  await managerA.waitForTimeout(1_000);
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-your-turn.png` });

  // 5 — PHONE, YOUR TURN + POOL: the inversion, big verbs, amber takeover header.
  await managerA.setViewportSize({ width: 390, height: 844 });
  await managerA.waitForTimeout(500);
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-mobile-your-turn.png` });

  // 6 — PHONE, THE BOARD TAB: the quilt as micro tiles.
  await managerA.getByRole("button", { name: "BOARD" }).click();
  await managerA.waitForTimeout(300);
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-mobile-board.png` });
  console.log(`[shot] wrote 6 states into ${OUT_DIR}`);
});
