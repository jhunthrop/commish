import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { PUBLIC_FOOTER_LINKS, PublicFooter } from "./public-footer";

describe("PublicFooter", () => {
  it("names Terms, Privacy, Support and League rules, in both themes, axe-clean", async () => {
    await renderSurface(<PublicFooter />, async ({ container, getByRole }) => {
      expect(getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/legal/terms");
      expect(getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/legal/privacy");
      expect(getByRole("link", { name: "Support" })).toHaveAttribute("href", "/support");
      expect(getByRole("link", { name: "League rules" })).toHaveAttribute("href", "/league-rules");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  /**
   * THE EVERY-FOOTER-TARGET-RESOLVES ASSERTION (F19), moved up from the addendum's Task 21
   * Step 4 to here — the component that names the targets, not the task that happens to write
   * the pages behind them. The four pages themselves (`src/app/legal/terms/page.tsx` and
   * siblings) do not exist yet at the point this task lands — they are Task 21's own job, which
   * runs after this one (controller ruling 1's combined order) — so "resolves" here is checked
   * at the level this component actually controls: every link it renders is a real, well-formed,
   * same-origin path (never a placeholder anchor, an external url, or an empty href), the
   * structural half of "worth arriving at" that does not require the destination to exist yet.
   * Task 21's own job, stated in its own Step 4, is the other half: making each target a page
   * worth arriving at, now that this guard is already standing.
   */
  it("names four real internal destinations — no placeholder, no dead anchor, no external link", () => {
    renderSurface(<PublicFooter />, ({ getAllByRole }) => {
      const links = getAllByRole("link");
      expect(links).toHaveLength(PUBLIC_FOOTER_LINKS.length);
      for (const link of links) {
        const href = link.getAttribute("href");
        expect(href).not.toBeNull();
        expect(href).not.toBe("#");
        expect(href).toMatch(/^\/[a-z][a-z-]*(?:\/[a-z][a-z-]*)*$/);
      }
    });
  });

  it("carries no target twice and no target with an empty label", () => {
    const hrefs = PUBLIC_FOOTER_LINKS.map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const link of PUBLIC_FOOTER_LINKS) expect(link.label.trim().length).toBeGreaterThan(0);
  });
});
