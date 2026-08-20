import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { NOTIFICATION_CATALOG } from "@/identity";
import { NotificationSummary } from "./notification-summary";

describe("NotificationSummary", () => {
  it("lists every catalog topic's title and detail, axe-clean in both themes", async () => {
    await inBothThemes(<NotificationSummary />, async ({ container }) => {
      for (const topic of NOTIFICATION_CATALOG) {
        expect(screen.getByText(topic.title)).toBeInTheDocument();
        expect(screen.getByText(topic.detail)).toBeInTheDocument();
      }
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says today's channel is in the app, once per topic", () => {
    render(<NotificationSummary />);
    expect(screen.getAllByText("In the app")).toHaveLength(NOTIFICATION_CATALOG.length);
  });

  it("states honestly that email isn't connected, with no toggle beside it", () => {
    const { container } = render(<NotificationSummary />);
    expect(
      screen.getByText("Email updates aren't connected yet. When they are, you'll choose which of these arrive in your inbox."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="checkbox"], [role="switch"]')).toHaveLength(0);
  });
});
