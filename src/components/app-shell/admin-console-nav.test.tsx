import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AdminConsoleNav } from "./admin-console-nav";

let pathname = "/app/admin/queue";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

function mockPathname(next: string): void {
  pathname = next;
}

describe("AdminConsoleNav", () => {
  it("lists all six operator surfaces for an admin standing on the admin console, axe-clean", async () => {
    mockPathname("/app/admin/queue");
    await renderSurface(<AdminConsoleNav isAdmin={true} />, async ({ container }) => {
      expect(screen.getByRole("link", { name: "Dispute queue" })).toHaveAttribute("href", "/app/admin/queue");
      expect(screen.getByRole("link", { name: "Held payouts" })).toHaveAttribute("href", "/app/admin/holds");
      expect(screen.getByRole("link", { name: "Self exclusion" })).toHaveAttribute("href", "/app/admin/exclusions");
      expect(screen.getByRole("link", { name: "Settle league" })).toHaveAttribute("href", "/app/admin/leagues/settle");
      expect(screen.getByRole("link", { name: "Dissolve league" })).toHaveAttribute("href", "/app/admin/leagues/dissolve");
      expect(screen.getByRole("link", { name: "Money reconciliation" })).toHaveAttribute("href", "/app/admin/money/reconcile");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("marks the current surface with aria-current, and no other", () => {
    mockPathname("/app/admin/holds");
    render(<AdminConsoleNav isAdmin={true} />);
    expect(screen.getByRole("link", { name: "Held payouts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dispute queue" })).not.toHaveAttribute("aria-current");
  });

  it("never renders for a non-admin, even standing on an admin URL", () => {
    mockPathname("/app/admin/queue");
    const { container } = render(<AdminConsoleNav isAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an admin standing outside the admin console", () => {
    mockPathname("/app");
    const { container } = render(<AdminConsoleNav isAdmin={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an admin on a league page — the console is scoped to /app/admin/*", () => {
    mockPathname("/app/leagues/lg_bandits");
    const { container } = render(<AdminConsoleNav isAdmin={true} />);
    expect(container).toBeEmptyDOMElement();
  });
});
