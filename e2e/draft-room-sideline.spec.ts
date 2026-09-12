import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { MOCK_CONFIG } from "../src/mock-draft/config";
import { expect, test } from "./support/fixtures";

/**
 * THE SIDELINE DRAFT ROOM (founder rulings 2026-09-10, first principles §7), walked in a real
 * solo mock with paced bots at desktop and phone width, in the theme the run asked for
 * (`E2E_COLOR_SCHEME`). Two kinds of proof, as `league-front.spec.ts` set the pattern:
 *
 * 1. Assertions on what the rulings demand. The wall is faces on a grid; the stream rests as
 *    the rail; the dock carries the room's ONE solid pill, and only on your clock (P3); Your
 *    sheet is seven columns with taken players struck in place and a Hide taken switch; a pick
 *    lands as one cell with an entrance; the phone never scrolls sideways (P10).
 * 2. Pictures for the persona panel and the ledger, into `.superpowers/mocks/screenshots/`.
 *
 * The room is created through the mock-draft API rather than the lobby: this spec is about the
 * room, and `mock-draft.spec.ts` already walks the lobby.
 */
const OUT_DIR = ".superpowers/mocks/screenshots";
const TEAM_COUNT = 10;
const PICK_SECONDS = 90;
/** Every bot before the last seat picks once (paced), plus slack for the room to open. */
const ON_CLOCK_TIMEOUT_MS = (TEAM_COUNT + 1) * (MOCK_CONFIG.botDelay.baseMs + MOCK_CONFIG.botDelay.jitterMs) + 30_000;
const theme = process.env.E2E_COLOR_SCHEME ?? "light";

async function openSoloRoom(page: Page): Promise<string> {
  const created = await page.request.post("/api/mock-drafts", { data: { mode: "solo", teamCount: TEAM_COUNT, pickSeconds: PICK_SECONDS, draftSlot: TEAM_COUNT } });
  const body = (await created.json()) as { readonly ok: boolean; readonly data?: { readonly draftId: string } };
  if (!body.ok || body.data === undefined) throw new Error(`[e2e] could not open a solo mock: ${JSON.stringify(body)}`);
  await page.goto(`/app/drafts/${body.data.draftId}`);
  const gotIt = page.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();
  return body.data.draftId;
}

/** The first pool row's caption under its figure stands on one line (fix round 2). */
async function expectOneLineCaption(page: Page): Promise<void> {
  const caption = page.getByTestId("pool-row").first().getByTestId("big-number").locator("span").last();
  const box = (await caption.boundingBox())!;
  const lineHeight = await caption.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(box.height, "the pool row's caption wraps").toBeLessThanOrEqual(lineHeight * 1.5);
}

/** Every visible solid Court blue pill: P3 allows one per viewport. */
async function solidPillCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a")).filter((node) => {
      const rect = node.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
      return visible && node.className.split(" ").includes("bg-accent");
    }).length,
  );
}

test("the wall, the rail, the dock's one verb, your sheet, and a pick landing as one cell, at desktop width", async ({ managerA }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 1440, height: 900 });
  await openSoloRoom(managerA);

  const strip = managerA.getByTestId("top-strip");
  await expect(managerA.getByTestId("quilt-room")).toBeVisible();
  // The stream rests as the rail on a fresh browser (ruling 2).
  await expect(managerA.getByTestId("stream-rail")).toBeVisible();
  await expect(managerA.getByTestId("board-region")).toHaveAttribute("data-view", "wall");

  // The last seat: nine bots pick around us first, then the room turns to us.
  await expect(strip).toHaveAttribute("data-turn", "yours", { timeout: ON_CLOCK_TIMEOUT_MS });
  await expect(managerA.getByTestId("quilt-pick-cell")).toHaveCount(TEAM_COUNT - 1);
  // Picks are faces on the grid (P1): every landed cell in the active round carries the club ring.
  expect(await managerA.getByTestId("quilt-pick-cell").locator("[data-testid='player-face-team']").count()).toBe(TEAM_COUNT - 1);
  // The dock's Draft is the room's one solid pill, named for our call (rulings 3, P3).
  const verb = managerA.getByTestId("dock-verb");
  await expect(verb).toBeVisible();
  await expect(verb).toHaveText(/^Draft .+/);
  expect(await solidPillCount(managerA)).toBe(1);
  await expect(managerA.getByTestId("dock-call").getByTestId("big-number")).toBeVisible();
  await expectOneLineCaption(managerA);
  // Every survival figure is a whole percentage with the pick beneath it (founder ruling
  // 2026-09-12); the replay count is nowhere on a row.
  await expect(managerA.getByTestId("pool-row").first().getByTestId("big-number")).toHaveText(/^\d+%still there at \d+\.\d\d$/);
  await expect(managerA.getByTestId("dock-call").getByTestId("big-number")).toHaveText(/^\d+%still there at \d+\.\d\d$/);
  // A pool row's Draft reveals on hover only (review H3): at rest the viewport holds one verb.
  const firstPoolRow = managerA.getByTestId("pool-row").first();
  await expect(firstPoolRow.getByRole("button", { name: /^Draft / })).toBeHidden();
  await firstPoolRow.hover();
  await expect(firstPoolRow.getByRole("button", { name: /^Draft / })).toBeVisible();
  await managerA.mouse.move(0, 0);
  await managerA.waitForTimeout(400);
  await managerA.screenshot({ path: `${OUT_DIR}/draft-room-wall-desktop-${theme}.png` });

  // YOUR SHEET (ruling 1): seven columns of up to fifty in your order, taken players struck.
  await managerA.getByRole("tab", { name: "Your sheet" }).click();
  await expect(managerA.getByTestId("board-region")).toHaveAttribute("data-view", "sheet");
  await expect(managerA.getByTestId("sheet-column")).toHaveCount(7);
  const overall = managerA.getByTestId("sheet-column").filter({ has: managerA.getByRole("heading", { name: /^Overall/ }) });
  await expect(overall.getByTestId("sheet-row").and(managerA.locator("[data-taken='true']")).first()).toBeVisible();
  await expect(managerA.getByTestId("sheet-basis")).toContainText("Our board, untouched");
  await expect(managerA.getByTestId("sheet-basis")).toContainText(/share of \d+ replays with him still there at/);
  await expect(managerA.getByTestId("advisor-odds-share").first()).toContainText(/^\d+%/);
  await managerA.waitForTimeout(400);
  await managerA.screenshot({ path: `${OUT_DIR}/draft-room-sheet-desktop-${theme}.png` });
  await managerA.getByTestId("hide-taken").check();
  await expect(overall.locator("[data-taken='true']")).toHaveCount(0);
  await managerA.getByTestId("hide-taken").uncheck();

  // THE STREAM opens from the rail, with the field in reach, and folds back.
  await managerA.getByRole("button", { name: "Open the room" }).click();
  await expect(managerA.getByTestId("room-stream")).toHaveAttribute("data-width", "open");
  await expect(managerA.getByLabel("Message")).toBeVisible();
  await expect(managerA.getByTestId("pick-celebration")).toBeVisible();
  await managerA.waitForTimeout(300);
  await managerA.screenshot({ path: `${OUT_DIR}/draft-room-stream-open-desktop-${theme}.png` });
  await managerA.getByRole("button", { name: "Collapse the room" }).click();
  await expect(managerA.getByTestId("stream-rail")).toBeVisible();
  await managerA.getByRole("tab", { name: "Wall" }).click();

  // THE PICK: Draft opens the undo window, the pick leaves when it expires, and lands on the
  // wall as your own cell with the celebration-scale entrance.
  await verb.click();
  await expect(managerA.getByTestId("undo-pill")).toBeVisible();
  await expect(managerA.getByTestId("undo-pill")).toBeHidden({ timeout: 10_000 });
  const mine = managerA.locator("[data-testid='quilt-pick-cell'][data-mine='true']");
  await expect(mine.first()).toBeVisible({ timeout: 15_000 });
  await expect(mine.first()).toHaveAttribute("data-landing", "self");
  await managerA.screenshot({ path: `${OUT_DIR}/draft-room-landed-desktop-${theme}.png` });
});

test("the phone keeps the stream as the screen, pins the one verb, and never scrolls sideways", async ({ managerA }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 360, height: 740 });
  await openSoloRoom(managerA);

  await expect(managerA.getByTestId("phone-room")).toBeVisible();
  await expect(managerA.getByTestId("room-stream")).toHaveAttribute("data-width", "page");
  await expect(managerA.getByTestId("top-strip")).toHaveAttribute("data-turn", "yours", { timeout: ON_CLOCK_TIMEOUT_MS });
  const verb = managerA.getByTestId("phone-call").getByTestId("dock-verb");
  await expect(verb).toBeVisible();
  await expect(verb).toBeInViewport();
  expect(await solidPillCount(managerA)).toBe(1);

  // P10: the page never scrolls sideways at the product's minimum viewport.
  const scroll = await managerA.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll[0], "the phone room scrolls sideways").toBeLessThanOrEqual(scroll[1]! + 1);
  await expectOneLineCaption(managerA);
  await managerA.waitForTimeout(400);
  await managerA.screenshot({ path: `${OUT_DIR}/draft-room-wall-phone-${theme}.png`, fullPage: false });

  await managerA.getByRole("tab", { name: "Your sheet" }).click();
  await expect(managerA.getByTestId("sheet-column").first()).toBeVisible();
  await managerA.waitForTimeout(400);
  await managerA.screenshot({ path: `${OUT_DIR}/draft-room-sheet-phone-${theme}.png`, fullPage: false });

  // Two-step picking on the phone: the pinned verb opens the confirm sheet, never a pick.
  await verb.click();
  await expect(managerA.getByRole("dialog", { name: /Confirm your pick/ })).toBeVisible();
  await managerA.getByRole("button", { name: "Confirm pick" }).click();
  await expect(managerA.getByTestId("undo-pill")).toBeVisible();
});
