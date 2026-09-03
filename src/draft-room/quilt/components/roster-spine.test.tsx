import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PLAYERS, SNAKE_VIEW } from "../../test-fixtures";
import { RosterSpine } from "./roster-spine";

const playersById = new Map(PLAYERS.map((player) => [player.id, player]));

function renderSpine(expanded: boolean) {
  const onToggle = vi.fn();
  render(
    <RosterSpine
      view={{ ...SNAKE_VIEW, rosters: { t1: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }], t2: [] } }}
      myTeamId="t1"
      playersById={playersById}
      expanded={expanded}
      onToggle={onToggle}
    />,
  );
  return onToggle;
}

describe("RosterSpine", () => {
  it("collapsed, the head is an explicit ROSTER chevron button — the rotated micro-text is retired", () => {
    const onToggle = renderSpine(false);
    const head = screen.getByTestId("roster-toggle");
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(head).toHaveAccessibleName("Your roster, 1 of 3 slots filled. Expand");
    expect(screen.getByText("roster", { exact: false })).toBeInTheDocument();
    // The chevron points into the stage while closed — no flip class yet.
    expect(screen.getByTestId("roster-chevron").className).not.toContain("rotate-180");
    fireEvent.click(head);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("open, the same button collapses the panel and the chevron flips", () => {
    const onToggle = renderSpine(true);
    const head = screen.getByTestId("roster-toggle");
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("roster-chevron").className).toContain("rotate-180");
    // The expanded panel names every slot.
    expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
    fireEvent.click(head);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("the slot dots still ride the collapsed rail beneath the button", () => {
    renderSpine(false);
    expect(screen.getByTestId("roster-spine")).toBeInTheDocument();
    // One filled QB dot (sticker color) and two open RB dashes render as furniture.
    expect(screen.getByTestId("roster-spine").querySelectorAll("[aria-hidden]").length).toBeGreaterThanOrEqual(3);
  });
});
