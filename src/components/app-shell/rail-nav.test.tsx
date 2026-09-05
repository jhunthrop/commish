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
  it("lists Leagues, Draft, Rooms and Wallet, in that order", () => {
    render(<RailNav />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Leagues", "Draft", "Rooms", "Wallet"]);
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

  it("marks Draft on the HQ page and never Rooms", () => {
    mockPathname("/app/draft");
    render(<RailNav />);
    expect(hereLabel()).toBe("Draft");
  });

  it("marks Draft only on /app/draft/board — the exact HIGH-1 regression case", () => {
    mockPathname("/app/draft/board");
    render(<RailNav />);
    expect(hereLabel()).toBe("Draft");
    expect(screen.getByRole("link", { name: "Rooms" })).not.toHaveAttribute("aria-current");
  });

  it("marks Rooms, never Draft, on a live draft room — /app/drafts/[id] must not collide with /app/draft", () => {
    mockPathname("/app/drafts/abc123");
    render(<RailNav />);
    expect(hereLabel()).toBe("Rooms");
    expect(screen.getByRole("link", { name: "Draft" })).not.toHaveAttribute("aria-current");
  });

  it("marks Rooms on the mock lobby", () => {
    mockPathname("/app/mock-drafts");
    render(<RailNav />);
    expect(hereLabel()).toBe("Rooms");
  });

  it("marks Wallet on its own subpath", () => {
    mockPathname("/app/wallet/deposits");
    render(<RailNav />);
    expect(hereLabel()).toBe("Wallet");
  });

  it("marks exactly one destination here, never zero or two, across every real route", () => {
    for (const path of ["/app", "/app/leagues/lg1", "/app/draft", "/app/draft/board", "/app/draft/sheet", "/app/drafts/xyz", "/app/mock-drafts", "/app/wallet"]) {
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
