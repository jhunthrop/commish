import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { NudgeBanner } from "./nudge-banner";

describe("NudgeBanner", () => {
  it("shows the moderator's sentence politely, in both themes, axe-clean", async () => {
    await renderSurface(<NudgeBanner nudge={{ message: "You're on the clock.", sequence: 4 }} sequence={4} />, async ({ container }) => {
      const banner = screen.getByRole("status");
      expect(banner).toHaveTextContent("You're on the clock.");
      expect(banner).toHaveAttribute("aria-live", "polite");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("renders nothing without a nudge", () => {
    const { container } = render(<NudgeBanner nudge={null} sequence={4} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disappears as soon as the turn moves on", () => {
    const { container } = render(<NudgeBanner nudge={{ message: "You're on the clock.", sequence: 4 }} sequence={5} />);
    expect(container).toBeEmptyDOMElement();
  });
});
