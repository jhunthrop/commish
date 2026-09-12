import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RailNav } from "./rail-nav";

let pathname: string | null = "/app";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

function mockPathname(next: string | null): void {
  pathname = next;
}

/** The one link marked `aria-current="page"`, or `null` when none is — the v5 one-here-marker
 *  law, asserted directly rather than by checking each destination in turn. */
function hereLabel(): string | null {
  const current = screen.queryByRole("link", { current: "page" });
  return current?.textContent ?? null;
}

describe("RailNav", () => {
  it("lists Leagues, Draft and Wallet, in that order", () => {
    render(<RailNav />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Leagues", "Draft", "Wallet"]);
    expect(links[1]).toHaveAttribute("href", "/app/draft");
  });

  it("marks Leagues only on the exact /app home, never on another destination's subpath", () => {
    mockPathname("/app");
    render(<RailNav />);
    expect(hereLabel()).toBe("Leagues");
  });

  it("marks Leagues on /app/leagues/[id] via its own also-prefix", () => {
    mockPathname("/app/leagues/lg_bandits");
    render(<RailNav />);
    expect(hereLabel()).toBe("Leagues");
  });

  it("marks Draft on the segment's own path", () => {
    mockPathname("/app/draft");
    render(<RailNav />);
    expect(hereLabel()).toBe("Draft");
  });

  it("marks Draft on the board — the exact HIGH-1 regression case", () => {
    mockPathname("/app/draft/board");
    render(<RailNav />);
    expect(hereLabel()).toBe("Draft");
    expect(screen.getByRole("link", { name: "Leagues" })).not.toHaveAttribute("aria-current");
  });

  /** Rooms left the rail (the Draft area round, 2026-09-12) and `/app/drafts/[id]` is still a
   *  literal character-prefix away from `/app/draft` — the collision `pathIsUnder` exists for.
   *  It rides Draft's own `also` now, so a live room marks exactly one destination, not zero. */
  it("marks Draft, and only Draft, inside a live draft room", () => {
    mockPathname("/app/drafts/abc123");
    render(<RailNav />);
    expect(hereLabel()).toBe("Draft");
  });

  it("marks Draft on the mock lobby, which is a stop under it now", () => {
    mockPathname("/app/draft/mock-drafts");
    render(<RailNav />);
    expect(hereLabel()).toBe("Draft");
  });

  it("marks Wallet on its own subpath", () => {
    mockPathname("/app/wallet/deposits");
    render(<RailNav />);
    expect(hereLabel()).toBe("Wallet");
  });

  it("marks exactly one destination here, never zero or two, across every real route", () => {
    for (const path of ["/app", "/app/leagues/lg1", "/app/draft", "/app/draft/board", "/app/draft/sheet", "/app/drafts/xyz", "/app/draft/mock-drafts", "/app/wallet"]) {
      mockPathname(path);
      const { unmount } = render(<RailNav />);
      expect(screen.getAllByRole("link", { current: "page" })).toHaveLength(1);
      unmount();
    }
  });

  it("marks nothing here with no pathname (rendered outside a route context)", () => {
    mockPathname(null);
    render(<RailNav />);
    expect(screen.queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });
});
