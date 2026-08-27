import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { buttonClassName } from "@/components/ui";
import { UI_CONFIG } from "@/components/ui/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { NextDraftModule } from "./next-draft-module";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const soonIso = () => new Date(Date.now() + UI_CONFIG.openLeagueCard.clockWithinMs / 2).toISOString();
const farIso = () => new Date(Date.now() + UI_CONFIG.openLeagueCard.clockWithinMs * 4).toISOString();

const LEAGUE: PublicLeagueSummary = {
  id: "next1",
  name: "Half-PPR #241",
  format: "snake",
  experienceTier: "experienced",
  stakeTier: 0,
  entryFeeCents: 0,
  teamCount: 12,
  filledTeams: 9,
  scoringLabel: "Half PPR",
  compositionCategory: "open",
  draftAt: "Thursday 10 September, 8:00 PM UTC (in 3 days)",
  draftAtIso: soonIso(),
  medianGame: false,
  startTrigger: "scheduled",
  houseRung: null,
  heldSeats: 0,
  rosterSummary: "15 slots, 1 flex",
  playoffWeeks: [15, 16, 17],
  kickoffRolls: 0,
};

describe("NextDraftModule (2026-08-25 hero finding)", () => {
  it("names the league as plain text, never a heading — collision-proof against the shelf's own heading for the same league", () => {
    render(<NextDraftModule league={LEAGUE} signedIn={false} />);
    expect(screen.getByText(LEAGUE.name).tagName).toBe("P");
    expect(screen.queryByRole("heading", { name: LEAGUE.name })).not.toBeInTheDocument();
  });

  // A stable, structural hook for a page-level integration test to find this module by (rather
  // than by its league's name, which the shelf's own row/card renders too — same page, same
  // text) — `src/app/front-door.test.tsx` scopes to this testid to prove `page.tsx` threads its
  // one derived featured league to this module coherently.
  it("carries a stable testid a page-level integration test can scope to", () => {
    render(<NextDraftModule league={LEAGUE} signedIn={false} />);
    expect(screen.getByTestId("next-draft-module")).toBeInTheDocument();
  });

  it("ticks the SAME gated clock the card and row render, at a larger register (extracted, not forked)", () => {
    render(<NextDraftModule league={{ ...LEAGUE, draftAtIso: soonIso() }} signedIn={false} />);
    const clock = screen.getByTestId("draft-clock");
    expect(clock.className).toContain("text-negative");
    expect(clock.className).toContain("font-mono");
    expect(clock.className).toContain("text-3xl");
  });

  it("keeps the absolute sentence, never a false tick, when the draft is scheduled but not yet close", () => {
    render(<NextDraftModule league={{ ...LEAGUE, draftAtIso: farIso() }} signedIn={false} />);
    expect(screen.queryByTestId("draft-clock")).not.toBeInTheDocument();
    expect(screen.getByText(LEAGUE.draftAt)).toBeInTheDocument();
  });

  it("prints the visible seat count and the seat bar, sr-only sentence included (the row's own Seats shape)", () => {
    render(<NextDraftModule league={LEAGUE} signedIn={false} />);
    expect(screen.getByText(`${LEAGUE.teamCount - LEAGUE.filledTeams} of ${LEAGUE.teamCount} open`)).toBeInTheDocument();
    expect(screen.getByTestId("seat-segments")).toBeInTheDocument();
  });

  it("gives the join action to the hold interstitial when signed out, always QUIET (rule 5 accounting)", () => {
    render(<NextDraftModule league={LEAGUE} signedIn={false} />);
    const cta = screen.getByRole("link", { name: "Take a seat in Half-PPR #241." });
    expect(cta.className).toBe(buttonClassName("secondary", "md"));
    expect(cta).toHaveAttribute("href", `/sign-in?returnTo=%2Fjoin%2F${LEAGUE.id}%2Fhold`);
  });

  it("gives a signed-in visitor the real join button, always QUIET", () => {
    render(<NextDraftModule league={LEAGUE} signedIn={true} />);
    const cta = screen.getByRole("button", { name: `Join ${LEAGUE.name}` });
    expect(cta.className).toBe(buttonClassName("secondary", "md"));
  });

  // D1-storefront (measured 318 × 40 in a 360px module): the Join control's own wrapper must
  // opt out of the module's `flex-col` stretch, the same fix `PracticeEntryLink` applies.
  it("wraps its join control in a self-start block, immune to the module's own flex-col stretch", () => {
    render(<NextDraftModule league={LEAGUE} signedIn={false} />);
    const cta = screen.getByRole("link", { name: "Take a seat in Half-PPR #241." });
    expect(cta.parentElement?.className).toContain("self-start");
  });

  it("stays hidden below xl and only appears at xl+ (the shelf is one scroll away below that)", () => {
    render(<NextDraftModule league={LEAGUE} signedIn={false} />);
    const root = screen.getByTestId("next-draft-module");
    expect(root.className).toContain("hidden");
    expect(root.className).toContain("xl:flex");
  });

  it("sits on surfaceElevated with a hairline border, rounded — the scoreboard-chip register, not a heavy card", () => {
    render(<NextDraftModule league={LEAGUE} signedIn={false} />);
    const root = screen.getByTestId("next-draft-module");
    expect(root.className).toContain("bg-surface-elevated");
    expect(root.className).toContain("border-line");
    expect(root.className).toContain("rounded-lg");
    expect(root.className).not.toContain("shadow-card");
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<NextDraftModule league={LEAGUE} signedIn={false} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
