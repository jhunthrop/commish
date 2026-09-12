import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

/**
 * THE DRAFT AREA, THREE STOPS (the Draft area round, 2026-09-12) — one spec per stop, run in
 * whichever theme `E2E_COLOR_SCHEME` names, photographed at both widths for the ledger.
 *
 * What each test is FOR, rather than what it happens to touch:
 *   1. The Draft tab opens on the board, the switch has three stops, the URL follows the stop,
 *      and there is exactly one solid verb on the page.
 *   2. Amendment 1: the Overall landing carries tier bands, counted in players.
 *   3. Amendment 2: the sheet is the room's own seven columns, reorders by keyboard, and the
 *      reorder survives a reload because it was written to the server.
 *   4. The mock lobby is the third stop and names nobody.
 */
const OUT_DIR = ".superpowers/mocks/screenshots";
const BOARD = "/app/draft/board";
const SHEET = "/app/draft/sheet";
const MOCKS = "/app/draft/mock-drafts";

function theme(): string {
  return process.env.E2E_COLOR_SCHEME ?? "light";
}

/**
 * Player rows inside a 360 by 780 screen on the board, measured on this layout rather than wished
 * for: with the header's verb on the title's line, one row of switch, the scheduled line, the
 * filter bar and the basis wrapped whole onto two lines, FOUR rows land fully inside the screen
 * (measured 2026-09-12; the fifth is cut by the fold). Four is also the floor P10 asks of a
 * comparison list on a phone, so this is both the measurement and the bar — a regression that
 * costs one row fails here rather than quietly spending a margin that does not exist.
 */
const MEASURED_ROWS_AT_360 = 4;

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/draft-${name}-1440-${theme()}.png` });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/draft-${name}-360-${theme()}.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

/**
 * The page's SOLID VERBS — the accent pill with its glow, which is what `Button`/`ButtonLink`
 * give a `verb` and nothing else gives anything (`shadow-verb-glow`). Deliberately not "anything
 * filled `bg-accent`": a chosen filter chip takes Court blue too (`chipClassName`), and counting
 * the position tab a reader has selected as a verb would make this assertion meaningless.
 */
async function solidVerbs(page: Page): Promise<readonly string[]> {
  return page.locator("main a, main button").evaluateAll((nodes) => nodes.filter((node) => node.className.includes("shadow-verb-glow")).map((node) => (node.textContent ?? "").trim()));
}

test("the Draft tab opens on the board, one switch with three stops, one solid verb", async ({ managerA }) => {
  await managerA.setViewportSize({ width: 1440, height: 1000 });
  await managerA.goto("/app/draft");
  await expect(managerA).toHaveURL(/\/app\/draft\/board/);

  // One heading for the whole area: the stop never renames the page.
  await expect(managerA.getByRole("heading", { level: 1, name: "Draft" })).toBeVisible();

  const stops = managerA.getByTestId("view-switch").getByRole("link");
  await expect(stops).toHaveText(["Board", "Your sheet", "Mock drafts"]);
  await expect(stops.nth(0)).toHaveAttribute("aria-current", "page");

  // The one solid verb on both board stops, and it is the same verb in the same place.
  expect(await solidVerbs(managerA)).toEqual(["Run a mock draft"]);

  // The top nav is Leagues, Draft, Wallet. Rooms is gone.
  await expect(managerA.getByRole("navigation", { name: "Commish" }).getByRole("link")).toHaveText(["Leagues", "Draft", "Wallet"]);

  await expect(managerA.locator('[data-testid="board-row"]').first()).toBeVisible({ timeout: 30_000 });

  // The URL follows the stop — asserted before the photographs, so a viewport change mid-test
  // can never be what decided whether the switch navigates.
  await stops.nth(1).click();
  await expect(managerA).toHaveURL(/\/app\/draft\/sheet/);
  await managerA.goBack();
  await expect(managerA.locator('[data-testid="board-row"]').first()).toBeVisible({ timeout: 30_000 });

  // P10 ON A PHONE (fix round 1, H4; measured again in fix round 2 with the basis wrapping in
  // full). The verb shares the title's row instead of taking one of its own, and the list starts
  // inside the first screen rather than below it: MEASURED_ROWS_AT_360 is what this layout
  // actually puts above the fold at 360 by 780, and the old layout put ONE.
  await managerA.setViewportSize({ width: 360, height: 780 });
  await expect(managerA.locator('[data-testid="board-row"]').first()).toBeVisible({ timeout: 30_000 });
  const aboveFold = await managerA.locator('[data-testid="board-row"]').evaluateAll((rows) => rows.filter((row) => row.getBoundingClientRect().bottom <= 780).length);
  expect(aboveFold, "player rows inside the first phone screen").toBeGreaterThanOrEqual(MEASURED_ROWS_AT_360);
  // And the basis is whole: a sentence that says what every number below means is never cut.
  const basisCut = await managerA.locator("main p").filter({ hasText: "roster shape" }).first().evaluate((node) => node.scrollWidth > node.clientWidth + 1);
  expect(basisCut, "the basis is truncated at 360").toBe(false);
  // The verb shares the title's row rather than taking one of its own: three things do not fit
  // 328px, so the two short ones pair and the switch takes the width under them.
  const titleTop = await managerA.getByRole("heading", { level: 1, name: "Draft" }).evaluate((node) => node.getBoundingClientRect().top);
  const verbTop = await managerA.getByRole("link", { name: "Run a mock draft" }).evaluate((node) => node.getBoundingClientRect().top);
  expect(Math.abs(verbTop - titleTop), "the verb takes a row of its own").toBeLessThan(24);
  await managerA.setViewportSize({ width: 1440, height: 1000 });

  await shoot(managerA, "board");
});

test("the four retired surfaces still answer, and they answer with the board", async ({ managerA }) => {
  // M1: these addresses were in the product's own nav and are in browser histories. A 404 is not
  // what a manager who kept one deserves.
  for (const gone of ["/app/draft/simulator", "/app/draft/assistant", "/app/draft/adp", "/app/draft/playbook"]) {
    await managerA.goto(gone);
    await expect(managerA, `${gone} should land on the board`).toHaveURL(/\/app\/draft\/board/);
  }
});

test("one player reads one number on both stops, under one league", async ({ managerA }) => {
  // H3: the two stops compute the same named quantity, and used to compute it under different
  // rules with no control on the sheet — one tap on the switch changed every number on screen.
  await managerA.setViewportSize({ width: 1440, height: 1000 });
  await managerA.goto(BOARD);
  const firstRow = managerA.locator('[data-testid="board-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const name = (await firstRow.getByTestId("pool-player-name").textContent())?.trim() ?? "";
  const onBoard = (await firstRow.getByTestId("big-number").locator("> span").first().textContent())?.trim() ?? "";
  expect(name).not.toBe("");

  await managerA.getByTestId("view-switch").getByRole("link", { name: "Your sheet" }).click();
  await expect(managerA.locator('[data-testid="sheet-row"]').first()).toBeVisible({ timeout: 60_000 });
  const onSheet = managerA.locator('[data-testid="sheet-column"][data-column="overall"] [data-testid="sheet-row"]').filter({ hasText: name.split(" ")[0]! }).first();
  await expect(onSheet).toContainText(onBoard);
});

test("Overall carries tier bands counted in players, and the $ board carries none", async ({ managerA }) => {
  await managerA.setViewportSize({ width: 1440, height: 1000 });
  await managerA.goto(`${BOARD}?league=generic`);
  await expect(managerA.locator('[data-testid="board-row"]').first()).toBeVisible({ timeout: 30_000 });

  // AMENDMENT 1: the landing the Draft tab opens on has bands, they count PLAYERS (a band across
  // positions is not about a position), and no band holds one man.
  const bands = managerA.locator("[data-grade]");
  expect(await bands.count()).toBeGreaterThan(1);
  await expect(bands.first()).toContainText("players left before a");
  expect(await bands.first().textContent()).not.toContain("one player left");

  // The $ board re-sorts by dollars, and a band drawn over an order it was not computed in would
  // be a lie, so it keeps none.
  await managerA.getByLabel("$ board").check();
  expect(await managerA.locator("[data-grade]").count()).toBe(0);
  await managerA.getByLabel("$ board").uncheck();

  // A position tab keeps its own ladder, counted in that position.
  await managerA.getByRole("button", { name: "RB", exact: true }).click();
  await expect(managerA.locator("[data-grade]").first()).toContainText("RB left");
});

test("Your sheet is the room's own seven columns, and a keyboard reorder is written to the server", async ({ managerA }) => {
  test.setTimeout(120_000);
  await managerA.setViewportSize({ width: 1440, height: 1000 });
  await managerA.goto(SHEET);
  await expect(managerA.getByRole("heading", { level: 1, name: "Draft" })).toBeVisible();

  // A sheet to work on. A manager with none starts one through the same door a real one would,
  // then seeds it from the board — this spec never writes a fixture behind the product's back.
  if ((await managerA.getByRole("button", { name: "Start my sheet" }).count()) > 0) {
    await managerA.getByRole("button", { name: "Start my sheet" }).click();
    await managerA.getByLabel("Sheet name").fill("E2E sheet");
    await managerA.getByRole("button", { name: "Save" }).click();
  }
  const seed = managerA.getByRole("button", { name: "Seed from board" });
  await expect(seed).toBeVisible({ timeout: 30_000 });
  if ((await managerA.locator('[data-testid="sheet-row"]').count()) === 0) {
    managerA.once("dialog", (dialog) => void dialog.accept());
    await seed.click();
  }
  const rows = managerA.locator('[data-testid="sheet-row"]');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });

  // AMENDMENT 2: it is the room's component. Seven columns, the strip, the sticky bands.
  await expect(managerA.getByTestId("sheet-scroller")).toBeVisible();
  expect(await managerA.locator('[data-testid="sheet-column"]').count()).toBe(7);
  await expect(managerA.getByTestId("column-strip")).toBeVisible();

  // And the room-only affordances are absent: no Hide taken, no jump, no queue verb.
  expect(await managerA.getByTestId("hide-taken").count()).toBe(0);
  expect(await managerA.getByRole("button", { name: "Next open tier ↓" }).count()).toBe(0);
  expect(await managerA.getByRole("button", { name: /^Queue / }).count()).toBe(0);

  // The row's one number is the board's ranking key, with its basis stated once above.
  await expect(managerA.getByTestId("sheet-basis")).toContainText("points over a replacement at his position");

  // Start from the board's own order whatever a previous run left behind, so what follows is an
  // assertion about THIS move rather than about the state of a shared database. The reload is
  // not ceremony: it settles the reset's own refresh before the next write goes out, and a
  // second write racing an in-flight refresh is a flake nobody would learn anything from.
  const match = managerA.getByRole("button", { name: "Match our board" });
  if ((await match.count()) > 0) {
    await match.click();
    // Polled through a RELOAD rather than waited on in place: restoring two hundred ranks is a
    // real transaction, and this assertion is about the server having taken the write, not about
    // how fast one client transition repaints.
    await expect
      .poll(
        async () => {
          await managerA.reload();
          await expect(managerA.locator('[data-testid="sheet-row"]').first()).toBeVisible({ timeout: 60_000 });
          return (await managerA.getByTestId("sheet-basis").textContent()) ?? "";
        },
        { timeout: 90_000, intervals: [1_000, 2_000, 3_000, 5_000, 5_000, 5_000] },
      )
      .toContain("Our board, untouched");
  }

  const overall = managerA.locator('[data-testid="sheet-column"][data-column="overall"]');
  const secondName = await overall.locator('[data-testid="sheet-row"]').nth(1).getAttribute("data-player-id");

  // The reorder control: the row swaps its number for its controls when a pointer is over it or
  // the keyboard has tabbed into it (the room's own rule, kept), so the row is hovered first.
  // The write is awaited as a RESPONSE rather than inferred from the list repainting, so a slow
  // repaint and a lost write can never be mistaken for each other.
  const second = overall.locator('[data-testid="sheet-row"]').nth(1);
  await second.hover();
  const [written] = await Promise.all([
    managerA.waitForResponse((response) => response.url().includes("/entries") && response.request().method() === "PUT", { timeout: 30_000 }),
    second.getByRole("button", { name: /^Move .* up your sheet$/ }).click(),
  ]);
  expect(written.ok()).toBe(true);

  // It was a SERVER write, not client state: it survives a reload, and the basis says so.
  await managerA.reload();
  await expect(managerA.locator('[data-testid="sheet-row"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(overall.locator('[data-testid="sheet-row"]').first()).toHaveAttribute("data-player-id", secondName ?? "");
  await expect(managerA.getByTestId("sheet-basis")).toContainText("of yours moved");
  await expect(managerA.getByRole("button", { name: "Match our board" })).toBeVisible();

  expect(await solidVerbs(managerA)).toEqual(["Run a mock draft"]);

  // H2: the note, the tag and taking a man off are back, on the row they are about, and they are
  // server writes like every other edit on this sheet.
  const top = overall.locator('[data-testid="sheet-row"]').first();
  const topName = (await top.locator("span[title]").first().getAttribute("title")) ?? "";
  await top.hover();
  await top.getByRole("button", { name: `Notes and tags for ${topName}` }).click();
  const panel = top.getByTestId("sheet-row-marks");
  await expect(panel).toBeVisible();
  const note = panel.getByLabel(`Note on ${topName}`);
  await note.fill("Taking him at 1.01");
  const [noteWritten] = await Promise.all([
    managerA.waitForResponse((response) => response.url().includes("/entries") && response.request().method() === "POST", { timeout: 30_000 }),
    note.blur(),
  ]);
  expect(noteWritten.ok()).toBe(true);
  await managerA.reload();
  await expect(managerA.locator('[data-testid="sheet-row"]').first()).toContainText("Taking him at 1.01", { timeout: 60_000 });

  await shoot(managerA, "sheet");
});

test("Mock drafts is the third stop, names nobody, and its verb sits with the table it acts on", async ({ managerA, managerB }) => {
  test.setTimeout(120_000);

  // A REAL ROOM TO LIST. The headline of this stop is rooms other people are waiting in, so
  // another manager opens one through the product's own door rather than a row being written
  // into the database behind the page's back.
  await managerB.goto(MOCKS);
  await managerB.getByRole("button", { name: "Open lobby" }).click();
  await expect(managerB).toHaveURL(/\/app\/drafts\//, { timeout: 60_000 });

  await managerA.setViewportSize({ width: 1440, height: 1000 });
  await managerA.goto(MOCKS);
  await expect(managerA.getByRole("heading", { level: 1, name: "Draft" })).toBeVisible();
  await expect(managerA.getByTestId("view-switch").getByRole("link", { name: "Mock drafts" })).toHaveAttribute("aria-current", "page");

  // The stop's one solid verb is the one inside the Against bots door.
  expect(await solidVerbs(managerA)).toEqual(["Start mock draft"]);
  await expect(managerA.getByRole("region", { name: "Against bots" }).getByRole("button", { name: "Start mock draft" })).toBeVisible();
  await expect(managerA.getByTestId("table-chip-teams")).toBeVisible();
  await expect(managerA.getByTestId("table-chip-clock")).toBeVisible();

  // The room somebody else opened is listed, and NOBODY on it is named — the seats and a count
  // of people, never a face or an initial (`MockRoomSummary`'s own disclosure contract).
  const row = managerA.getByTestId("filling-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("waiting");
  await expect(row).toContainText("seconds a pick");
  await expect(row).toContainText("or sooner if it fills");
  // M4: at one of twelve the stack is a barcode that says nothing the count does not, so it is
  // not drawn at all. The number carries the fact and names its own basis.
  expect(await row.getByTestId("seat-stack").count()).toBe(0);
  await expect(row.getByTestId("big-number")).toContainText("seats left, of ");
  await expect(row.getByRole("button", { name: "Take a seat" })).toBeVisible();
  expect(await managerA.getByTestId("manager-stack").count()).toBe(0);

  // The old address still opens the room it always did.
  await managerA.goto("/app/mock-drafts");
  await expect(managerA).toHaveURL(/\/app\/draft\/mock-drafts/);

  await shoot(managerA, "mocks");
});
