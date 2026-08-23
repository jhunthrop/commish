import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { PageTitle } from "./page-title";

describe("PageTitle", () => {
  it("renders an h1 with the page-title treatment, both themes, axe-clean", async () => {
    await renderSurface(<PageTitle>Your leagues</PageTitle>, async ({ container }) => {
      const heading = screen.getByRole("heading", { level: 1, name: "Your leagues" });
      expect(heading.className).toContain("text-display-md");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("sizes up for the one xl site (the marketing home page)", () => {
    render(<PageTitle size="xl">Commish</PageTitle>);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("text-display-xl");
  });
});
