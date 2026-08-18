import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { ConnectionBanner } from "./connection-banner";

describe("ConnectionBanner", () => {
  it("announces a dropped connection in a live region, both themes, axe-clean", async () => {
    await inBothThemes(<ConnectionBanner connection="reconnecting" />, async ({ container }) => {
      const status = screen.getByText("Reconnecting…");
      expect(status.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("shows a message while connecting, and stays visually quiet (but not absent) once live", () => {
    const { rerender } = render(<ConnectionBanner connection="connecting" />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();

    rerender(<ConnectionBanner connection="live" />);
    expect(screen.queryByText("Connecting…")).toBeNull();
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });

  it("keeps the same aria-live region mounted across all three states, so a screen reader has something to diff against and actually announces a change", () => {
    const { container, rerender } = render(<ConnectionBanner connection="connecting" />);
    const live = () => container.querySelector('[aria-live="polite"]');
    expect(live()).not.toBeNull();

    rerender(<ConnectionBanner connection="live" />);
    expect(live()).not.toBeNull();
    expect(live()).toHaveTextContent("Connected.");

    rerender(<ConnectionBanner connection="reconnecting" />);
    expect(live()).not.toBeNull();
    expect(live()).toHaveTextContent("Reconnecting…");
  });
});
