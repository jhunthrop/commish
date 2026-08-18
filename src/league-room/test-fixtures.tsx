import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { LeagueSummary } from "./contract";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "./hooks/deps";

export const LEAGUES: readonly LeagueSummary[] = [
  {
    id: "l1", name: "Sunday Money", format: "snake", teamCount: 12, filledTeams: 8,
    isCommissioner: true, myTeamId: "t1", draftId: "d1", draftStatus: "scheduled",
  },
  {
    id: "l2", name: "Auction Night", format: "auction", teamCount: 10, filledTeams: 10,
    isCommissioner: false, myTeamId: "t9", draftId: "d2", draftStatus: "complete",
  },
];

export interface FixtureLeagueDeps {
  deps: LeagueRoomDeps;
  readonly calls: string[];
  /** Mutable: set the envelope the next POST/PUT should answer with. */
  response: unknown;
}

/** One injected `fetchJson` for every league component. No module mocks, no real network. */
export function fixtureLeagueDeps(response: unknown = { ok: true, data: {} }): FixtureLeagueDeps {
  const fixture: FixtureLeagueDeps = {
    calls: [],
    response,
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        return { json: async () => fixture.response } as unknown as Response;
      },
    },
  };
  return fixture;
}

export function renderInLeague(ui: ReactElement, deps: LeagueRoomDeps): RenderResult {
  return render(<LeagueRoomDepsProvider deps={deps}>{ui}</LeagueRoomDepsProvider>);
}
