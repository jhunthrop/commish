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

  it("says nothing while connecting or live is silent, and shows a message while connecting", () => {
    const { rerender } = render(<ConnectionBanner connection="connecting" />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();

    rerender(<ConnectionBanner connection="live" />);
    expect(screen.queryByText("Connecting…")).toBeNull();
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });
});
