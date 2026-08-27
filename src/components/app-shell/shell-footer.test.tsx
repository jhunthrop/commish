import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { SHELL_FOOTER_LINKS, ShellFooter } from "./shell-footer";

describe("ShellFooter", () => {
  it("names Support, How it works, Terms and Privacy, in that order, in both themes, axe-clean", async () => {
    await renderSurface(<ShellFooter />, async ({ container, getAllByRole }) => {
      const links = getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(["Support", "How it works", "Terms", "Privacy"]);
      expect(links.map((link) => link.getAttribute("href"))).toEqual(["/support", "/league-rules", "/legal/terms", "/legal/privacy"]);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // A3's design note: the shell footer names `/league-rules` "How it works" — matching that
  // route's own <h1> and the front door's nav label (`src/app/page.tsx:37`) — never
  // `PublicFooter`'s "League rules", so a signed-in manager sees the same name the front door
  // already taught them.
  it("labels /league-rules 'How it works', not PublicFooter's 'League rules'", async () => {
    await renderSurface(<ShellFooter />, ({ getByRole, queryByRole }) => {
      expect(getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/league-rules");
      expect(queryByRole("link", { name: "League rules" })).not.toBeInTheDocument();
    });
  });

  it("carries no target twice and no target with an empty label", () => {
    const hrefs = SHELL_FOOTER_LINKS.map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const link of SHELL_FOOTER_LINKS) expect(link.label.trim().length).toBeGreaterThan(0);
  });

  it("names a real navigation landmark distinct from the league rail's", async () => {
    await renderSurface(<ShellFooter />, ({ getByRole }) => {
      expect(getByRole("navigation", { name: "Support and legal" })).toBeInTheDocument();
    });
  });

  it("accepts extra classes from the caller, the same seam TopBar/LeagueRail use", () => {
    const { container } = render(<ShellFooter className="lg:col-start-2 lg:row-start-3" />);
    const footer = container.querySelector("footer")!;
    expect(footer.className).toMatch(/lg:col-start-2/);
    expect(footer.className).toMatch(/lg:row-start-3/);
  });
});
