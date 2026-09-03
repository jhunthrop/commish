import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { Button } from "./button";
import { renderSurface } from "./test-utils";

describe("Skeleton", () => {
  it("is aria-busy and announces loading to screen readers", () => {
    render(<Skeleton lines={2} />);
    const el = screen.getByText("Loading…").parentElement!;
    expect(el).toHaveAttribute("aria-busy", "true");
  });

  it("clamps every line's width to the minimum, even with many lines", () => {
    const { container } = render(<Skeleton lines={12} />);
    const bars = container.querySelectorAll('[aria-hidden="true"]');
    expect(bars).toHaveLength(12);
    for (const bar of bars) {
      const width = parseFloat((bar as HTMLElement).style.width);
      expect(width).toBeGreaterThanOrEqual(40);
    }
  });

  it("renders only the sr-only text for a negative line count, never throws", () => {
    render(<Skeleton lines={-1} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    const el = screen.getByText("Loading…").parentElement!;
    expect(el.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });
});

describe("EmptyState", () => {
  it("renders title, description and the required action, both themes, no axe violations", async () => {
    await renderSurface(
      <EmptyState title="No leagues yet" description="Create one or join a public league." action={<Button>Create a league</Button>} icon="inbox" />,
      async ({ container }) => {
        expect(screen.getByRole("heading", { name: "No leagues yet" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Create a league" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("renders its default icon (inbox) when no icon is given", () => {
    const { container } = render(<EmptyState title="No leagues yet" action={<Button>Create a league</Button>} />);
    expect(container.querySelector("svg.lucide-inbox")).toBeInTheDocument();
  });

  it("v6: the mascot slot swaps the practice bot in for the icon, decorative and static", async () => {
    // The bot is aria-hidden (the words carry the meaning) and has no animation classes —
    // reduced-motion safe by construction, not by a media-query branch (law 6).
    await renderSurface(
      <EmptyState mascot title="Your queue is empty." description="Tap a player and he'll wait right here." action={<Button>Open the pool</Button>} />,
      async ({ container }) => {
        expect(container.querySelector("svg.lucide-inbox")).toBeNull();
        const bot = container.querySelector('svg[viewBox="0 0 40 40"]')!;
        expect(bot).toBeInTheDocument();
        expect(bot.getAttribute("aria-hidden")).toBe("true");
        expect(bot.outerHTML).not.toContain("animate");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("v6: the empty lot lost its dashed fence — soft resting fill, no hairline", () => {
    const { container } = render(<EmptyState title="No leagues yet" action={<Button>Create a league</Button>} />);
    const panel = container.firstElementChild!;
    expect(panel.className).toContain("bg-surface-elevated");
    expect(panel.className).not.toContain("border-dashed");
  });
});

describe("ErrorState", () => {
  it("is an alert with a recovery action", async () => {
    render(<ErrorState title="Couldn't load standings" description="Check your connection and try again." action={<Button>Retry</Button>} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load standings");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
