import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { NOTIFICATION_CATALOG } from "@/identity";
import { NotificationSummary } from "./notification-summary";

describe("NotificationSummary", () => {
  it("lists every catalog topic's title and detail, axe-clean in both themes", async () => {
    await renderSurface(<NotificationSummary />, async ({ container }) => {
      for (const topic of NOTIFICATION_CATALOG) {
        expect(screen.getByText(topic.title)).toBeInTheDocument();
        expect(screen.getByText(topic.detail)).toBeInTheDocument();
      }
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // A COLUMN WITH ZERO VARIANCE CARRIES NO INFORMATION. Every topic reaches everybody the same
  // way, so the channel is stated ONCE in the panel's header rather than as an identical chip on
  // all five rows. It earns its column back the day a topic can reach one member differently.
  it("says today's channel once, in the panel's header, and never per topic", () => {
    render(<NotificationSummary />);
    expect(screen.getAllByText("In the app")).toHaveLength(1);
    // Every topic is still listed: what went is the repetition, not the rows.
    for (const topic of NOTIFICATION_CATALOG) expect(screen.getByText(topic.title)).toBeInTheDocument();
  });

  it("states honestly that email isn't connected, with no toggle beside it", () => {
    const { container } = render(<NotificationSummary />);
    expect(
      screen.getByText("Email updates are not connected yet. When they are, you will choose which of these arrive in your inbox."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="checkbox"], [role="switch"]')).toHaveLength(0);
  });
});
