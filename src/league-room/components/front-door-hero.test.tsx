import { describe, it, expect } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { FrontDoorHero } from "./front-door-hero";

describe("FrontDoorHero", () => {
  // join-flow-panel.md, HIGH: the page said nothing about money anywhere, which is honest but
  // reads as an omission to the one persona most likely to ask.
  it("says what a seat costs, because a visitor who searched for money deserves an answer", async () => {
    await renderSurface(<FrontDoorHero />, ({ getByText }) => {
      expect(getByText("Every league is free this season.")).toBeInTheDocument();
    });
  });

  it("has a heading, in both themes, axe-clean", async () => {
    await renderSurface(<FrontDoorHero />, async ({ container, getByRole }) => {
      expect(getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
