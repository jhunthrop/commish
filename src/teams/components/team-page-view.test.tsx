import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { ShellLeaguesProvider } from "@/components/app-shell/shell-leagues";
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
        expect(screen.getByText("Board 3 · Tier 1 · ADP 4.1 · 312.4 pts")).toBeInTheDocument();
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

  it("renders the rows without links for a reader with no league, never a link that dies", () => {
    renderView(FULL_TEAM, []);
    expect(screen.queryByRole("link", { name: "Jahmyr Gibbs" })).toBeNull();
    expect(within(screen.getByRole("list", { name: "Fantasy players" })).getByText("Jahmyr Gibbs")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Defense analysis page" })).toBeNull();
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
