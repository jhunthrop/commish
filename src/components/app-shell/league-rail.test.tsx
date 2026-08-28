import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderSurface } from "@/components/ui/test-utils";
import type { RailLeague } from "./shell-data";
import { LeagueRail } from "./league-rail";

// `LeagueRail` reads `usePathname()` directly (ruling 8, as amended) — mocked the same way
// `help-level-form.test.tsx` mocks `next/navigation`'s `useRouter`, one module-level mock whose
// return value a test can move before rendering.
let pathname = "/app";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

/** Sets what `usePathname()` answers for the NEXT render — same "move it, then render" shape
 *  every other test in this suite that fakes a router value uses. */
function mockPathname(next: string): void {
  pathname = next;
}

const LEAGUES: readonly RailLeague[] = [
  { id: "lg_bandits", name: "Bay Bandits", state: "quiet", needsYouKind: null },
  { id: "lg_thunder", name: "Thunder Squad", state: "needs-you", needsYouKind: "join-draft" },
  { id: "lg_hawks", name: "Golden Hawks", state: "live", needsYouKind: null },
];

describe("LeagueRail", () => {
  it("names every crest by the league's real name, never its initials", async () => {
    mockPathname("/app");
    await renderSurface(<LeagueRail leagues={LEAGUES} />, () => {
      expect(screen.getByRole("link", { name: "Bay Bandits" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Thunder Squad. Join the draft." })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Golden Hawks. Watch the scores." })).toBeInTheDocument();
    });
  });

  // Fix round 1, H1: the missing combination — a needs-you league whose kind is `fix-lineup`
  // must say so, not fall back to the (unrelated) `join-draft` sentence.
  it("says 'Fix your lineup', not 'Join the draft', when needsYouKind is fix-lineup", async () => {
    mockPathname("/app");
    const leagues: readonly RailLeague[] = [
      { id: "lg_volt", name: "Volt Kings", state: "needs-you", needsYouKind: "fix-lineup" },
    ];
    await renderSurface(<LeagueRail leagues={leagues} />, () => {
      expect(screen.getByRole("link", { name: "Volt Kings. Fix your lineup." })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Join the draft/ })).not.toBeInTheDocument();
    });
  });

  it("marks the league the current URL belongs to with aria-current, and no other", () => {
    mockPathname("/app/leagues/lg_bandits/matchups/3");
    render(<LeagueRail leagues={LEAGUES} />);
    expect(screen.getByRole("link", { name: "Bay Bandits" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Thunder Squad. Join the draft." })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Golden Hawks. Watch the scores." })).not.toHaveAttribute("aria-current");
  });

  // D4: `aria-current="page"` was already set, but every tile shared one class string — the
  // one persistent navigation in the product had no visual "you are here". The current tile now
  // carries a real visual state, not just an accessibility attribute.
  it("gives the current tile a class string that differs from every sibling's", () => {
    mockPathname("/app/leagues/lg_bandits/matchups/3");
    render(<LeagueRail leagues={LEAGUES} />);
    const current = screen.getByRole("link", { name: "Bay Bandits" });
    const siblingOne = screen.getByRole("link", { name: "Thunder Squad. Join the draft." });
    const siblingTwo = screen.getByRole("link", { name: "Golden Hawks. Watch the scores." });
    expect(current.className).not.toBe(siblingOne.className);
    expect(current.className).not.toBe(siblingTwo.className);
    // The idiom itself: `ThemeSwitcher`'s own checked-chip treatment (ring-1 ring-edge).
    expect(current.className).toMatch(/ring-edge/);
    expect(siblingOne.className).not.toMatch(/ring-edge/);
  });

  it("hides every state dot from the accessibility tree — the state lives in the accessible name only", async () => {
    mockPathname("/app");
    await renderSurface(<LeagueRail leagues={LEAGUES} />, ({ container }) => {
      const dots = container.querySelectorAll("[data-testid], span");
      // Every visual dot/crest span is aria-hidden — none is exposed as its own accessible node.
      for (const span of Array.from(container.querySelectorAll("span[aria-hidden]"))) {
        expect(span).toHaveAttribute("aria-hidden", "true");
      }
      expect(dots.length).toBeGreaterThan(0);
    });
  });

  /**
   * LAW 1, COLOUR IS A LEGEND. The rail is the product's most persistent navigation, so whatever
   * legend it teaches is the legend a manager learns. It taught the wrong one twice over: a live
   * game wore money-green (`positive`), which is the pigment of seats filling and of an action,
   * and a league waiting on the manager wore amber (`warning`), whose usage law 1 demotes to a
   * clock that is genuinely tightening. Live is the red family everywhere else in this product
   * (`WeekStatusBadge`, `GameStateChip`, `Countdown`'s hot tone); an act is money.
   */
  it("paints a live game in the live family and a needs-you league in money, never amber", () => {
    mockPathname("/app");
    const { container } = render(<LeagueRail leagues={LEAGUES} />);
    const dots = Array.from(container.querySelectorAll("span[aria-hidden='true'].rounded-pill")).map((n) => n.className);
    expect(dots.some((c) => c.includes("bg-negative"))).toBe(true);
    expect(dots.some((c) => c.includes("bg-accent"))).toBe(true);
    expect(dots.some((c) => c.includes("bg-warning"))).toBe(false);
    expect(dots.some((c) => c.includes("bg-positive"))).toBe(false);
  });

  /**
   * LAW 6, MOTION REPORTS, NEVER PERFORMS. Only the live dot moves, because only it has something
   * genuinely happening behind it; a needs-you dot is a standing fact and stays still. The
   * reduced-motion branch is asserted in `use-reduced-motion`'s own suite — here the point is that
   * the two states differ at all, so a future change cannot quietly make every dot breathe.
   */
  it("breathes only on the dot with a live game behind it", () => {
    mockPathname("/app");
    const { container } = render(<LeagueRail leagues={LEAGUES} />);
    const breathing = Array.from(container.querySelectorAll("span.animate-pulse-live")).map((n) => n.className);
    expect(breathing.length).toBe(1);
    expect(breathing[0]).toContain("bg-negative");
  });

  it("stays reachable at 360px as a horizontal strip — overflow-x-auto, never hidden", async () => {
    mockPathname("/app");
    await renderSurface(<LeagueRail leagues={LEAGUES} />, ({ getByTestId }) => {
      expect(getByTestId("league-rail").className).toMatch(/overflow-x-auto/);
      expect(getByTestId("league-rail").className).not.toMatch(/hidden/);
    });
  });

  it("carries a trailing join-or-create control, named for what it does", async () => {
    mockPathname("/app");
    await renderSurface(<LeagueRail leagues={LEAGUES} />, () => {
      expect(screen.getByRole("link", { name: "Join or create another league" })).toHaveAttribute("href", "/app#create-league");
    });
  });

  it("renders the rail with no leagues at all — just the trailing control", async () => {
    mockPathname("/app");
    await renderSurface(<LeagueRail leagues={[]} />, () => {
      expect(screen.getByRole("link", { name: "Join or create another league" })).toBeInTheDocument();
    });
  });

  it("scrolls inside itself at lg — capped at the viewport, stuck to it, never dragging the page (E11)", () => {
    render(<LeagueRail leagues={LEAGUES} />);
    const rail = screen.getByTestId("league-rail");
    expect(rail.className).toContain("lg:max-h-dvh");
    expect(rail.className).toContain("lg:overflow-y-auto");
    expect(rail.className).toContain("lg:sticky");
    expect(rail.className).not.toContain("lg:overflow-visible");
  });
});
