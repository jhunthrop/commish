import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { ShellLeaguesProvider } from "@/components/app-shell/shell-leagues";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { fixtureLeagueDeps } from "@/league-room/test-fixtures";
import { EMPTY_TEAM, FULL_TEAM } from "../test-fixtures";
import { NOT_HELD } from "./section";
import { TeamPageView } from "./team-page-view";

let pathname = "/app/teams/DET";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const SECTION_TITLES = ["Coaches", "Offense profile", "Fantasy players", "Depth chart", "Target and touch competition", "Schedule", "Defense"];

function renderView(data: typeof FULL_TEAM, leagueIds: readonly string[] = ["lg_first"]) {
  return render(
    <ShellLeaguesProvider leagueIds={leagueIds}>
      <TeamPageView data={data} />
    </ShellLeaguesProvider>,
  );
}

describe("TeamPageView", () => {
  it("renders every section for a club the store holds everything about, axe-clean in both themes", async () => {
    await renderSurface(
      <ShellLeaguesProvider leagueIds={["lg_first"]}>
        <TeamPageView data={FULL_TEAM} />
      </ShellLeaguesProvider>,
      async ({ container }) => {
        expect(screen.getByRole("heading", { level: 1, name: "Detroit Lions" })).toBeInTheDocument();
        expect(screen.getByText("DET · Bye week 8")).toBeInTheDocument();
        expect(screen.getByText("15-2")).toBeInTheDocument();
        expect(screen.getAllByText("341")).toHaveLength(2);
        expect(screen.getByText("10.5")).toBeInTheDocument();
        expect(screen.getByText("Books win total, Aug 15, 2026")).toBeInTheDocument();
        for (const title of SECTION_TITLES) expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
        expect(screen.queryByText(NOT_HELD)).toBeNull();
        expect(screen.getByText("Dan Campbell")).toBeInTheDocument();
        expect(screen.getByText("Play caller, OC")).toBeInTheDocument();
        expect(screen.getAllByText("New this year")).toHaveLength(1);
        expect(screen.getByText("27.1")).toBeInTheDocument();
        expect(screen.getByText("9 of 32")).toBeInTheDocument();
        expect(screen.getByText("58%")).toBeInTheDocument();
        expect(screen.getByText("+2.4")).toBeInTheDocument();
        expect(screen.getByText("Board 3 · Tier A · ADP 4.1 · 312.4 pts")).toBeInTheDocument();
        expect(screen.getByText("ADP 150.2")).toBeInTheDocument();
        expect(screen.getByText("Week one chart, Aug 28, 2026")).toBeInTheDocument();
        expect(screen.getByText("Current chart, Sep 5, 2026")).toBeInTheDocument();
        expect(screen.getByText("Isiah Pacheco")).toBeInTheDocument();
        expect(screen.getByText("27%")).toBeInTheDocument();
        expect(screen.getByText("54%")).toBeInTheDocument();
        expect(screen.getByText("41")).toBeInTheDocument();
        expect(screen.getByText("vs NO")).toBeInTheDocument();
        expect(screen.getByText("@ PIT · vs MIN · @ CHI")).toBeInTheDocument();
        expect(screen.getByText("9 home · 8 road")).toBeInTheDocument();
        expect(screen.getByText("7.4")).toBeInTheDocument();
        // Once on the defense row's sticker in the roster, once as the ADP order figure.
        expect(screen.getAllByText("DEF4")).toHaveLength(2);
        expect(screen.getByText("ADP order")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("links every roster row and the defense to the analysis page in the reader's league", () => {
    pathname = "/app/leagues/lg_here/standings";
    renderView(FULL_TEAM);
    const roster = screen.getByRole("list", { name: "Fantasy players" });
    expect(within(roster).getByRole("link", { name: "Jahmyr Gibbs" })).toHaveAttribute("href", "/app/leagues/lg_here/players/4429795");
    expect(within(roster).getByRole("link", { name: "Detroit Lions" })).toHaveAttribute("href", "/app/leagues/lg_here/players/DST-DET");
    expect(screen.getByRole("link", { name: "Defense analysis page" })).toHaveAttribute("href", "/app/leagues/lg_here/players/DST-DET");
    pathname = "/app/teams/DET";
  });

  it("links every name in the depth chart and the three leader tables the same way, and leaves an unresolved name as text", () => {
    pathname = "/app/leagues/lg_here/standings";
    renderView(FULL_TEAM);
    const weekOne = screen.getByRole("table", { name: "Week one chart" });
    expect(within(weekOne).getByRole("link", { name: "Isiah Pacheco" })).toHaveAttribute("href", "/app/leagues/lg_here/players/4361529");
    const current = screen.getByRole("table", { name: "Current chart" });
    expect(within(current).getByRole("link", { name: "Jared Goff" })).toHaveAttribute("href", "/app/leagues/lg_here/players/3046779");
    expect(within(current).queryByRole("link", { name: "Luke Altmyer" })).toBeNull();
    expect(within(current).getByText("Luke Altmyer")).toBeInTheDocument();
    const targets = screen.getByRole("table", { name: "Targets" });
    expect(within(targets).getByRole("link", { name: "Amon-Ra St. Brown" })).toHaveAttribute("href", "/app/leagues/lg_here/players/4374302");
    const carries = screen.getByRole("table", { name: "Carries" });
    expect(within(carries).getByRole("link", { name: "Jahmyr Gibbs" })).toHaveAttribute("href", "/app/leagues/lg_here/players/4429795");
    expect(within(carries).queryByRole("link", { name: "David Montgomery" })).toBeNull();
    expect(within(carries).getByText("David Montgomery")).toBeInTheDocument();
    const redZone = screen.getByRole("table", { name: "Red-zone touches" });
    expect(within(redZone).getByRole("link", { name: "Jahmyr Gibbs" })).toHaveAttribute("href", "/app/leagues/lg_here/players/4429795");
    // The column headers are untouched by the links.
    expect(within(carries).getByRole("columnheader", { name: "Player" })).toBeInTheDocument();
    pathname = "/app/teams/DET";
  });

  it("opens the peek in place on a plain click, and leaves a modified click to the anchor", async () => {
    pathname = "/app/leagues/lg_here/standings";
    const fixture = fixtureLeagueDeps({ ok: false, error: "not in this test" });
    render(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <ShellLeaguesProvider leagueIds={["lg_first"]}>
          <TeamPageView data={FULL_TEAM} />
        </ShellLeaguesProvider>
      </LeagueRoomDepsProvider>,
    );
    const carries = screen.getByRole("table", { name: "Carries" });
    const link = within(carries).getByRole("link", { name: "Jahmyr Gibbs" });
    const modified = fireEvent.click(link, { metaKey: true, detail: 1 });
    expect(modified).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    const plain = fireEvent.click(link, { detail: 1 });
    expect(plain).toBe(false);
    expect(await screen.findByRole("dialog", { name: "Jahmyr Gibbs" })).toBeInTheDocument();
    expect(fixture.calls).toEqual(["GET /api/leagues/lg_here/player-season?playerId=4429795"]);
    pathname = "/app/teams/DET";
  });

  it("renders the rows without links for a reader with no league, never a link that dies", () => {
    renderView(FULL_TEAM, []);
    expect(screen.queryByRole("link", { name: "Jahmyr Gibbs" })).toBeNull();
    expect(within(screen.getByRole("list", { name: "Fantasy players" })).getByText("Jahmyr Gibbs")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Defense analysis page" })).toBeNull();
    expect(within(screen.getByRole("table", { name: "Carries" })).queryAllByRole("link")).toHaveLength(0);
  });

  it("renders headings and the absence line only, never a zero, for a club the store holds nothing about", async () => {
    await renderSurface(
      <ShellLeaguesProvider leagueIds={[]}>
        <TeamPageView data={EMPTY_TEAM} />
      </ShellLeaguesProvider>,
      async ({ container }) => {
        expect(screen.getByRole("heading", { level: 1, name: "Tennessee Titans" })).toBeInTheDocument();
        expect(screen.getByText("TEN")).toBeInTheDocument();
        for (const title of SECTION_TITLES) expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
        expect(screen.getAllByText(NOT_HELD)).toHaveLength(SECTION_TITLES.length);
        expect(screen.queryAllByRole("table")).toHaveLength(0);
        expect(screen.queryByText("0-0")).toBeNull();
        expect(screen.queryByText("0")).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
