import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { renderSurface } from "@/components/ui/test-utils";
import { UI_CONFIG } from "@/components/ui/config";
import type { LeagueMemberCard } from "../contract";
import { WaitingRoom, type WaitingRoomLeague } from "./waiting-room";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const BASE: WaitingRoomLeague = {
  draftId: "draft_1",
  leagueId: "league_1",
  status: "scheduled",
  kickoffAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  isPublicMatchmade: true,
  startTrigger: "scheduled",
  kickoffRolls: 0,
  filledTeams: 10,
  teamCount: 12,
  slotPreference: null,
  missedDraft: false,
  authority: { kind: "member", userId: "commish_1" },
};

const scheduledAndFilling: WaitingRoomLeague = { ...BASE };

const whenFullAndFilling: WaitingRoomLeague = {
  ...BASE,
  startTrigger: "when_full",
  filledTeams: 4,
  kickoffAt: BASE.kickoffAt,
};

const rolledOnce: WaitingRoomLeague = { ...BASE, kickoffRolls: 1 };

const draftedWithoutYou: WaitingRoomLeague = {
  ...BASE,
  status: "complete",
  missedDraft: true,
  // Noon UTC on a Thursday — clear of the midnight boundary in any real-world timezone this
  // suite might run under, the same "read a real instant, not a fragile literal" discipline
  // `draft-schedule-panel.test.tsx`'s own fixtures use.
  kickoffAt: "2026-08-20T12:00:00.000Z",
};

/** Phase 3.5 addendum, Task 14, Step 4: the house case — no member holds an invite code to a
 *  room the platform runs, ruling 33. */
const houseFilling: WaitingRoomLeague = {
  ...whenFullAndFilling,
  authority: { kind: "house", rung: "sitandgo_12" },
};

const fullSitAndGo: WaitingRoomLeague = {
  ...BASE,
  startTrigger: "when_full",
  filledTeams: 12,
  // Five minutes out — `MATCHMAKING_CONFIG.sitAndGo.graceSeconds`'s own default — so the "Starts
  // in …" sentence reads a real duration rather than "starting any moment".
  kickoffAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
};

describe("WaitingRoom", () => {
  it("counts down to a scheduled draft and states the fill in the same breath", () => {
    render(<WaitingRoom league={scheduledAndFilling} />);
    expect(screen.getByTestId("waiting-room-countdown")).toBeInTheDocument();
    expect(screen.getByText("10 of 12 seated. 2 seats left.")).toBeInTheDocument();
  });

  it("replaces the countdown with the fill meter when there is nothing to count down to", () => {
    render(<WaitingRoom league={whenFullAndFilling} />);
    expect(screen.queryByTestId("waiting-room-countdown")).toBeNull();
    expect(screen.getByText("4 of 12 seated")).toBeInTheDocument();
  });

  it("says why the date moved, rather than quietly showing a different one", () => {
    render(<WaitingRoom league={rolledOnce} />);
    expect(screen.getByText("This draft moved once because the room was not full.")).toBeInTheDocument();
  });

  it("tells a member who missed the draft what happened to their team", () => {
    render(<WaitingRoom league={draftedWithoutYou} />);
    expect(screen.getByText("The draft ran on Thursday and the room picked for you from your queue.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See your roster" })).toBeInTheDocument();
  });

  it("speaks the house register, with no contractions anywhere on the screen", () => {
    const { container } = render(<WaitingRoom league={whenFullAndFilling} />);
    expect(container.textContent).not.toMatch(/\b\w+'(t|ll|re|ve|s|d|m)\b/);
    expect(container.textContent).toContain("You do not have to wait here.");
  });

  it("shows a manager who just sat down that they are in, and which seat is theirs", () => {
    render(<WaitingRoom league={{ ...scheduledAndFilling, filledTeams: 10 }} leagueName="Half-PPR #241" justSeated />);
    expect(screen.getByText("Half-PPR #241 · You're in")).toBeInTheDocument();
    expect(screen.getByText("You claimed seat 10 of 12 just now.")).toBeInTheDocument();
  });

  it("stops being a moment once it stops being true, with nothing stored and nothing to dismiss", () => {
    render(<WaitingRoom league={scheduledAndFilling} justSeated={false} />);
    expect(screen.queryByText(/You're in/)).toBeNull();
  });

  it("softens the seating moment's copy for a caller whose hold ran out, without claiming anything untrue", () => {
    render(<WaitingRoom league={scheduledAndFilling} leagueName="Half-PPR #241" justSeated holdExpired />);
    expect(screen.getByText("Your hold ran out, so we seated you the ordinary way.")).toBeInTheDocument();
    // Still says the true thing — the forgeable param only ever softens, never decides.
    expect(screen.getByText("You're in", { exact: false })).toBeInTheDocument();
  });

  // P9 fix round, H2: the two hero states this task itself composes (never delegated to
  // `DraftSchedulePanel`) plus the just-seated moment, each in both themes, axe-clean.
  it("is axe-clean while the when_full room is still filling (the promoted meter, no countdown)", async () => {
    await renderSurface(<WaitingRoom league={whenFullAndFilling} isCommissioner={true} />, async ({ container }) => {
      expect(screen.getByText("4 of 12 seated")).toBeInTheDocument();
      expect(screen.queryByTestId("waiting-room-countdown")).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("is axe-clean once the when_full room is full and counting down", async () => {
    await renderSurface(<WaitingRoom league={fullSitAndGo} isCommissioner={true} />, async ({ container }) => {
      expect(screen.getByTestId("waiting-room-countdown")).toBeInTheDocument();
      expect(screen.getByText("12 of 12 seated")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("is axe-clean on the just-seated moment", async () => {
    await renderSurface(<WaitingRoom league={scheduledAndFilling} leagueName="Half-PPR #241" justSeated />, async ({ container }) => {
      expect(screen.getByText("Half-PPR #241 · You're in")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("gives the seat-filler who completed the room BOTH the welcome and the countdown, axe-clean", async () => {
    // The composed D1+D3 state the checkpoint reconciliation created: the manager whose own join
    // filled the last when_full seat is just-seated AND the room is full, so the welcome card and
    // the full-seat countdown hero must render together — for the whole grace window this pairing
    // is what that person sees. Pinned at the unit level per this file's axe-per-state convention.
    await renderSurface(<WaitingRoom league={fullSitAndGo} leagueName="Sit and Go #7" justSeated />, async ({ container }) => {
      expect(screen.getByText("Sit and Go #7 · You're in")).toBeInTheDocument();
      expect(screen.getByTestId("waiting-room-hero")).toBeInTheDocument();
      expect(screen.getByTestId("waiting-room-countdown")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("shows a link into the room while the draft is live, in both themes, axe-clean", async () => {
    const live: WaitingRoomLeague = { ...fullSitAndGo, status: "in_progress" };
    await renderSurface(<WaitingRoom league={live} />, async ({ container }) => {
      expect(screen.getByText("The draft is live")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Join the draft" })).toHaveAttribute("href", "/app/drafts/draft_1");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("shows a designed complete state with a link into the finished board when the caller did not miss it", async () => {
    const complete: WaitingRoomLeague = { ...fullSitAndGo, status: "complete", missedDraft: false, currentWeek: 1 };
    await renderSurface(<WaitingRoom league={complete} />, async ({ container }) => {
      expect(screen.getByText("Draft complete")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View the draft board" })).toHaveAttribute("href", "/app/drafts/draft_1");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Gauntlet fix wave, NEW-8: this panel used to hold the hero slot forever on a `when_full`
  // league too — same fix as `DraftSchedulePanel`'s own (`draftTerminalStatePanel`'s shared
  // expiry), reached here through `WaitingRoom`'s own direct call rather than through the panel.
  it("yields its own terminal panel once the season is past its regular-season window", () => {
    const complete: WaitingRoomLeague = { ...fullSitAndGo, status: "complete", missedDraft: false, currentWeek: 15, totalWeeks: 14 };
    render(<WaitingRoom league={complete} />);
    expect(screen.queryByText("Draft complete")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View the draft board" })).not.toBeInTheDocument();
  });

  // Task 12 fix round 1 (F1): `LeagueHome`'s own `DraftCompleteArrival` already shows this exact
  // moment, more richly, during the SAME window `draftJustCompleted` names — this panel would
  // double the message. The "View the draft board" link this panel would have shown moves to
  // that arrival instead (`league-home.test.tsx` proves it lands there).
  it("suppresses its own terminal panel while draftJustCompleted is true, in both themes, axe-clean", async () => {
    const complete: WaitingRoomLeague = { ...fullSitAndGo, status: "complete", missedDraft: false };
    await renderSurface(<WaitingRoom league={complete} draftJustCompleted />, async ({ container }) => {
      expect(screen.queryByText("Draft complete")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "View the draft board" })).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("brings its own terminal panel back once draftJustCompleted goes false again — the arrival's window closing, not a code change", () => {
    const complete: WaitingRoomLeague = { ...fullSitAndGo, status: "complete", missedDraft: false };
    render(<WaitingRoom league={complete} draftJustCompleted={false} />);
    expect(screen.getByText("Draft complete")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the draft board" })).toBeInTheDocument();
  });

  // `draftJustCompleted` is never true alongside a live draft in production (`LeagueHome`'s own
  // predicate requires `draftStatus === "complete"`), but the guard is defensive, not assumed —
  // pinned here so the terminal `in_progress` panel can never be suppressed by mistake.
  it("never suppresses the in-progress terminal panel, even if draftJustCompleted were somehow true", () => {
    const live: WaitingRoomLeague = { ...fullSitAndGo, status: "in_progress" };
    render(<WaitingRoom league={live} draftJustCompleted />);
    expect(screen.getByText("The draft is live")).toBeInTheDocument();
  });

  it("offers the thing a half-full house league can actually give, and no invite link nobody can act on", () => {
    render(<WaitingRoom league={houseFilling} isCommissioner={true} />);
    expect(screen.queryByRole("link", { name: "Invite someone" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the rest of the shelf" })).toHaveAttribute("href", "/browse");
  });

  it("offers the invite link to a member league's commissioner while it is still filling", () => {
    render(<WaitingRoom league={whenFullAndFilling} isCommissioner={true} leagueName="Rookie Room" />);
    expect(screen.getByRole("link", { name: "Invite someone" })).toHaveAttribute("href", "/app/leagues/league_1#invite-managers");
  });

  it("offers no invite/browse links once the league has already filled", () => {
    render(<WaitingRoom league={fullSitAndGo} isCommissioner={true} />);
    expect(screen.queryByRole("link", { name: "Invite someone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See leagues closer to filling" })).not.toBeInTheDocument();
  });

  // M5 (P9 fix round): restored from the pre-rewrite file — dropped in the Task 9 rewrite with
  // no successor.
  it("wraps its actions for 360px", () => {
    render(<WaitingRoom league={whenFullAndFilling} isCommissioner={true} />);
    const link = screen.getByRole("link", { name: "See leagues closer to filling" });
    expect(link.parentElement?.className).toMatch(/flex-wrap/);
  });

  it("walks the filling state's two actions keyboard-only", async () => {
    const user = userEvent.setup();
    render(<WaitingRoom league={whenFullAndFilling} isCommissioner={true} />);

    await user.tab();
    expect(screen.getByRole("link", { name: "Invite someone" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "See leagues closer to filling" })).toHaveFocus();
  });

  it("plays the room-going-full transition: the meter completes, then the countdown replaces it (D3)", () => {
    vi.useFakeTimers();
    stubMatchMedia(false);
    const filling: WaitingRoomLeague = { ...whenFullAndFilling, filledTeams: 11 };
    const full: WaitingRoomLeague = { ...filling, filledTeams: 12, kickoffAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
    const { rerender } = render(<WaitingRoom league={filling} />);
    rerender(<WaitingRoom league={full} />);

    expect(screen.getByText("12 of 12 seated")).toBeInTheDocument();
    expect(screen.queryByTestId("waiting-room-countdown")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(UI_CONFIG.waitingRoom.fillCelebrationMs);
    });
    expect(screen.getByTestId("waiting-room-countdown")).toBeInTheDocument();
  });

  it("skips the transition entirely under reduced motion: the countdown appears with no pause", () => {
    stubMatchMedia(true);
    const filling: WaitingRoomLeague = { ...whenFullAndFilling, filledTeams: 11 };
    const full: WaitingRoomLeague = { ...filling, filledTeams: 12, kickoffAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
    const { rerender } = render(<WaitingRoom league={filling} />);
    rerender(<WaitingRoom league={full} />);
    expect(screen.getByTestId("waiting-room-countdown")).toBeInTheDocument();
  });

  const TEAMS: readonly LeagueMemberCard[] = [
    { id: "t1", name: "Bay Bandits", ownerDisplayName: "Alex Rivera", ownerAvatarUrl: null, ownerUserId: "u1" },
  ];

  it("renders the room roster once the caller supplies teams, and nothing when it does not", () => {
    const { rerender } = render(<WaitingRoom league={whenFullAndFilling} teams={TEAMS} compositionCategory="open" />);
    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    rerender(<WaitingRoom league={whenFullAndFilling} />);
    expect(screen.queryByText("Alex Rivera")).not.toBeInTheDocument();
  });

  // Gauntlet fix wave, NEW-9: `SeatMeter` used to render twice on this exact page — once in the
  // hero, once again in `RoomRoster`'s own header, both saying "N of 12 seated" within 200px of
  // each other. The hero's is the one that stays; `RoomRoster` still shows the composition badge.
  it("renders the seat meter's sentence exactly once, with the room roster on screen", () => {
    render(<WaitingRoom league={whenFullAndFilling} teams={TEAMS} compositionCategory="open" />);
    expect(screen.getAllByText(/of 12 seated/)).toHaveLength(1);
  });

  it("puts the room tour first for a first-timer (guided help), and last for everyone else", () => {
    const { rerender } = render(<WaitingRoom league={whenFullAndFilling} helpLevel="guided" />);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("See how the draft room works");
    rerender(<WaitingRoom league={whenFullAndFilling} helpLevel="standard" />);
    expect(screen.getAllByRole("listitem")[3]).toHaveTextContent("See how the draft room works");
  });

  // P9 fix round, P8-M3: `myTeamId`/`leagueName` wiring, driven end to end rather than assumed —
  // no test anywhere in this file previously passed a non-null `myTeamId` to a non-commissioner
  // caller, so `ReleaseSeatControl` never actually mounted and a prop-name typo on either wire
  // would have failed nothing. Checks the control's OWN text, and opens its confirm dialog to
  // prove `leagueName` itself reached the control (not just that SOME control rendered).
  it("wires myTeamId and leagueName through to a real ReleaseSeatControl, while the room is still filling", () => {
    render(<WaitingRoom league={whenFullAndFilling} isCommissioner={false} myTeamId="team_9" leagueName="Rookie Room" />);
    fireEvent.click(screen.getByRole("button", { name: "Release your seat" }));
    expect(screen.getByText(/Rookie Room/)).toBeInTheDocument();
  });

  it("wires myTeamId and leagueName through DraftSchedulePanel's own ReleaseSeatControl, for a scheduled draft", () => {
    render(<WaitingRoom league={scheduledAndFilling} isCommissioner={false} myTeamId="team_9" leagueName="Rookie Room" />);
    fireEvent.click(screen.getByRole("button", { name: "Release your seat" }));
    expect(screen.getByText(/Rookie Room/)).toBeInTheDocument();
  });

  it("opens the real room tour from the checklist's own control", () => {
    render(<WaitingRoom league={whenFullAndFilling} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview the room" }));
    expect(screen.getByRole("dialog", { name: "How this room works" })).toBeInTheDocument();
  });

  // Task 9, Step 1 (row 18): the tour item offers BOTH the preview and a real mock draft,
  // side by side — `?create=solo` is `DraftRoom`'s own immediate-solo contract.
  it("also offers a real mock draft beside the room tour", () => {
    render(<WaitingRoom league={whenFullAndFilling} />);
    expect(screen.getByRole("link", { name: "Run a mock draft" })).toHaveAttribute("href", "/app/mock-drafts?create=solo");
  });
});
