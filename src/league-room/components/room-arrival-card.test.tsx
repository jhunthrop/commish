import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { LINEUP } from "../test-fixtures";
import { PlayerPeekHost } from "./player-peek";
import { RoomArrivalCard } from "./room-arrival-card";

/**
 * The arrival moment's own roster grid — a standalone player-name render found in the task 4
 * league-room audit, with no other control on the row (`Card interactive` is decorative-only
 * hover/focus styling, not a real click target — see `card.tsx`'s own `INTERACTIVE` constant).
 */
describe("RoomArrivalCard — player-name adoption (task 4)", () => {
  it("makes every drafted player's name a pressable button that opens the season peek, axe-clean", async () => {
    const { container } = render(
      <>
        <PlayerPeekHost />
        <RoomArrivalCard leagueId="l1" draftId="d1" lineup={LINEUP} matchup={null} projectedLine={null} />
      </>,
    );
    const name = screen.getByRole("button", { name: "Josh Allen" });
    expect(await axe(container)).toHaveNoViolations();
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Josh Allen" })).toBeInTheDocument();
  });
});
