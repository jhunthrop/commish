import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { ScoreWeekButton } from "./score-week-button";
import { LeagueRoomDepsProvider } from "../hooks/deps";

// `ScoreWeekButton` calls `router.refresh()` via `next/navigation`'s `useRouter` on success,
// which throws outside a mounted App Router. Stubbing the hook — not the component — is the
// idiom `join-form.test.tsx` and `create-league-panel.test.tsx` established.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("ScoreWeekButton", () => {
  it("names the week it will score, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { weekNumber: 3, matchupsScored: 6 } });
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <ScoreWeekButton leagueId="l1" weekNumber={3} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByRole("button", { name: "Score Week 3" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("scores the week and confirms what happened", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { weekNumber: 3, matchupsScored: 6 } });
    renderInLeague(<ScoreWeekButton leagueId="l1" weekNumber={3} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Score Week 3" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Scored 6 matchups."));
    expect(fixture.calls).toEqual(["POST /api/leagues/l1/weeks/3/score"]);
  });

  it("shows the server's reason when it can't", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "That week isn't part of this league's season." });
    renderInLeague(<ScoreWeekButton leagueId="l1" weekNumber={3} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Score Week 3" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("isn't part of this league's season"));
  });
});
