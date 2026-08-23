import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { DRAFT_SCHEDULE, HOME, LINEUP, fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { LeagueHome } from "./league-home";

const wrap = (home = HOME, lineup = LINEUP) => (
  <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
    <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
      <LeagueHome home={home} lineup={lineup} />
    </LeagueRoomDepsProvider>
  </ChatRoomDepsProvider>
);

describe("LeagueHome", () => {
  it("shows the name, standings, this week's matchup and the lineup editor, in both themes, axe-clean", async () => {
    await inBothThemes(wrap(), async ({ container }) => {
      expect(screen.getByRole("heading", { level: 1, name: "Sunday Money" })).toBeInTheDocument();
      expect(screen.getByText("League standings")).toBeInTheDocument();
      expect(screen.getByText("Week 3")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save lineup" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Task 3 (Phase 3.5): `LeagueHome` threads `home.medianGame` through to `StandingsTable`
  // rather than the table silently defaulting to `false` on the one page that actually renders
  // real data — `HOME`'s own default is `false`, so the base render above already proves the
  // note is ABSENT by default; this proves it appears once the flag is on.
  it("shows the standings' median-game note once the league's own toggle is on", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, medianGame: true }} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText(/Records include each week's median game\./)).toBeInTheDocument();
  });

  // Task 10: reachable from where a member already is, beside the existing matchup link,
  // rather than only by typing the url directly.
  it("links to the league's activity feed beside the matchups link", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByRole("link", { name: "League activity" })).toHaveAttribute("href", `/app/leagues/${HOME.leagueId}/activity`);
    expect(screen.getByRole("link", { name: "All matchups" })).toHaveAttribute(
      "href",
      `/app/leagues/${HOME.leagueId}/matchups/${HOME.currentWeek}`,
    );
  });

  // Task 8: reachable from where a member already is, beside the existing activity link — the
  // badge count itself is `TradeInboxLink`'s own concern (`trade-inbox-link.test.tsx`); this
  // test only pins that the league home actually renders it, for a viewer who has a team.
  it("links to the league's trades page beside the activity link, for a viewer with a team", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: HOME.leagueId, meTeamId: HOME.myTeamId, inbox: [], outbox: [], history: [] } });
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixture.deps,
    );
    expect(await screen.findByRole("link", { name: /Trades/ })).toHaveAttribute("href", `/app/leagues/${HOME.leagueId}/trades`);
  });

  it("hides the trades link from a viewer with no team of their own, since the page itself would refuse them", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, myTeamId: null }} lineup={null} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByRole("link", { name: /Trades/ })).not.toBeInTheDocument();
  });

  // Task 9 e2e regression: `league-lifecycle.spec.ts` asserts on `getByRole("heading", { name:
  // leagueName })` with no level filter, and the terms panel's OWN `h2` — before this fix —
  // carried that exact same text as the page's `h1`, so the query resolved two elements and
  // failed with a Playwright strict-mode violation. Pinned here at the unit level too: only the
  // page's own `h1` may answer a heading query for the league's name.
  it("names the league in exactly one heading, not two", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getAllByRole("heading", { name: HOME.name })).toHaveLength(1);
    // The terms panel still shows the name — just not as a second heading.
    expect(screen.getByRole("region", { name: "League terms" })).toHaveTextContent(HOME.name);
  });

  it("shows the commissioner's tools only to the commissioner", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByRole("button", { name: "Create invite link" })).toBeInTheDocument();
  });

  it("hides them from everybody else", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, isCommissioner: false }} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByRole("button", { name: "Create invite link" })).not.toBeInTheDocument();
  });

  // Task 8: the commissioner's own window onto platform moderation in their league — a member
  // with extra buttons, not an operator, so it sits behind the identical `isCommissioner` gate
  // `InvitePanel` already does, right beside it.
  it("shows the commissioner's moderation window only to the commissioner", async () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(await screen.findByRole("region", { name: "Platform moderation in this league" })).toBeInTheDocument();
  });

  it("hides the moderation window from everybody else", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, isCommissioner: false }} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByRole("region", { name: "Platform moderation in this league" })).not.toBeInTheDocument();
  });

  // The commissioner's "Score Week" control is retired — a feed that finalizes a week when the
  // games end makes manual scoring not a control but the ability to stamp a week the games have
  // not finished. The week's state now reads honestly off WeekStatusBadge instead.
  it("no longer offers a manual scoring control to anyone, commissioner included", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByRole("button", { name: /^Score Week/ })).not.toBeInTheDocument();
  });

  // Persona review (commissioner, FIX 3): the button vanished with zero in-product explanation.
  // Same visibility the button had — commissioner only — but now a sentence instead of a
  // control, so the absence reads as a designed change rather than a missing feature.
  it("tells the commissioner scores run themselves now, in both themes, axe-clean", async () => {
    await inBothThemes(wrap(), async ({ container }) => {
      expect(
        screen.getByText("Scores update automatically as games finish. There's nothing to run by hand."),
      ).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("keeps that explanation away from a non-commissioner", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, isCommissioner: false }} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByText(/nothing to run by hand/)).not.toBeInTheDocument();
  });

  // Task 6, fix round 1: `home.draftSchedule` is now this panel's whole initial read, riding the
  // SAME server render as `home.draftStatus` — a "scheduled" draft renders the panel's own
  // scheduled state, synchronously, the time, the countdown, and (for the commissioner `HOME`
  // names) the edit and start controls.
  it("shows the scheduled draft's time and start control while it has not finished", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome
          home={{ ...HOME, draftStatus: "scheduled", draftSchedule: { ...DRAFT_SCHEDULE, status: "scheduled", kickoffAt: "2099-01-01T00:00:00.000Z" } }}
          lineup={null}
        />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText("Draft scheduled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start the draft" })).toBeInTheDocument();
    expect(screen.queryByText(/hasn't drafted yet/)).not.toBeInTheDocument();
  });

  // Task 6, Phase 3.5: NFFC's Kentucky Derby System.
  it("shows the slot-preference panel from the same server render as the draft schedule", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome
          home={{ ...HOME, draftStatus: "scheduled", draftSchedule: { ...DRAFT_SCHEDULE, status: "scheduled", slotPreference: { slotCount: 12, ranking: [], assignedSlot: null, canEdit: true } } }}
          lineup={null}
        />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText(/Rank the slots you want/)).toBeInTheDocument();
  });

  it("says nothing about a slot preference for a caller with no team in this league", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome
          home={{ ...HOME, myTeamId: null, draftSchedule: { ...DRAFT_SCHEDULE, slotPreference: null } }}
          lineup={null}
        />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByText(/Rank the slots you want/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Draft slot/)).not.toBeInTheDocument();
  });

  // Task 12 review follow-up: "scheduled" and "in_progress" are different moments. A manager
  // whose draft is live needs "join now", not "hasn't drafted yet".
  it("switches to live-draft copy while the draft is in progress", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome
          home={{ ...HOME, draftStatus: "in_progress", draftSchedule: { ...DRAFT_SCHEDULE, status: "in_progress" } }}
          lineup={null}
        />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText("The draft is live")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join the draft" })).toHaveAttribute("href", `/app/drafts/${HOME.draftId}`);
    expect(screen.queryByText(/hasn't drafted yet/)).not.toBeInTheDocument();
  });

  it("says so plainly when this manager has no matchup this week, in both themes", async () => {
    await inBothThemes(wrap({ ...HOME, myMatchup: null }, LINEUP), async ({ container }) => {
      expect(screen.getByText(/no matchup this week/i)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("handles a viewer with no team of their own", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, myTeamId: null, myMatchup: null }} lineup={null} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByRole("button", { name: "Save lineup" })).not.toBeInTheDocument();
    expect(screen.getByText("League standings")).toBeInTheDocument();
  });

  it("mounts the league chat alongside the standings", async () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    await waitFor(() => expect(screen.getByRole("region", { name: "League chat" })).toBeInTheDocument());
  });

  // L2, final review: in document flow (unlike the draft room's fixed-height aside band),
  // LeagueChat's own h-full/flex-1 chain resolves to auto and grows unbounded. The mount needs
  // its own bounded height so the panel scrolls internally instead of the page growing to fit
  // every held message.
  it("bounds the chat mount to a fixed height so it scrolls internally rather than growing the page", async () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    const chat = await waitFor(() => screen.getByRole("region", { name: "League chat" }));
    expect(chat.parentElement).toHaveClass("h-96");
  });

  it("offers the advisor to a manager with a team", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByRole("region", { name: "Lineup advisor" })).toBeInTheDocument();
  });

  // Task 8: trust is not a one-time disclosure. The same `LeagueTermsPanel` the invite preview
  // renders shows up here too, fed by `home.terms` rather than a second fetch, and for every
  // member — gating it on `isCommissioner` would make the surface pointless, since the terms are
  // what everybody in the league is playing under.
  it("shows the league terms panel, fed from the home body, for every viewer", async () => {
    await inBothThemes(
      wrap({ ...HOME, isCommissioner: false }),
      async ({ container }) => {
        const panel = screen.getByRole("region", { name: "League terms" });
        expect(within(panel).getByText(HOME.terms.rosterLine)).toBeInTheDocument();
        expect(within(panel).getByText(HOME.terms.commissionerName)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // First-timer persona review, fix round 1: the "joining puts you in the draft..." sentence
  // belongs to the INVITE flow only (`JoinForm`) — it must never render post-join, where a
  // member reading their own league is already in the draft and the season, and the line would
  // be stale rather than informative.
  it("never shows the invite flow's 'joining means' sentence once you're already in the league", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(
      screen.queryByText("Joining puts you in the draft and the season that follows. You'll set a lineup every week."),
    ).not.toBeInTheDocument();
  });

  // Step 15's audit: a league had no members list at all. It renders for every member, not
  // just the commissioner — the invite panel below it stays commissioner-only, but knowing who
  // is in the league is not a commissioner-only fact.
  it("shows the league's members list, naming the commissioner, for every viewer", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, isCommissioner: false }} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    const list = screen.getByRole("list", { name: "Managers" });
    // "Commissioner" is now ambiguous at the page level: the terms panel's own label reads the
    // same word. Scoped to the members list, this is still the commissioner BADGE.
    expect(within(list).getByText("Commissioner")).toBeInTheDocument();
    expect(screen.getByText("9 seats still open")).toBeInTheDocument();
  });
});
