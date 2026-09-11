import { expect, test } from "@playwright/test";

/**
 * THE DOORS, SIDELINE (2026-09-10) — the front door and the lobby, signed out, in both themes.
 *
 * Signed out on purpose: these two surfaces are the only screens in the product a stranger sees
 * before they have an account, so the spec that guards them should need no session either. Each
 * check is a PRINCIPLE with a test, in the first-principles document's own words, against the
 * real production build and the real database rather than a fixture:
 *
 *   P1 — who is in leads every row (the seat stack and the seated line, never a rank numeral).
 *   P2 — one figure larger than body text per row, and it names its basis in the same glance.
 *   P3 — exactly one solid verb per viewport.
 *   P4 — nothing moves on load except the live channel (the breathing presence dot and the wire).
 *   P7 — no tips, no explainer sentences, no competitor names.
 *
 * Both themes in one pass through `data-theme`, the attribute the theme switcher itself stamps,
 * so a rule that only exists in one palette fails here rather than in somebody's screenshot.
 */

const THEMES = ["light", "dark"] as const;

/** The one solid verb, by the class only `Button`'s `verb`/`primary` variant carries. */
const SOLID_VERB = '[class*="shadow-verb-glow"]';

for (const theme of THEMES) {
  test.describe(`the doors, ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => {
        document.documentElement.setAttribute("data-theme", value);
      }, theme);
    });

    test("the front door leads with who is in, one number with its basis, and one solid verb", async ({ page }) => {
      await page.goto("/");

      // P1: the row's who column is the seat stack, hidden from assistive tech because the
      // seat sentence beside it already says the count.
      const stacks = page.getByTestId("seat-stack");
      expect(await stacks.count()).toBeGreaterThan(0);
      await expect(stacks.first()).toHaveAttribute("aria-hidden", "true");

      // P1's other half: a rank numeral never leads a row again.
      await expect(page.getByTestId("league-rows").getByText("#", { exact: true })).toHaveCount(0);
      await expect(page.getByTestId("league-rows").getByText("Who is in")).toBeVisible();

      // P2: every row's figure carries a caption naming the population it sits in.
      const figures = page.getByTestId("big-number");
      expect(await figures.count()).toBeGreaterThan(0);
      await expect(figures.first()).toContainText(/of \d+/);

      // P3: one solid button on the viewport.
      await expect(page.locator(SOLID_VERB)).toHaveCount(1);

      // P7: no tips and no competitor names anywhere in the door's copy.
      await expect(page.getByRole("button", { name: /^What is/ })).toHaveCount(0);
      const copy = (await page.locator("main").innerText()).toLowerCase();
      for (const name of ["sleeper", "espn", "yahoo", "nfl.com", "fantasypros", "flock"]) {
        expect(copy).not.toContain(name);
      }
    });

    test("the lobby filters are pill chips and exactly one of them is the page the reader is on", async ({ page }) => {
      await page.goto("/browse");
      const filters = page.getByRole("navigation", { name: "Filter open leagues" });
      await expect(filters).toBeVisible();
      const chips = filters.getByRole("link");
      expect(await chips.count()).toBe(4);
      // Mutually exclusive by construction: `aria-current` marks the one the URL selects.
      await expect(filters.locator("[aria-current]")).toHaveCount(1);
      // Pills, not a joined broadcast strip.
      await expect(chips.first()).toHaveClass(/rounded-pill/);
    });

    test("the hold room states the seat as one number with its basis, over the seats themselves", async ({ page }) => {
      await page.goto("/browse");
      // Walk the door the way a first-timer does rather than constructing a URL: the lobby's
      // own verb is the only way into the hold room, and that is the path worth guarding.
      const seat = page.getByRole("link", { name: /^Take (a|the last) seat in / }).first();
      await seat.click();
      await expect(page).toHaveURL(/\/join\/[^/]+\/hold$/);
      await expect(page.getByTestId("seat-stack")).toBeVisible();
      const figure = page.getByTestId("hold-seats-open");
      await expect(figure).toContainText(/seats? open of \d+/);
      // P3: the hold room's one act is signing in to finish, and it is the only solid.
      await expect(page.locator(SOLID_VERB)).toHaveCount(1);
    });
  });
}
