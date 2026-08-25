import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { TermLink } from "./term-link";

describe("TermLink", () => {
  it("points at this page's own glossary anchor, never off-page", async () => {
    await renderSurface(<TermLink term="ppr">PPR</TermLink>, ({ container }) => {
      const link = screen.getByRole("link", { name: "PPR" });
      expect(link).toHaveAttribute("href", "#term-ppr");
      // Same-page fragment, not a route — no InfoTip-style click-to-reveal button underneath it.
      expect(container.querySelector("button")).not.toBeInTheDocument();
    });
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(
      <p>
        A snake draft or an <TermLink term="auction-draft">auction draft</TermLink>.
      </p>,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
