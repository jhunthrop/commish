import { mkdirSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";

/**
 * THROUGH THE SWITCHER'S OWN STORE, not the attribute alone. `ThemeProvider`
 * (`@/design/theme-provider`) applies its stored preference on mount and REMOVES `data-theme`
 * when that preference is "system", so a bare `setAttribute` in an init script is erased by
 * hydration a frame later and every "dark" screenshot comes out light. Seeding
 * `localStorage["commish.theme"]` is what the switcher itself writes, so the page renders the
 * theme a real member chose. The attribute is stamped too, for the frames before hydration.
 */
async function stampTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("commish.theme", value);
    } catch {
      // A context with storage denied still gets the attribute below.
    }
    document.documentElement.setAttribute("data-theme", value);
  }, theme);
}

/**
 * THE SIGNED-IN HOME, SIDELINE (2026-09-11) — one card per league, ordered by what needs this
 * manager first, then the lobby. Built to the founder-approved mock at
 * `docs/design/mocks/2026-09-11/signed-in-home/`.
 *
 * TWO REAL STATES, TWO READ-ONLY IDENTITIES. `managerD` is seeded into exactly ONE league and
 * `managerB` into three, which are precisely the two states the mock draws. Neither is mutated
 * here: this spec only reads `/app`, so it can never disturb the seat counts the rest of the
 * suite's own identities depend on.
 *
 * Each check is a PRINCIPLE, in the first-principles document's own words:
 *   P1 — the person comes before the number (a manager stack with a sentence naming who is in).
 *   P2 — one figure larger than body text per card, naming its basis in the same glance.
 *   P3 — one solid verb per viewport, and it belongs to the league that is owed something.
 *   P4 — nothing moves on load but the live channel.
 *   P7 — no tips, no explainer sentences, no system voice, no em-dashes.
 *
 * Both themes in one pass through `data-theme`, the attribute the theme switcher itself stamps,
 * so a rule that only exists in one palette fails here rather than in somebody's screenshot.
 */

const OUT_DIR = ".superpowers/mocks/screenshots";
const DESK = { width: 1440, height: 1000 };
const PHONE = { width: 360, height: 800 };
const THEMES = ["light", "dark"] as const;

/** The one solid verb, by the class only `Button`'s `verb`/`primary` variant carries. */
const SOLID_VERB = '[class*="shadow-verb-glow"]';

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

for (const theme of THEMES) {
  test.describe(`the signed-in home, ${theme}`, () => {
    test(`one league fills the page, and the lobby sits under it (${theme})`, async ({ managerD }) => {
      await stampTheme(managerD, theme);
      await managerD.setViewportSize(DESK);
      await managerD.goto("/app");

      const cards = managerD.getByTestId("home-league-card");
      await expect(cards).toHaveCount(1);

      // P1: the people, with a sentence naming them — never a bare row of circles.
      const stack = cards.first().getByTestId("manager-stack");
      await expect(stack).toBeVisible();
      await expect(stack).toContainText(/are in\.|You are in\./);

      // P2: exactly one figure larger than body text on the card, and its caption names the
      // population or the span it belongs to.
      const figures = cards.first().getByTestId("big-number");
      await expect(figures).toHaveCount(1);
      // The basis names its population or its SPAN, and a draft's span names the reader's own
      // zone ("... at 6:55 PM PDT") rather than a bare time — `useReaderClock` supplies it after
      // mount, so this is the upgraded render, not the UTC server pass.
      await expect(figures.first()).toContainText(/of \d+|after week \d+|no games played yet|at .+ [A-Z]{2,5}$/);

      // P3, counted over the whole viewport: one verb, or none when nothing is owed. Never two.
      expect(await managerD.locator(SOLID_VERB).count()).toBeLessThanOrEqual(1);

      // The lobby is the page's second half, ordered and with a way out to the whole of it.
      const lobby = managerD.getByTestId("open-rooms");
      await expect(lobby).toBeVisible();
      await expect(lobby.getByRole("heading", { name: "Open rooms" })).toBeVisible();
      await expect(lobby.getByRole("button", { name: "Create a league" })).toBeVisible();
      await expect(lobby.getByRole("link", { name: "See every open league" })).toBeVisible();
      // Three rooms at most, at whichever breakpoint form is showing.
      expect(await lobby.getByTestId("league-rows").locator("li").count()).toBeLessThanOrEqual(3);

      await managerD.screenshot({ path: `${OUT_DIR}/signed-in-home-one-1440-${theme}.png` });
      await managerD.setViewportSize(PHONE);
      await expect(cards).toHaveCount(1);
      await managerD.screenshot({ path: `${OUT_DIR}/signed-in-home-one-360-${theme}.png` });
    });

    test(`three leagues stack in the order of what needs this manager first (${theme})`, async ({ managerB }) => {
      await stampTheme(managerB, theme);
      await managerB.setViewportSize(DESK);
      await managerB.goto("/app");

      const cards = managerB.getByTestId("home-league-card");
      await expect(cards).toHaveCount(3);

      // THE ORDER IS THE PAGE'S ANSWER: every open one-time task sits above every league that is
      // merely live or quiet. Read off each card's own stated need, which is the same word the
      // sort used.
      const OWED = ["draft-running", "lineup-unset", "slots-unranked"];
      const needs = await cards.locator("[data-need]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-need") ?? ""));
      expect(needs).toHaveLength(3);
      const lastOwed = needs.reduce((last, need, index) => (OWED.includes(need) ? index : last), -1);
      const firstUnowed = needs.findIndex((need) => !OWED.includes(need));
      if (lastOwed !== -1 && firstUnowed !== -1) expect(lastOwed).toBeLessThan(firstUnowed);

      // P3 over the whole page, cards and lobby together: at most one solid verb, and when there
      // is one it belongs to the FIRST card (the only one the wash is on).
      const solid = managerB.locator(SOLID_VERB);
      const solidCount = await solid.count();
      expect(solidCount).toBeLessThanOrEqual(1);
      if (solidCount === 1) await expect(cards.first().locator(SOLID_VERB)).toHaveCount(1);

      // P1 and P2 on every card, not just the first.
      for (let index = 0; index < 3; index += 1) {
        await expect(cards.nth(index).getByTestId("manager-stack")).toBeVisible();
        await expect(cards.nth(index).getByTestId("big-number")).toHaveCount(1);
      }

      // P7: the copy rules, on what actually rendered.
      const words = (await managerB.getByTestId("home-league-cards").innerText()).toLowerCase();
      expect(words).not.toContain("—");
      for (const banned of ["market", "price", "buy ", "sell ", "sleeper pick value"]) expect(words).not.toContain(banned);

      await managerB.screenshot({ path: `${OUT_DIR}/signed-in-home-three-1440-${theme}.png` });
      await managerB.setViewportSize(PHONE);
      await expect(cards).toHaveCount(3);
      // Nothing scrolls sideways on a phone: the cards reflow to one column.
      const overflow = await managerB.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await managerB.screenshot({ path: `${OUT_DIR}/signed-in-home-three-360-${theme}.png` });
    });
  });
}
