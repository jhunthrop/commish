import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { SEARCH_CONFIG } from "@/search/config";
import type { SearchResult } from "@/search/contract";
import { resultMetaLine, SiteSearch } from "./site-search";
import { ShellLeaguesProvider } from "./shell-leagues";

const push = vi.fn();
let pathname = "/app/wallet";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const GIBBS: SearchResult = {
  kind: "player",
  player: { id: "rb1", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", headshotUrl: null, adp: 4.1 },
  positionRank: 2,
  boardRank: 3,
  byeWeek: 8,
};
const LIONS: SearchResult = { kind: "team", code: "DET", name: "Detroit Lions", byeWeek: 8 };
const BATES: SearchResult = {
  kind: "player",
  player: { id: "k1", name: "Jake Bates", position: "K", nflTeam: "DET", headshotUrl: null, adp: 140.5 },
  positionRank: 1,
  boardRank: null,
  byeWeek: null,
};

function renderSearch(results: readonly SearchResult[], leagueIds: readonly string[] = ["lg_first"]) {
  const fixture = fixtureAccountDeps({ ok: true, data: { query: "x", results } });
  const view = render(
    <AccountRoomDepsProvider deps={fixture.deps}>
      <ShellLeaguesProvider leagueIds={leagueIds}>
        <input aria-label="Some other field" />
        <SiteSearch />
      </ShellLeaguesProvider>
    </AccountRoomDepsProvider>,
  );
  return { ...view, fixture };
}

const trigger = () => screen.getByRole("button", { name: SEARCH_CONFIG.copy.placeholder });
const field = () => screen.getByRole("combobox", { name: SEARCH_CONFIG.copy.placeholder });

beforeEach(() => {
  push.mockReset();
  pathname = "/app/wallet";
});

describe("resultMetaLine", () => {
  it("states club, bye and board rank, dropping each one the result lacks", () => {
    expect(resultMetaLine(GIBBS)).toBe("DET · Bye 8 · Board 3");
    expect(resultMetaLine(BATES)).toBe("DET");
    expect(resultMetaLine(LIONS)).toBe("DET · Bye 8");
  });
});

describe("SiteSearch", () => {
  it("renders one trigger carrying the placeholder as its name, and no dialog until opened", () => {
    renderSearch([]);
    expect(trigger()).toBeInTheDocument();
    expect(screen.getByText(SEARCH_CONFIG.copy.placeholder)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on click as a combobox over a listbox, focused, axe-clean in both themes", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { query: "x", results: [] } });
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <SiteSearch />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        fireEvent.click(trigger());
        const input = field();
        expect(input).toHaveFocus();
        expect(input).toHaveAttribute("aria-autocomplete", "list");
        expect(input).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByRole("listbox", { name: "Results" })).toBeInTheDocument();
        expect(input).toHaveAttribute("placeholder", SEARCH_CONFIG.copy.placeholder);
        expect(await axe(container)).toHaveNoViolations();
        fireEvent.keyDown(input, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
      },
    );
  });

  it("opens on / when nothing editable is focused, not from inside another field, and on Cmd or Ctrl plus K", () => {
    renderSearch([]);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Some other field" }), { key: "/" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(screen.getByRole("dialog", { name: SEARCH_CONFIG.copy.dialogTitle })).toBeInTheDocument();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(field(), { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lists answers as options in the pool row treatment, steers them with arrows, and opens the highlighted one on Enter", async () => {
    const { fixture } = renderSearch([GIBBS, LIONS, BATES]);
    fireEvent.click(trigger());
    fireEvent.change(field(), { target: { value: "det" } });
    const options = await screen.findAllByRole("option");
    expect(fixture.calls).toEqual(["GET /api/search?q=det"]);
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(field()).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(field()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Jahmyr Gibbs")).toBeInTheDocument();
    expect(screen.getByText("RB2")).toBeInTheDocument();
    expect(screen.getByText("DET · Bye 8 · Board 3")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(field()).toHaveAttribute("aria-activedescendant", options[1]!.id);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/app/teams/DET");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends a player to his page in the league the reader is standing in", async () => {
    pathname = "/app/leagues/lg_here/standings";
    renderSearch([GIBBS]);
    fireEvent.click(trigger());
    fireEvent.change(field(), { target: { value: "gib" } });
    await screen.findByRole("option");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/app/leagues/lg_here/players/rb1");
  });

  it("sends a player to his club's page for a reader with no league at all", async () => {
    renderSearch([GIBBS], []);
    fireEvent.click(trigger());
    fireEvent.change(field(), { target: { value: "gib" } });
    fireEvent.click(await screen.findByRole("option"));
    expect(push).toHaveBeenCalledWith("/app/teams/DET");
  });

  it("wraps the highlight with the arrows and does nothing on Enter with no answer", async () => {
    renderSearch([GIBBS, LIONS]);
    fireEvent.click(trigger());
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: "det" } });
    const options = await screen.findAllByRole("option");
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("says, in those words, that nothing matches, only once the wire has answered", async () => {
    renderSearch([]);
    fireEvent.click(trigger());
    expect(screen.queryByText(SEARCH_CONFIG.copy.noMatch)).toBeNull();
    fireEvent.change(field(), { target: { value: "zzq" } });
    expect(await screen.findByRole("status")).toHaveTextContent("No player or team matches that.");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("clears the query when closed so the next opening starts clean", async () => {
    renderSearch([GIBBS]);
    fireEvent.click(trigger());
    fireEvent.change(field(), { target: { value: "gib" } });
    await screen.findByRole("option");
    fireEvent.keyDown(field(), { key: "Escape" });
    fireEvent.click(trigger());
    expect(field()).toHaveValue("");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
