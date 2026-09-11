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

      // P2: every ROW's figure carries a caption naming the population it sits in. Scoped to
      // the board: the hero's own figure ("21 seats taken across the 8 open rooms below") names
      // its population in words rather than digits, which is just as honest and is not this
      // assertion's subject.
      const figures = page.getByTestId("league-rows").getByTestId("big-number");
      expect(await figures.count()).toBeGreaterThan(0);
      for (const figure of await figures.all()) {
        await expect(figure).toContainText(/seats? left of \d+/);
      }

      // P3, COUNTED PER REGION rather than per page (fix round 1, H1).
      //
      // A page-wide count of 1 was green only by accident of seed data, and was going to go red
      // in CI with no code change: while `featuredFillingLeague` excluded every rolled room,
      // nothing on the board was featured and the header's standing doorway was the page's only
      // solid. The moment a fresh filling room exists, the featured room takes a solid in BOTH
      // renderings of the board — the desktop row and the phone card, which are both in the DOM
      // at every width with CSS deciding which is visible — and a page-wide count sees two.
      //
      // The rule the design actually states is one per region: the header carries at most its
      // one standing doorway, and each rendering of the board features at most one room.
      for (const region of [page.getByRole("banner"), page.getByTestId("league-rows"), page.getByTestId("league-cards")]) {
        expect(await region.locator(SOLID_VERB).count()).toBeLessThanOrEqual(1);
      }
      // And the two never shout together: the header pill goes quiet the moment a room is
      // featured, so the visible viewport carries exactly one solid either way.
      const featuredRows = await page.getByTestId("league-rows").locator(SOLID_VERB).count();
      expect(await page.getByRole("banner").locator(SOLID_VERB).count()).toBe(featuredRows === 1 ? 0 : 1);

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
      // The row's verb is a BUTTON that opens the join sheet, not a link to the hold room —
      // the shelf passes `onOpen`, so the whole contract is read before a seat is claimed.
      await page.getByRole("button", { name: /^Take (a|the last) seat in / }).first().click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();

      // Signed out, the sheet's verb is a `SignInLink`, so the next hop is WorkOS and only then
      // this league's hold room. A spec drives no third-party auth screen: it asserts the door
      // CARRIES the visitor's intent — the exact defect `SignInLink` exists to prevent, a
      // stranger dropped on a generic `/app` with a seat they can no longer see — and then opens
      // the room the intent names. Both halves of the walk, neither of them WorkOS's to answer.
      const verb = sheet.getByRole("link", { name: /^Take (a|the last) seat in / }).first();
      const href = await verb.getAttribute("href");
      expect(href).toMatch(/^\/sign-in\?returnTo=/);
      const hold = decodeURIComponent(new URL(href!, "http://localhost").searchParams.get("returnTo") ?? "");
      expect(hold).toMatch(/^\/join\/[^/]+\/hold$/);

      await page.goto(hold);
      await expect(page).toHaveURL(/\/join\/[^/]+\/hold$/);
      // THE MASTHEAD is what this round built and what this spec owns: who is in, then the one
      // number with its basis. It renders from the league's own facts and is the same block for
      // both branches of the page.
      await expect(page.getByTestId("seat-stack")).toBeVisible();
      await expect(page.getByTestId("hold-seats-open")).toContainText(/seats? open of \d+/);

      // NOT the panel's own verb, deliberately. `SeatHoldPanel` CLAIMS a real hold on mount, so
      // asserting its solid here made this test depend on live capacity AND on its own side
      // effect: the light run claimed the seat the dark run then found gone, and the room
      // honestly rendered a refusal with no verb at all. A door's masthead is a fact about the
      // league; whether a seat can still be held is the join flow's subject, not the doors'.
      // P3 on a room that CAN still be entered is covered on the front door above.
    });
  });
}
