import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { WaitingRoom, type WaitingRoomLeague } from "./waiting-room";

const BASE: WaitingRoomLeague = {
  draftId: "draft_1",
  leagueId: "league_1",
  status: "scheduled",
  kickoffAt: "2026-09-01T00:00:00.000Z",
  isPublicMatchmade: true,
  startTrigger: "when_full",
  filledTeams: 9,
  teamCount: 12,
  slotPreference: null,
  authority: { kind: "member", userId: "commish_1" },
};

/** Phase 3.5 addendum, Task 14, Step 4: the house case — no member holds an invite code to a
 *  room the platform runs, ruling 33. */
const houseFilling: WaitingRoomLeague = {
  ...BASE,
  authority: { kind: "house", rung: "sitandgo_12" },
};

const fullSitAndGo: WaitingRoomLeague = {
  ...BASE,
  filledTeams: 12,
  // Five minutes out — `MATCHMAKING_CONFIG.sitAndGo.graceSeconds`'s own default — so the "Starts
  // in …" sentence reads a real duration rather than "starting any moment".
  kickoffAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
};

describe("WaitingRoom", () => {
  // Never a dead end, in its hardest form: the member cannot have a draft yet, so the panel
  // offers the two things a half-full league can actually give instead.
  it("offers the thing a half-full league can actually give, in both themes, axe-clean", async () => {
    await renderSurface(<WaitingRoom league={BASE} isCommissioner={true} />, async ({ container }) => {
      expect(screen.getByText("9 of 12 seats taken")).toBeVisible();
      expect(screen.getByRole("link", { name: "Invite someone" })).toBeVisible();
      expect(screen.getByRole("link", { name: "See leagues closer to filling" })).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("reassures a member that leaving is fine — we'll say when it fills", () => {
    render(<WaitingRoom league={BASE} isCommissioner={true} />);
    expect(screen.getByText("You don't have to wait here. We'll let you know the moment it fills.")).toBeInTheDocument();
  });

  it("offers no invite link to a member who isn't the commissioner, but still offers somewhere to go", () => {
    render(<WaitingRoom league={BASE} isCommissioner={false} />);
    expect(screen.queryByRole("link", { name: "Invite someone" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See leagues closer to filling" })).toBeInTheDocument();
  });

  it("links the invite action at the room's own invite section", () => {
    render(<WaitingRoom league={BASE} isCommissioner={true} />);
    expect(screen.getByRole("link", { name: "Invite someone" })).toHaveAttribute("href", "/app/leagues/league_1#invite-managers");
  });

  it("wraps its actions for 360px", () => {
    render(<WaitingRoom league={BASE} isCommissioner={true} />);
    const link = screen.getByRole("link", { name: "See leagues closer to filling" });
    expect(link.parentElement?.className).toMatch(/flex-wrap/);
  });

  // Counts down once the last seat fills, and says who is starting it — the shared `Countdown`
  // primitive's third caller.
  it("counts down once the last seat fills, and says when it starts, in both themes, axe-clean", async () => {
    await renderSurface(<WaitingRoom league={fullSitAndGo} isCommissioner={true} />, async ({ container }) => {
      expect(screen.getByText("All 12 seats are full.")).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent(/starts in/i);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("ticks visible digits, hidden from assistive tech, for the full-and-counting-down state", () => {
    render(<WaitingRoom league={fullSitAndGo} isCommissioner={true} />);
    expect(screen.getByTestId("waiting-room-countdown")).toHaveAttribute("aria-hidden", "true");
  });

  it("answers the first-timer's question honestly once the countdown is running", () => {
    render(<WaitingRoom league={fullSitAndGo} isCommissioner={true} />);
    expect(screen.getByText(/the room autopicks for you/i)).toBeInTheDocument();
  });

  it("offers no invite/browse links once the league has already filled", () => {
    render(<WaitingRoom league={fullSitAndGo} isCommissioner={true} />);
    expect(screen.queryByRole("link", { name: "Invite someone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See leagues closer to filling" })).not.toBeInTheDocument();
  });

  it("shows a link into the room while the draft is live, in both themes, axe-clean", async () => {
    const live: WaitingRoomLeague = { ...fullSitAndGo, status: "in_progress" };
    await renderSurface(<WaitingRoom league={live} isCommissioner={true} />, async ({ container }) => {
      expect(screen.getByText("The draft is live")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Join the draft" })).toHaveAttribute("href", "/app/drafts/draft_1");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("shows a designed complete state with a link into the finished board, in both themes, axe-clean", async () => {
    const complete: WaitingRoomLeague = { ...fullSitAndGo, status: "complete" };
    await renderSurface(<WaitingRoom league={complete} isCommissioner={true} />, async ({ container }) => {
      expect(screen.getByText("Draft complete")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View the draft board" })).toHaveAttribute("href", "/app/drafts/draft_1");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("walks the filling state's two actions keyboard-only", async () => {
    const user = userEvent.setup();
    render(<WaitingRoom league={BASE} isCommissioner={true} />);

    await user.tab();
    expect(screen.getByRole("link", { name: "Invite someone" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "See leagues closer to filling" })).toHaveFocus();
  });

  // Phase 3.5 addendum, Task 14, Step 4. The gate reads `league.authority.kind`, the wire union
  // Task 12 shipped, never a page-local recomputation — `isCommissioner={true}` here is
  // deliberately the impossible case (nobody is ever commissioner of a house league,
  // `isCommissionerOf`'s own docblock) to prove the authority check is what actually hides the
  // link, not a value this test could never seed wrong.
  it("never offers Invite for a house league, even if isCommissioner were somehow true", () => {
    render(<WaitingRoom league={houseFilling} isCommissioner={true} />);
    expect(screen.queryByRole("link", { name: "Invite someone" })).not.toBeInTheDocument();
  });

  it("offers the rest of the shelf instead, for a house league's filling state", () => {
    render(<WaitingRoom league={houseFilling} isCommissioner={false} />);
    expect(screen.getByRole("link", { name: "See the rest of the shelf" })).toHaveAttribute("href", "/browse");
    expect(screen.queryByText("See leagues closer to filling")).not.toBeInTheDocument();
  });
});
