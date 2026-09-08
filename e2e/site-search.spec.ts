import type { Locator, Page } from "@playwright/test";
import { MANAGER_A_STATE } from "./global-setup";
import { expect, test } from "./support/fixtures";

/**
 * SITE SEARCH AND THE TEAM PAGE (site search round, 2026-09-08) — against the real running app,
 * the real board in the dev database and a real WorkOS session.
 *
 * The universe is the served board, so the names typed here are real board players and a real
 * club: Jahmyr Gibbs (DET, `4429795`) and the Lions. Nothing is seeded by this spec; if the dev
 * database's board ever stops carrying Detroit, the first assertion says so in plain words.
 *
 * A player result opens in the league the reader's links belong to (`shell-leagues.tsx`): manager
 * A stands on `/app`, so that is the first league in the rail, whichever the seed made it. The
 * assertion is on the player's own id at the end of the path, not on any league id.
 */

const OUT_DIR = ".superpowers/mocks/screenshots";
const GIBBS_ID = "4429795";
const PLACEHOLDER = "Search players and teams";
/** A dossier miss builds the peek document on the request path; a cold one can take a while. */
const PLAYER_PAGE_TIMEOUT_MS = 60_000;

/**
 * Presses `/` until the palette answers. `goto` resolves on the load event, and the key listener
 * only exists once the client tree has hydrated a beat later — a person arrives after that, a
 * script does not, so the press is retried the way the quilt spec retries its just-mounted start
 * button. The product's own rule (no editable focused, no modifier) is unchanged by this.
 */
async function openWithSlash(page: Page): Promise<Locator> {
  const field = page.getByRole("combobox", { name: PLACEHOLDER });
  await expect(async () => {
    await page.keyboard.press("/");
    await expect(field).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return field;
}

/** Waits until every headshot in the open palette has finished loading (or failed and fallen back
 *  to initials), so a photograph shows faces rather than the rings a fresh request leaves. */
async function headshotsSettled(page: Page): Promise<void> {
  await expect
    .poll(async () => page.locator("[role=option] img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)), { timeout: 15_000 })
    .toBe(true);
  expect(await page.locator("[role=option] img").count()).toBeGreaterThan(0);
}

test("opens with /, lists a partial name, arrows down and lands on the player's page on Enter", async ({ managerA }) => {
  await managerA.goto("/app");
  const field = await openWithSlash(managerA);
  await field.fill("Jahmy");
  const first = managerA.getByRole("option").first();
  await expect(first).toContainText("Jahmyr Gibbs");
  await managerA.keyboard.press("ArrowDown");
  await managerA.keyboard.press("Enter");
  await expect(managerA).toHaveURL(new RegExp(`/app/leagues/[^/]+/players/${GIBBS_ID}$`), { timeout: PLAYER_PAGE_TIMEOUT_MS });
  await expect(managerA.getByRole("heading", { level: 1, name: "Jahmyr Gibbs" })).toBeVisible({ timeout: PLAYER_PAGE_TIMEOUT_MS });
});

test("finds the Lions by nickname, lands on the team page, and follows a roster row to his page", async ({ managerA }) => {
  await managerA.setViewportSize({ width: 1440, height: 900 });
  await managerA.goto("/app");
  await managerA.getByRole("button", { name: PLACEHOLDER }).click();
  const field = managerA.getByRole("combobox", { name: PLACEHOLDER });
  await field.fill("Lions");
  const first = managerA.getByRole("option").first();
  await expect(first).toContainText("Detroit Lions");
  await expect(first).toContainText("Team");
  await headshotsSettled(managerA);
  await managerA.screenshot({ path: `${OUT_DIR}/search-desktop.png` });
  await managerA.keyboard.press("Enter");
  await expect(managerA).toHaveURL(/\/app\/teams\/DET$/);
  await expect(managerA.getByRole("heading", { level: 1, name: "Detroit Lions" })).toBeVisible();
  for (const title of ["Coaches", "Offense profile", "Fantasy players", "Depth chart", "Target and touch competition", "Schedule", "Defense"]) {
    await expect(managerA.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }
  await managerA.screenshot({ path: `${OUT_DIR}/team-page-desktop.png`, fullPage: true });
  await managerA.getByRole("list", { name: "Fantasy players" }).getByRole("link", { name: "Jahmyr Gibbs" }).click();
  await expect(managerA).toHaveURL(new RegExp(`/app/leagues/[^/]+/players/${GIBBS_ID}$`), { timeout: PLAYER_PAGE_TIMEOUT_MS });
});

test("says in those words that nothing matches, and the other spelling of a club redirects", async ({ managerA }) => {
  await managerA.goto("/app");
  const field = await openWithSlash(managerA);
  await field.fill("zzqx");
  await expect(managerA.getByRole("status")).toHaveText("No player or team matches that.");
  await managerA.keyboard.press("Escape");
  await expect(managerA.getByRole("dialog")).toHaveCount(0);
  await managerA.goto("/app/teams/LA");
  await expect(managerA).toHaveURL(/\/app\/teams\/LAR$/);
});

test("on a phone the header's icon opens a full-screen search and the team page stacks", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MANAGER_A_STATE, viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  try {
    await page.goto("/app");
    await page.getByRole("button", { name: PLACEHOLDER }).click();
    const field = page.getByRole("combobox", { name: PLACEHOLDER });
    await expect(field).toBeFocused();
    await field.fill("Lions");
    await expect(page.getByRole("option").first()).toContainText("Detroit Lions");
    const dialog = page.getByRole("dialog", { name: "Search" });
    const box = await dialog.boundingBox();
    expect(box?.width).toBe(360);
    await headshotsSettled(page);
    await page.screenshot({ path: `${OUT_DIR}/search-phone.png` });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/teams\/DET$/);
    await expect(page.getByRole("heading", { level: 1, name: "Detroit Lions" })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `${OUT_DIR}/team-page-phone.png`, fullPage: true });
  } finally {
    await context.close();
  }
});
