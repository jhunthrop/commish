import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { LINEUP, fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LineupEditor } from "./lineup-editor";
import { LeagueRoomDepsProvider } from "../hooks/deps";

describe("LineupEditor", () => {
  it("shows starters and bench with a labelled control per starting slot, in both themes", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: LINEUP });
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByLabelText("QB")).toBeInTheDocument();
        expect(screen.getByLabelText("RB")).toBeInTheDocument();
        expect(screen.getByText("Bench")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // Persona review (veteran, FIX 5): the whole-week lock is coarse and nothing said so before
  // this. Only meaningful while the editor is actually usable — a locked week has nothing left
  // to warn about, it has already happened.
  it("warns that the whole week locks at the first kickoff, only while unlocked", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: LINEUP });
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} />, fixture.deps);
    expect(screen.getByText("Lineups lock for the whole week when its first game kicks off.")).toBeInTheDocument();
  });

  it("saves the starting slots it was given and reports success", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: LINEUP });
    const bodies: unknown[] = [];
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("QB"), { target: { value: "qb2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save lineup" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      weekNumber: LINEUP.weekNumber,
      slots: [{ slot: "QB", slotIndex: 0, playerId: "qb2" }, { slot: "RB", slotIndex: 0, playerId: "rb1" }],
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Lineup saved."));
  });

  it("shows the server's reason verbatim when the lineup is rejected", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "RB is not eligible for the QB slot." });
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Save lineup" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("RB is not eligible for the QB slot."));
  });

  it("goes read-only once the week has started, and names when it reopens", async () => {
    const fixture = fixtureLeagueDeps();
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <LineupEditor leagueId="l1" lineup={{ ...LINEUP, locked: true }} totalWeeks={14} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.queryByRole("button", { name: "Save lineup" })).not.toBeInTheDocument();
        expect(
          screen.getByText("Week 5 has started, so its lineup can't change. You can set next week's lineup as soon as this week ends."),
        ).toBeInTheDocument();
        // The unlocked-only kickoff warning has no place here — the week already started.
        expect(screen.queryByText(/Lineups lock for the whole week/)).not.toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // Persona review (first-timer, FIX 4): naming the reopening condition is only honest if there
  // IS one. The season's last week has no next week — promising "next week's lineup" there
  // would be a lie the product would have to walk back seven days later.
  it("drops the reopening sentence on the season's final week — there is no next week", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<LineupEditor leagueId="l1" lineup={{ ...LINEUP, locked: true, weekNumber: 14 }} totalWeeks={14} />, fixture.deps);
    expect(screen.getByText("Week 14 has started, so its lineup can't change.")).toBeInTheDocument();
    expect(screen.queryByText(/next week/)).not.toBeInTheDocument();
  });
});
