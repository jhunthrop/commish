import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { overflowAt } from "./support/overflow";

/**
 * THE PLAYER PAGE AND THE PEEK ON SIDELINE (research surfaces round, 2026-09-10). The two are one
 * header and one composition: the face at 132, his name largest, who has him as a person, one big
 * number with its basis, one verb. The peek rides `Modal`, which is a bottom sheet on a phone and a
 * centred card on a desktop, so the two surfaces cannot drift.
 *
 * The universe is the real board in the dev database and a real WorkOS session. The player is
 * reached the way a manager reaches him: by typing a partial name into site search. Jahmyr Gibbs
 * (DET, `4429795`) is the same real board player `site-search.spec.ts` walks, so if the dev board
 * ever stops carrying Detroit both specs say so in the same plain words.
 */
const OUT_DIR = ".superpowers/mocks/screenshots";
const GIBBS_ID = "4429795";
const PLACEHOLDER = "Search players and teams";
/** A dossier miss builds the peek document on the request path; a cold one can take a while. */
const PAGE_TIMEOUT_MS = 60_000;

function theme(): string {
  return process.env.E2E_COLOR_SCHEME ?? "light";
}

/** Presses `/` until the palette answers — the key listener exists only once the client tree has
 *  hydrated, and a script arrives before a person would. */
async function openSearch(page: Page) {
  const field = page.getByRole("combobox", { name: PLACEHOLDER });
  await expect(async () => {
    await page.keyboard.press("/");
    await expect(field).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return field;
}

async function gotoGibbs(page: Page): Promise<void> {
  await page.goto("/app");
  const field = await openSearch(page);
  await field.fill("Jahmy");
  await expect(page.getByRole("option").first()).toContainText("Jahmyr Gibbs");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/players/${GIBBS_ID}$`), { timeout: PAGE_TIMEOUT_MS });
  await expect(page.getByRole("heading", { level: 1, name: "Jahmyr Gibbs" })).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
}

test("the player page leads with his face, one number with its basis, and one verb, at desktop width", async ({ managerA }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 1440, height: 1000 });
  await gotoGibbs(managerA);

  const header = managerA.locator("header").filter({ hasText: "Jahmyr Gibbs" }).first();

  // P1: the face is the hero, at 132, on his club's ring.
  const face = header.locator('[data-testid="player-face-team"]').first();
  await expect(face).toBeVisible();
  const size = await face.evaluate((node) => Math.round(node.getBoundingClientRect().width));
  expect(size, "the hero face is 132 with its 2px club ring").toBe(132);

  // P2/P11: one figure larger than body text in the header, and its caption names the basis.
  expect(await header.getByTestId("big-number").count()).toBe(1);
  await expect(header.getByTestId("big-number")).toContainText(/Projected for the season|under this league's scoring/);

  // P1/P6: who has him is stated as a person or as an honest absence, never left blank.
  await expect(header.getByTestId("player-owner").or(header.getByText(/Free agent in this league|^On /)).first()).toBeVisible();

  // P3: exactly one solid Court blue call to action inside the surface. Measured on `main`, and
  // excluding segmented controls: the shell rail's own active crest and a selected segment both
  // fill with the accent, and neither is a verb — one is navigation the shell owns, the other is a
  // STATE. Counting them would make every screen in the product fail a principle about buttons.
  const solid = await managerA.evaluate(() =>
    Array.from(document.querySelectorAll("main button, main a")).filter((node) => {
      const rect = node.getBoundingClientRect();
      const visible = rect.width > 0 && rect.top < window.innerHeight && rect.bottom > 0;
      return visible && node.className.split(" ").includes("bg-accent") && node.closest('[role="group"]') === null;
    }).length,
  );
  expect(solid, "the player page carries exactly one verb").toBe(1);

  await managerA.screenshot({ path: `${OUT_DIR}/player-page-desktop-${theme()}.png`, fullPage: false });
});

test("the player page fits a phone without scrolling sideways", async ({ managerA }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 360, height: 740 });
  await gotoGibbs(managerA);
  await expect(managerA.getByTestId("big-number").first()).toBeVisible();

  // P10 AT 360px, measured honestly: a clipped `truncate` cell is not overflow, and the shell's own
  // header is not this surface's debt. `overflowAt` separates the two — see its own docblock.
  const overflow = await overflowAt(managerA);
  test.info().annotations.push({ type: "page-scroll", description: `${overflow.scroll}px of document overflow, shell included` });
  expect(overflow.offenders, "the player page sticks out past a 360px viewport").toEqual([]);

  await managerA.screenshot({ path: `${OUT_DIR}/player-page-phone-${theme()}.png`, fullPage: false });
});

/**
 * THE PEEK IS THE SAME HEADER (research surfaces round). Pressing a player's name anywhere in a
 * league raises it; on a desktop it is a centred dialog over a blurred ground, on a phone the same
 * dialog is pinned to the foot of the viewport, which is the bottom sheet the founder asked for.
 */
test("a name in the league raises the peek as a dialog carrying the same header", async ({ managerA }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 1440, height: 1000 });
  await gotoGibbs(managerA);
  const leagueId = new URL(managerA.url()).pathname.split("/")[3]!;

  await managerA.goto(`/app/leagues/${leagueId}/team`);
  const name = managerA.locator('main button:not([disabled])').filter({ hasText: /\w+ \w+/ }).first();
  await expect(name).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  await name.click();

  const sheet = managerA.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  // The same header the page draws: one figure with its basis, and a way through to the full page.
  await expect(sheet.getByTestId("big-number").first()).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  await expect(sheet.getByRole("link", { name: "Full page" })).toBeVisible();

  // On a desktop it is a card in the middle of the viewport, not a strip along the bottom edge.
  const box = (await sheet.boundingBox())!;
  expect(box.y, "a desktop peek is not pinned to the foot of the screen").toBeGreaterThan(0);

  await managerA.screenshot({ path: `${OUT_DIR}/player-peek-desktop-${theme()}.png`, fullPage: false });

  // The same dialog on a phone is the bottom sheet: pinned to the foot, capped, scrolling inside.
  await managerA.setViewportSize({ width: 360, height: 740 });
  const phoneBox = (await sheet.boundingBox())!;
  // Within a pixel of the foot: a sub-pixel layout rounding is not a design claim, and asserting an
  // exact 740 is the brittleness that already makes one older search assertion flake on this suite.
  expect(Math.abs(phoneBox.y + phoneBox.height - 740), "a phone peek sits on the foot of the viewport").toBeLessThanOrEqual(2);
  await managerA.screenshot({ path: `${OUT_DIR}/player-peek-phone-${theme()}.png`, fullPage: false });
});
