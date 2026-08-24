import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { ReactElement } from "react";
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
   * the pages behind them. At the point this test first landed the four pages themselves
   * (`src/app/legal/terms/page.tsx` and siblings) did not exist yet — Task 21 runs after Task 16
   * (controller ruling 1's combined order) — so "resolves" here checked only the structural half
   * of "worth arriving at": every link is a real, well-formed, same-origin path, never a
   * placeholder anchor, an external url, or an empty href. That half still holds below.
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

  /**
   * THE OTHER HALF, now that Task 21 has landed: every page these four links name is a real
   * route module that renders. Resolved the same way `src/integrity/rendered-copy.test.tsx`'s
   * own "the four trust stubs" block already proves each page clean of copy — a dynamic import
   * plus a real render — checked here too so a page moved or deleted breaks THIS component's
   * own test, not only a copy sweep three directories away. Every `PUBLIC_FOOTER_LINKS` href is
   * driven through `PAGE_MODULE_BY_HREF` explicitly, rather than a generic file-system guess, so
   * a fifth link added here with no matching entry fails loudly instead of silently skipping the
   * check.
   */
  it("resolves every link to a real page module that renders", async () => {
    const PAGE_MODULE_BY_HREF: Readonly<Record<string, () => Promise<{ readonly default: () => ReactElement }>>> = {
      "/legal/terms": () => import("@/app/legal/terms/page"),
      "/legal/privacy": () => import("@/app/legal/privacy/page"),
      "/support": () => import("@/app/support/page"),
      "/league-rules": () => import("@/app/league-rules/page"),
    };
    expect(Object.keys(PAGE_MODULE_BY_HREF).sort()).toEqual(PUBLIC_FOOTER_LINKS.map((link) => link.href).sort());

    for (const link of PUBLIC_FOOTER_LINKS) {
      const { default: Page } = await PAGE_MODULE_BY_HREF[link.href]!();
      const { container, unmount } = render(<Page />);
      expect(container.textContent).not.toBe("");
      unmount();
    }
  });

  it("carries no target twice and no target with an empty label", () => {
    const hrefs = PUBLIC_FOOTER_LINKS.map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const link of PUBLIC_FOOTER_LINKS) expect(link.label.trim().length).toBeGreaterThan(0);
  });
});
