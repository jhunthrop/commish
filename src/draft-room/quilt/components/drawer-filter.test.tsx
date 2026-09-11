import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Player } from "@/domain/player";
import { DRAFT_ROOM_CONFIG } from "../../state/config";
import { seedSheet } from "../state/sheet";
import { DrawerByesTab } from "./drawer-byes-tab";
import { DrawerSheetTab } from "./drawer-sheet-tab";

/** Three pages of players, best first; the one named "Deep Cut" sits at rank 150, on KC. */
const DEEP_INDEX = 149;
const POOL: readonly Player[] = Array.from({ length: DRAFT_ROOM_CONFIG.poolPageSize * 3 }, (_, index): Player => ({
  id: `p${index + 1}`,
  name: index === DEEP_INDEX ? "Deep Cut" : `Player ${index + 1}`,
  position: index % 2 === 0 ? "RB" : "WR",
  nflTeam: index === DEEP_INDEX || index % 3 === 0 ? "KC" : "SF",
  headshotUrl: null,
  adp: null,
}));
const BY_ID = new Map(POOL.map((player) => [player.id, player]));
const EVERYONE = new Set(POOL.map((player) => player.id));

function mountSheet() {
  render(
    <DrawerSheetTab
      leagueId="l1"
      sheet={seedSheet(POOL.map((player) => player.id))}
      playersById={BY_ID}
      boardRanks={new Map(POOL.map((player, index) => [player.id, index + 1]))}
      available={EVERYONE}
      onMove={vi.fn()}
      onSeedQueue={vi.fn()}
      onReset={vi.fn()}
      canDraft={false}
      submitting={false}
      onDraft={vi.fn()}
      onPeek={vi.fn()}
      hasServerSheet
      onStartServerSheet={vi.fn()}
    />,
  );
}

function mountByes() {
  render(<DrawerByesTab leagueId="l1" players={POOL} available={EVERYONE} byeWeeks={new Map([["KC", 10]])} canDraft={false} submitting={false} onDraft={vi.fn()} onPeek={vi.fn()} />);
}

const sheetList = () => screen.getByRole("list", { name: "Your sheet, your order" });
/** Rows still present once the leaving ghosts (`MotionList`'s 120 ms fade) have gone. */
const settledRows = (scope: HTMLElement) => within(scope).getAllByTestId("drawer-row").filter((row) => row.getAttribute("aria-hidden") !== "true");

describe("the sheet and byes tabs filter the whole list before the page is cut (review fix round, MEDIUM)", () => {
  it("a player deep on the sheet is on the first page once searched for, keeping his sheet number", async () => {
    mountSheet();
    expect(within(sheetList()).queryByText("Deep Cut")).toBeNull();
    expect(settledRows(sheetList())).toHaveLength(DRAFT_ROOM_CONFIG.poolPageSize);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search players" }), { target: { value: "deep" } });
    await waitFor(() => expect(settledRows(sheetList())).toHaveLength(1));
    const row = settledRows(sheetList())[0]!;
    expect(row).toHaveTextContent("Deep Cut");
    expect(row).toHaveTextContent(String(DEEP_INDEX + 1));
  });

  it("the position stickers narrow the sheet and the empty state clears both controls", async () => {
    mountSheet();
    fireEvent.click(screen.getByRole("button", { name: "Show WR only" }));
    await waitFor(() => expect(settledRows(sheetList()).every((row) => row.textContent?.includes("WR"))).toBe(true));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search players" }), { target: { value: "nobody" } });
    fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox", { name: "Search players" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Show WR only" })).toHaveAttribute("aria-pressed", "false");
  });

  it("the byes tab searches everyone still available and lands the match in his band on page one", async () => {
    mountByes();
    expect(screen.queryByText("Deep Cut")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search players" }), { target: { value: "Deep" } });
    const band = screen.getByRole("region", { name: "Bye week 10" });
    await waitFor(() => expect(settledRows(band)).toHaveLength(1));
    expect(within(band).getByText("Deep Cut")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("region", { name: "No bye on record" })).toBeNull());
  });
});
