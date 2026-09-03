import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { renderSurface } from "@/components/ui/test-utils";
import type { HomeLeagueCard } from "@/league-room/contract";
import type { RailLeague } from "./shell-data";
import { LeagueRail, railHiddenOn } from "./league-rail";

// `LeagueRail` reads `usePathname()` directly (ruling 8, as amended) — mocked the same way
// `help-level-form.test.tsx` mocks `next/navigation`'s `useRouter`, one module-level mock whose
// return value a test can move before rendering.
let pathname = "/app/leagues/lg_somewhere";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

/** Sets what `usePathname()` answers for the NEXT render — same "move it, then render" shape
 *  every other test in this suite that fakes a router value uses. */
function mockPathname(next: string): void {
  pathname = next;
}

// A quiet default stub so a test that merely OPENS the flyout (with a live league in the
// fixture) never lets happy-dom fire a real network fetch at teardown; the fetch-specific
// tests below stub their own.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: false }) }));
});

afterEach(() => {
  mockPathname("/app/leagues/lg_somewhere");
  vi.unstubAllGlobals();
});

const LEAGUES: readonly RailLeague[] = [
  // Already in urgency order — `shellData` sorts, the rail renders.
  { id: "lg_thunder", name: "Thunder Squad", state: "needs-you", needsYouKind: "join-draft", monogram: "TS", stateLine: "Join the draft" },
  { id: "lg_hawks", name: "Golden Hawks", state: "live", needsYouKind: null, monogram: "GH", stateLine: "Live now" },
  { id: "lg_bandits", name: "Bay Bandits", state: "quiet", needsYouKind: null, monogram: "BB", stateLine: "4th of 12 · next: vs Mudville Nine" },
];

function rail(): HTMLElement {
  return screen.getByTestId("league-rail");
}

describe("railHiddenOn", () => {
  it("hides the rail on its own full page and the standing redirect, nowhere else", () => {
    expect(railHiddenOn("/app")).toBe(true);
    expect(railHiddenOn("/app/leagues")).toBe(true);
    expect(railHiddenOn("/app/leagues/lg_x")).toBe(false);
    expect(railHiddenOn("/app/wallet")).toBe(false);
    expect(railHiddenOn(null)).toBe(false);
  });
});

describe("LeagueRail", () => {
  it("renders nothing at all on /app — the page IS the rail's full form (law 3)", () => {
    mockPathname("/app");
    render(<LeagueRail leagues={LEAGUES} />);
    expect(screen.queryByTestId("league-rail")).not.toBeInTheDocument();
  });

  it("names every chip by the league's real name AND its state line — never its monogram", async () => {
    await renderSurface(<LeagueRail leagues={LEAGUES} />, () => {
      expect(screen.getByRole("link", { name: "Thunder Squad. Join the draft." })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Golden Hawks. Live now." })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Bay Bandits. 4th of 12 · next: vs Mudville Nine." })).toBeInTheDocument();
    });
  });

  it("renders the collision-resolved monogram on the chip, aria-hidden", async () => {
    const twins: readonly RailLeague[] = [
      { id: "lg_dire", name: "Dire Straits", state: "quiet", needsYouKind: null, monogram: "DS", stateLine: "3rd of 12" },
      { id: "lg_dark", name: "Dark Skies", state: "quiet", needsYouKind: null, monogram: "DS2", stateLine: "9th of 12" },
    ];
    await renderSurface(<LeagueRail leagues={twins} />, ({ container }) => {
      const marks = Array.from(container.querySelectorAll("span[aria-hidden]"))
        .map((span) => span.textContent)
        .filter((text) => text === "DS" || text === "DS2");
      expect(marks).toContain("DS");
      expect(marks).toContain("DS2");
    });
  });

  it("gives the + row words and a full accessible name", () => {
    render(<LeagueRail leagues={LEAGUES} />);
    const plus = screen.getByRole("link", { name: "Find or start a league" });
    expect(plus).toHaveAttribute("href", "/app#create-league");
    expect(plus.textContent).toContain("Find or start a league");
  });

  it("draws the divider exactly once, before the first quiet league", () => {
    const { container } = render(<LeagueRail leagues={LEAGUES} />);
    expect(container.querySelectorAll("span.lg\\:border-t")).toHaveLength(1);
  });

  it("draws no divider when every league is quiet — there is no boundary to mark", () => {
    const quiet: readonly RailLeague[] = [
      { id: "lg_a", name: "Alpha", state: "quiet", needsYouKind: null, monogram: "AL", stateLine: "1st of 8" },
    ];
    const { container } = render(<LeagueRail leagues={quiet} />);
    expect(container.querySelectorAll("span.lg\\:border-t")).toHaveLength(0);
  });

  it("opens on focus, closes on Escape, and never moves the rail's own track (overlay only)", () => {
    render(<LeagueRail leagues={LEAGUES} />);
    expect(rail()).toHaveAttribute("data-expanded", "false");
    fireEvent.focus(screen.getByRole("link", { name: /Thunder Squad/ }));
    expect(rail()).toHaveAttribute("data-expanded", "true");
    // The overlay: the inner panel takes absolute positioning; the nav's own width class —
    // the grid track — is untouched by opening.
    expect(rail().className).toContain("lg:w-[var(--rail-width)]");
    expect(rail().querySelector(".lg\\:absolute")).not.toBeNull();
    fireEvent.keyDown(rail(), { key: "Escape" });
    expect(rail()).toHaveAttribute("data-expanded", "false");
    expect(rail().querySelector(".lg\\:absolute")).toBeNull();
  });

  it("opens on mouse-enter and closes on mouse-out", () => {
    render(<LeagueRail leagues={LEAGUES} />);
    fireEvent.mouseEnter(rail());
    expect(rail()).toHaveAttribute("data-expanded", "true");
    fireEvent.mouseLeave(rail());
    expect(rail()).toHaveAttribute("data-expanded", "false");
  });

  it("fetches /api/home once on open when a league is live, and upgrades the live line", async () => {
    const liveCard: Partial<HomeLeagueCard> = {
      id: "lg_hawks",
      myTeamId: "t1",
      weekStatus: "in_progress",
      nextAction: { kind: "watch-scores", label: "Watch the scores" },
      matchup: {
        weekNumber: 4,
        homeTeamId: "t1",
        awayTeamId: "t2",
        homeTeamName: "Mine",
        awayTeamName: "Theirs",
        homeScore: 84.2,
        awayScore: 71.6,
        final: false,
        weekStatus: "in_progress",
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { leagues: [liveCard], liveState: null, firstRun: null } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LeagueRail leagues={LEAGUES} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.mouseEnter(rail());
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/home");
    expect(screen.getByRole("link", { name: "Golden Hawks. Live · you lead 84.20 to 71.60." })).toBeInTheDocument();
    // The other rows keep their shell lines — the upgrade only ever touches live rows.
    expect(screen.getByRole("link", { name: "Thunder Squad. Join the draft." })).toBeInTheDocument();
  });

  it("never fetches while closed, and never fetches at all with no live league", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const noLive: readonly RailLeague[] = [
      { id: "lg_thunder", name: "Thunder Squad", state: "needs-you", needsYouKind: "join-draft", monogram: "TS", stateLine: "Join the draft" },
      { id: "lg_bandits", name: "Bay Bandits", state: "quiet", needsYouKind: null, monogram: "BB", stateLine: "4th of 12" },
    ];
    render(<LeagueRail leagues={noLive} />);
    await act(async () => {
      fireEvent.mouseEnter(rail());
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the degraded 'Live now' line when the upgrade fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<LeagueRail leagues={LEAGUES} />);
    await act(async () => {
      fireEvent.mouseEnter(rail());
    });
    expect(screen.getByRole("link", { name: "Golden Hawks. Live now." })).toBeInTheDocument();
  });

  it("marks the league the current URL belongs to with aria-current, and no other", () => {
    mockPathname("/app/leagues/lg_bandits/matchups/3");
    render(<LeagueRail leagues={LEAGUES} />);
    expect(screen.getByRole("link", { name: /Bay Bandits/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Thunder Squad/ })).not.toHaveAttribute("aria-current");
    // D4's visual "you are here" survives the rebuild: the current tile's class differs.
    expect(screen.getByRole("link", { name: /Bay Bandits/ }).className).toMatch(/ring-edge/);
    expect(screen.getByRole("link", { name: /Thunder Squad/ }).className).not.toMatch(/ring-edge/);
  });

  it("hides every state dot and every word span from the accessibility tree", async () => {
    await renderSurface(<LeagueRail leagues={LEAGUES} />, ({ container }) => {
      for (const span of Array.from(container.querySelectorAll("span[aria-hidden]"))) {
        expect(span).toHaveAttribute("aria-hidden", "true");
      }
      // The dots exist, colored by the channel law: amber = yours, red = live.
      expect(container.querySelector(".bg-accent")).not.toBeNull();
      expect(container.querySelector(".bg-negative")).not.toBeNull();
    });
  });
});
