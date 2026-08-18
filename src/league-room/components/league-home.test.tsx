import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { HOME, LINEUP, fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { LeagueHome } from "./league-home";

// `LeagueHome` renders `ScoreWeekButton` for its commissioner, which navigates via
// `next/navigation`'s `useRouter` and throws outside a mounted App Router. Stubbing the hook
// — not the component — is the idiom `join-form.test.tsx` and `create-league-panel.test.tsx`
// established.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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

  it("shows the commissioner's tools only to the commissioner", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByRole("button", { name: "Create invite link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Score Week 3" })).toBeInTheDocument();
  });

  it("hides them from everybody else", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, isCommissioner: false }} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByRole("button", { name: "Create invite link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Score Week 3" })).not.toBeInTheDocument();
  });

  it("points at the draft room while the draft has not finished", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, draftStatus: "scheduled" }} lineup={null} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByRole("link", { name: /draft room/i })).toHaveAttribute("href", `/app/drafts/${HOME.draftId}`);
    expect(screen.getByText(/hasn't drafted yet/)).toBeInTheDocument();
  });

  // Task 12 review follow-up: "scheduled" and "in_progress" are different moments. A manager
  // whose draft is live needs "join now", not "hasn't drafted yet".
  it("switches to live-draft copy while the draft is in progress", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={{ ...HOME, draftStatus: "in_progress" }} lineup={null} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText("Your draft is live right now.")).toBeInTheDocument();
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

  it("offers the advisor to a manager with a team", () => {
    renderInLeague(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <LeagueHome home={HOME} lineup={LINEUP} />
      </ChatRoomDepsProvider>,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByRole("region", { name: "Lineup advisor" })).toBeInTheDocument();
  });
});
