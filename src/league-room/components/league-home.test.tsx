import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
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
  <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
    <LeagueHome home={home} lineup={lineup} />
  </LeagueRoomDepsProvider>
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
    renderInLeague(<LeagueHome home={HOME} lineup={LINEUP} />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: "Create invite link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Score Week 3" })).toBeInTheDocument();
  });

  it("hides them from everybody else", () => {
    renderInLeague(<LeagueHome home={{ ...HOME, isCommissioner: false }} lineup={LINEUP} />, fixtureLeagueDeps().deps);
    expect(screen.queryByRole("button", { name: "Create invite link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Score Week 3" })).not.toBeInTheDocument();
  });

  it("points at the draft room while the draft has not finished", () => {
    renderInLeague(<LeagueHome home={{ ...HOME, draftStatus: "scheduled" }} lineup={null} />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("link", { name: /draft room/i })).toHaveAttribute("href", `/app/drafts/${HOME.draftId}`);
    expect(screen.getByText(/hasn't drafted yet/)).toBeInTheDocument();
  });

  it("says so plainly when this manager has no matchup this week, in both themes", async () => {
    await inBothThemes(wrap({ ...HOME, myMatchup: null }, LINEUP), async ({ container }) => {
      expect(screen.getByText(/no matchup this week/i)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("handles a viewer with no team of their own", () => {
    renderInLeague(<LeagueHome home={{ ...HOME, myTeamId: null, myMatchup: null }} lineup={null} />, fixtureLeagueDeps().deps);
    expect(screen.queryByRole("button", { name: "Save lineup" })).not.toBeInTheDocument();
    expect(screen.getByText("League standings")).toBeInTheDocument();
  });
});
