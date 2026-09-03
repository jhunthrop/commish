import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

/**
 * THE WARM QUILT'S PICTURES — the design-review harness for the 2026-09-03 quilt flagship pass
 * (manager row, edge handles, roster button, faces in cells). Same picture-not-rulebook idea as
 * `quilt-shots.spec.ts`, with two upgrades the v6 foundation's audit demanded: the board is
 * photographed HYDRATED (a real solo mock, several picks in, through the real store), and every
 * state lands in BOTH themes. The drawer state is opened through the new tab HANDLES, not the
 * keyboard, so the pictures prove the founder's own gesture.
 *
 * SKIPPED unless `QUILT_WARM_SHOTS` is set — a design tool, not an assertion. To use it:
 *
 *   npm run e2e:build
 *   QUILT_WARM_SHOTS=1 dotenv -e .env.local -v STATS_PROVIDER=mock -- npx playwright test e2e/quilt-warm-shots.spec.ts
 */
const TEAM_COUNT = 12;
const PICK_SECONDS = 90;
const ON_CLOCK_TIMEOUT_MS = 240_000;
const OUT_DIR = ".superpowers/screenshots";
const THEME_STORAGE_KEY = "commish.theme";

/** `design-v2.spec.ts`'s own settle idiom (see its docblock for why a reload, not an attribute
 *  write, and why the flat wait after): the stored preference's real path, then the transition
 *  tokens' worst case. */
async function setThemeAndSettle(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate(({ key, t }) => window.localStorage.setItem(key, t), { key: THEME_STORAGE_KEY, t: theme });
  await page.reload();
  await page.waitForFunction((t) => document.documentElement.getAttribute("data-theme") === t, theme, { timeout: 10_000 });
  await page.waitForTimeout(1_500);
}

async function dismissTour(page: Page): Promise<void> {
  const gotIt = page.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();
}

/** Opens the drawer to half THROUGH the edge handles (founder addition 2), photographs it,
 *  and gives the stage back. */
async function shootDrawerHalf(page: Page, path: string): Promise<void> {
  await page.getByTestId("drawer-handles").getByRole("tab", { name: /Pool/ }).click();
  await expect(page.getByTestId("pool-drawer")).toHaveAttribute("data-drawer-height", "half");
  await page.waitForTimeout(300);
  await page.screenshot({ path });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pool-drawer")).toHaveAttribute("data-drawer-height", "collapsed");
}

test("photograph the warmed quilt, hydrated, in both themes", async ({ managerA }) => {
  test.skip(process.env.QUILT_WARM_SHOTS === undefined, "design tool; set QUILT_WARM_SHOTS=1 to run");
  test.setTimeout(900_000);

  await managerA.setViewportSize({ width: 1680, height: 1050 });
  await managerA.goto("/");
  await managerA.getByRole("link", { name: "Try a mock draft" }).click();
  await expect(managerA).toHaveURL(/\/app\/mock-drafts$/);
  await managerA.getByRole("group", { name: "Teams" }).getByRole("button", { name: String(TEAM_COUNT), exact: true }).click();
  await managerA.getByRole("group", { name: "Pick clock" }).getByRole("button", { name: `${PICK_SECONDS}s`, exact: true }).click();
  await managerA.getByRole("group", { name: "Draft position" }).getByRole("button", { name: String(TEAM_COUNT), exact: true }).click();
  await expect(async () => {
    await managerA.getByRole("button", { name: "Start mock draft" }).click();
    await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  await dismissTour(managerA);

  const strip = managerA.getByTestId("clock-strip");

  // DARK, YOUR TURN: eleven bot picks already hydrate the board; the manager row's rings and
  // the active round's faces are all on stage.
  await expect(strip).toHaveAttribute("data-strip-state", "your-turn", { timeout: ON_CLOCK_TIMEOUT_MS });
  await managerA.waitForTimeout(1_000);
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-your-turn-dark.png` });

  // DARK, DRAWER AT HALF — opened through the handles.
  await shootDrawerHalf(managerA, `${OUT_DIR}/quilt-drawer-half-dark.png`);

  // DARK, RESTING: draft (the snake's last seat picks twice), let the pick flush, and catch
  // the first resting frame. Bots chain fast; retry like quilt-shots does.
  let restingShot = false;
  for (let attempt = 0; attempt < 4 && !restingShot; attempt += 1) {
    const drafts = strip.getByRole("button", { name: "Draft" });
    if ((await drafts.count()) > 0) {
      await drafts.first().click();
      await expect(managerA.getByTestId("quilt-room").getByTestId("undo-pill")).toBeHidden({ timeout: 10_000 });
    }
    try {
      await expect(strip).toHaveAttribute("data-strip-state", "resting", { timeout: 20_000 });
      await managerA.waitForTimeout(500);
      await managerA.screenshot({ path: `${OUT_DIR}/quilt-resting-dark.png` });
      restingShot = true;
    } catch {
      /* our turn again — loop drafts once more */
    }
  }
  if (!restingShot) console.log("[shot] dark resting never held long enough to photograph");

  // LIGHT: the stored preference's real path, then the same three states as the room turns.
  await setThemeAndSettle(managerA, "light");
  await dismissTour(managerA);
  await expect(managerA.getByTestId("quilt-board")).toBeVisible({ timeout: 30_000 });

  if ((await strip.getAttribute("data-strip-state")) === "resting") {
    await managerA.screenshot({ path: `${OUT_DIR}/quilt-resting-light.png` });
  }
  await expect(strip).toHaveAttribute("data-strip-state", "your-turn", { timeout: ON_CLOCK_TIMEOUT_MS });
  await managerA.waitForTimeout(1_000);
  await managerA.screenshot({ path: `${OUT_DIR}/quilt-your-turn-light.png` });
  await shootDrawerHalf(managerA, `${OUT_DIR}/quilt-drawer-half-light.png`);

  // If the light resting frame was missed on arrival, draft and catch it now.
  const lightResting = `${OUT_DIR}/quilt-resting-light.png`;
  let lightRestingShot = false;
  for (let attempt = 0; attempt < 4 && !lightRestingShot; attempt += 1) {
    const drafts = strip.getByRole("button", { name: "Draft" });
    if ((await drafts.count()) > 0) {
      await drafts.first().click();
      await expect(managerA.getByTestId("quilt-room").getByTestId("undo-pill")).toBeHidden({ timeout: 10_000 });
    }
    try {
      await expect(strip).toHaveAttribute("data-strip-state", "resting", { timeout: 20_000 });
      await managerA.waitForTimeout(500);
      await managerA.screenshot({ path: lightResting });
      lightRestingShot = true;
    } catch {
      /* loop */
    }
  }
  if (!lightRestingShot) console.log("[shot] light resting never held long enough to photograph");
  console.log(`[shot] wrote the warm quilt's states into ${OUT_DIR}`);
});
