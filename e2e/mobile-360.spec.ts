import { expect, test } from "./support/fixtures";
import { MANAGER_A_STATE } from "./global-setup";

/**
 * The 360px baseline, which nothing in this suite had ever rendered at.
 *
 * Three separate persona panels each logged a narrow-viewport item as UNVERIFIED-VISUAL backlog
 * (Task 3's standings cell, Task 5's disclosure scroll, Task 10's picker grid). `playwright.
 * config.ts` runs one project, Desktop Chrome, so in aggregate no Plan C surface had any
 * narrow-viewport verification at all. Three panels deferring the same check is not three LOWs;
 * it is one missing check, and this is it.
 *
 * ONE context, serial navigations, no realtime and no second manager: this is a smoke spec, not
 * a second copy of the lifecycle spec. What it proves is that each surface fits — the page body
 * never scrolls sideways — and that the control a manager needs on each one is actually on
 * screen rather than pushed off the edge.
 */
const VIEWPORT = { width: 360, height: 740 };

/**
 * The failure this spec exists to catch. A page that overflows horizontally at 360px is a page a
 * phone user has to pan around; `scrollWidth` is measured against the layout viewport rather than
 * `VIEWPORT.width` directly so a scrollbar or a device-pixel rounding difference cannot make this
 * flake. Wide content is allowed to scroll INSIDE its own container — that does not move the
 * document.
 */
async function expectNoHorizontalScroll(page: import("@playwright/test").Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(overflow.scrollWidth, `${where} scrolls sideways at ${VIEWPORT.width}px`).toBeLessThanOrEqual(overflow.clientWidth);
}

test("every Plan C surface fits a 360px phone, with its controls reachable", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MANAGER_A_STATE, viewport: VIEWPORT });
  const page = await context.newPage();

  try {
    // --- Create the league whose NAME is the test input -------------------------------------
    // The defect this spec caught was a grid item's min-content width pushing its track wider
    // than the container, and only a long unbroken name does that. So the league is created
    // FIRST and every card assertion below runs with it present: asserting `/app` fits before
    // anything long exists on it would pass on a fresh database while proving nothing. Public,
    // so `/browse`'s grid — the other half of the same fix — carries the same long name.
    // One long UNBROKEN token, which is the exact min-content stressor the fix is about — and
    // deliberately not containing the words "League name", which would collide with the create
    // form's own field label through a card's "Invite managers for <name>" accessible name.
    const leagueName = `Mobile360UnbrokenOverlongIdentifier${Date.now()}`;
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
    await page.getByText("Start or join another league").click();
    await page.getByLabel("League name", { exact: true }).fill(leagueName);
    await page.getByText(/Advanced settings/).click();
    await page.getByLabel("Who can join").selectOption("public");
    await page.getByRole("button", { name: "Create league" }).click();

    // --- A league home: terms panel and members panel, the two Task 3/8 surfaces ----------
    await expect(page.getByRole("heading", { name: leagueName })).toBeVisible();
    await expect(page.getByRole("list", { name: "Managers" })).toBeVisible();
    await expectNoHorizontalScroll(page, "a league home");

    // --- The invite preview, the surface an invitee actually lands on ---------------------
    await page.getByRole("button", { name: "Create invite link" }).click();
    const invitePath = await page.getByLabel("Invite link").inputValue();
    await expectNoHorizontalScroll(page, "a league home with the invite panel open");

    await page.goto(invitePath);
    await expect(page.getByRole("heading", { name: leagueName })).toBeVisible();
    // The decision this page exists for has to be on screen, not off the right edge.
    await expect(page.getByRole("button", { name: `Join ${leagueName}` })).toBeVisible();
    await expectNoHorizontalScroll(page, "the invite preview");

    // --- The home board, NOW carrying that name in its card grid ---------------------------
    await page.goto("/app");
    // `exact`: the card's action link is named "Invite managers for <league name>", which the
    // default substring match also picks up.
    await expect(page.getByRole("link", { name: leagueName, exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "/app");

    // --- The public browse grid, the second consumer of the same `min-w-0` fix -------------
    await page.goto("/browse");
    await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();
    await expect(page.getByRole("heading", { name: leagueName })).toBeVisible();
    await expectNoHorizontalScroll(page, "/browse");

    // --- The public review feed -----------------------------------------------------------
    await page.goto("/reviews");
    await expect(page.getByRole("heading", { name: "What managers are saying" })).toBeVisible();
    await expectNoHorizontalScroll(page, "/reviews");

    // --- The profile: name, avatar tiles, help level, review composer ----------------------
    await page.goto("/app/profile");
    await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Avatar" })).toBeVisible();
    await expect(page.getByLabel("How much help")).toBeVisible();
    // `exact`: the review composer below this form has its own "Save changes" button, and
    // manager A has already left a review by the time the onboarding spec has run once.
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "/app/profile");
  } finally {
    await context.close();
  }
});
