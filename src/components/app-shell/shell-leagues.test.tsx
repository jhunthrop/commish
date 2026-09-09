import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SearchResult } from "@/search/contract";
import { leagueForPlayerLinks, searchResultHref, ShellLeaguesProvider, usePlayerPageHref } from "./shell-leagues";

let pathname: string | null = "/app";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const GIBBS: SearchResult = {
  kind: "player",
  player: { id: "rb1", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", headshotUrl: null, adp: null },
  positionRank: 2,
  boardRank: 3,
  byeWeek: 8,
  rosterStatus: null,
};
const LIONS: SearchResult = { kind: "team", code: "DET", name: "Detroit Lions", byeWeek: 8 };

describe("leagueForPlayerLinks", () => {
  it("prefers the league the reader is standing in", () => {
    expect(leagueForPlayerLinks("/app/leagues/lg_here/matchups/3", ["lg_first", "lg_second"])).toBe("lg_here");
  });

  it("falls back to the first league in the rail, then to none", () => {
    expect(leagueForPlayerLinks("/app/wallet", ["lg_first", "lg_second"])).toBe("lg_first");
    expect(leagueForPlayerLinks(null, ["lg_first"])).toBe("lg_first");
    expect(leagueForPlayerLinks("/app/teams/DET", [])).toBeNull();
  });
});

describe("searchResultHref", () => {
  it("sends a team to its page and a player to his page in the chosen league", () => {
    expect(searchResultHref(LIONS, "lg1")).toBe("/app/teams/DET");
    expect(searchResultHref(GIBBS, "lg1")).toBe("/app/leagues/lg1/players/rb1");
  });

  it("sends a player to his club's page when the reader has no league, never to a 404", () => {
    expect(searchResultHref(GIBBS, null)).toBe("/app/teams/DET");
  });
});

function Probe() {
  const hrefFor = usePlayerPageHref();
  return <p>{hrefFor("rb1") ?? "none"}</p>;
}

describe("usePlayerPageHref", () => {
  it("reads the rail from the provider and the league from the path", () => {
    pathname = "/app/teams/DET";
    render(
      <ShellLeaguesProvider leagueIds={["lg_first"]}>
        <Probe />
      </ShellLeaguesProvider>,
    );
    expect(screen.getByText("/app/leagues/lg_first/players/rb1")).toBeInTheDocument();
  });

  it("answers null outside any provider for a reader with no league", () => {
    pathname = "/app/teams/DET";
    render(<Probe />);
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});
