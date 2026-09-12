import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Player } from "@/domain/player";
import { DRAFT_ROOM_CONFIG } from "../../state/config";
import { PoolList } from "./pool-list";

/** Two hundred running backs, so the page cut is real and rank 150 sits well past it. */
const PLAYERS: readonly Player[] = Array.from({ length: 200 }, (_, index) => ({
  id: `rb${index + 1}`,
  name: index === 149 ? "Deep Cut" : `Back ${index + 1}`,
  position: index % 7 === 0 ? "WR" : "RB",
  nflTeam: "KC",
  headshotUrl: null,
  adp: index + 1,
}));

const available = new Set(PLAYERS.map((player) => player.id));

function renderPool({ canDraft = false, recomputing = false, coarse = false, onDraft = vi.fn() }: { canDraft?: boolean; recomputing?: boolean; coarse?: boolean; onDraft?: (playerId: string) => void } = {}) {
  return render(
    // The room's root carries the pointer kind; the rows read it through `group-data`.
    <div className="group/room" data-pointer={coarse ? "coarse" : "fine"}>
      <PoolList
        leagueId="l1"
        players={PLAYERS}
        available={available}
        byeWeeks={new Map([["KC", 10]])}
        odds={{ pickNumber: 20, runs: 100, survived: { rb1: 12 } }}
        nextPickLabel="2.07"
        recomputing={recomputing}
        canDraft={canDraft}
        submitting={false}
        queuedPlayerIds={new Set(["rb2"])}
        onDraft={onDraft}
        onQueueToggle={vi.fn()}
        onPeek={vi.fn()}
      />
    </div>,
  );
}

/** The rows on stage: a row a filter just removed is a leaving ghost for the leave duration. */
const rows = () => within(screen.getByRole("list", { name: "Available players, best first" })).getAllByTestId("pool-row").filter((row) => row.getAttribute("aria-hidden") !== "true");

describe("PoolList (the pool is the dock)", () => {
  it("shows one page, best first, each row a face, a name, the club and bye, one whole percentage with the pick beneath it, and one quiet control", () => {
    renderPool();
    const listed = rows();
    expect(listed).toHaveLength(DRAFT_ROOM_CONFIG.poolPageSize);
    expect(screen.queryByTestId("pool-basis")).toBeNull();
    const first = listed[0]!;
    expect(within(first).getByTestId("pool-player-name")).toHaveTextContent("Back 1");
    expect(within(first).getByTestId("pool-player-team")).toHaveTextContent("KC");
    expect(first).toHaveTextContent("bye 10");
    expect(within(first).getByTestId("big-number")).toHaveTextContent("12%");
    expect(within(first).getByTestId("big-number")).toHaveTextContent("still there at 2.07");
    expect(within(first).getByTestId("big-number")).not.toHaveTextContent("100");
    expect(within(first).getByRole("button", { name: "Queue Back 1" })).toBeInTheDocument();
    expect(within(listed[1]!).getByRole("button", { name: "Remove Back 2 from your queue" })).toHaveAttribute("aria-pressed", "true");
    // A player the runs did not reach prints a dash with the reason, never a zero.
    expect(within(listed[2]!).getByTestId("big-number")).toHaveTextContent("–");
    expect(within(listed[2]!).getByTestId("big-number")).toHaveTextContent("no runs yet");
  });

  it("searches the whole board before the page is cut, so a deep player is one search away", () => {
    renderPool();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search players" }), { target: { value: "deep" } });
    const listed = rows();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toHaveTextContent("Deep Cut");
  });

  it("the position stickers narrow the list and the empty state clears both controls", () => {
    renderPool();
    fireEvent.click(screen.getByRole("button", { name: "Show WR only" }));
    for (const row of rows()) expect(row).toHaveTextContent("WR");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search players" }), { target: { value: "nobody" } });
    expect(screen.getByText("No players match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rows()).toHaveLength(DRAFT_ROOM_CONFIG.poolPageSize);
  });

  it("on your clock a row's Draft is the outlined pill and reveals on hover, focus, or a coarse pointer: the viewport rests with the dock's one solid", () => {
    renderPool({ canDraft: true });
    const draft = within(rows()[0]!).getByRole("button", { name: "Draft Back 1" });
    expect(draft.className).not.toContain("bg-accent");
    expect(draft.className).toContain("border-edge");
    const reveal = within(rows()[0]!).getByTestId("pool-draft-reveal");
    expect(reveal).toContainElement(draft);
    expect(reveal.className).toContain("hidden");
    expect(reveal.className).toContain("group-hover/row:inline-flex");
    expect(reveal.className).toContain("group-focus-within/row:inline-flex");
    expect(reveal.className).toContain("group-data-[pointer=coarse]/room:inline-flex");
    expect(reveal.closest("[data-pointer]")).toHaveAttribute("data-pointer", "fine");
  });

  it("on a coarse pointer the room root says so, which is what shows the verb at rest", () => {
    renderPool({ canDraft: true, coarse: true });
    expect(within(rows()[0]!).getByTestId("pool-draft-reveal").closest("[data-pointer]")).toHaveAttribute("data-pointer", "coarse");
  });

  it("the Tab path reaches a row's revealed Draft and Enter drafts him", async () => {
    const onDraft = vi.fn();
    const user = userEvent.setup();
    renderPool({ canDraft: true, onDraft });
    within(rows()[0]!).getByRole("button", { name: "Back 1's draft card" }).focus();
    await user.tab();
    expect(within(rows()[0]!).getByRole("button", { name: "Draft Back 1" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onDraft).toHaveBeenCalledWith("rb1");
  });

  it("says updating once and dims every figure while the odds are being recomputed, without touching the rows", () => {
    renderPool({ recomputing: true });
    expect(screen.getByTestId("pool-recomputing")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("pool-list")).toHaveAttribute("data-recomputing", "true");
    expect(within(rows()[0]!).getByTestId("big-number").className).toContain("group-data-[recomputing=true]/pool:opacity-60");
  });
});
