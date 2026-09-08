import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoomSignals } from "@/draft-service/assistant/view";
import { ADVISOR_ROOM_CONFIG } from "../config";
import { orderChips, SignalsStrip } from "./signals-strip";

const SIGNALS: RoomSignals = {
  run: { position: "WR", count: 3, window: 4 },
  collapses: [
    { position: "QB", tierLabel: "A", playersLeftInTier: 1, dropToNextTier: 36.2 },
    { position: "TE", tierLabel: "A", playersLeftInTier: 1, dropToNextTier: 25.9 },
    { position: "WR", tierLabel: "A", playersLeftInTier: 1, dropToNextTier: 30.1 },
    { position: "RB", tierLabel: "A", playersLeftInTier: 1, dropToNextTier: 20.6 },
  ],
  ahead: [],
};

function renderStrip(signals: RoomSignals = SIGNALS) {
  return render(<SignalsStrip signals={signals} teamCount={10} strategy="Backs are going." strategyVoice="template" neededPositions={["RB", "WR"]} nameOf={(id) => id} seatLabel={(seat) => `Seat ${seat.seat}`} notes={[]} />);
}

describe("orderChips", () => {
  it("puts the run first, then the collapses at the seat's own needed positions in plan order, then the rest", () => {
    expect(orderChips(SIGNALS, ["RB", "WR"]).map((chip) => chip.key)).toEqual(["run", "collapse:RB", "collapse:WR", "collapse:QB", "collapse:TE"]);
    expect(orderChips({ ...SIGNALS, run: null }, []).map((chip) => chip.key)).toEqual(["collapse:QB", "collapse:TE", "collapse:WR", "collapse:RB"]);
  });
});

describe("SignalsStrip on a phone", () => {
  it("marks every chip beyond the first three as beyond the fold and offers More with the hidden count, then Less", async () => {
    const user = userEvent.setup();
    renderStrip();
    const beyond = screen.getAllByTestId("advisor-collapse").filter((chip) => chip.dataset.beyondFold === "true");
    expect(beyond).toHaveLength(SIGNALS.collapses.length + 1 - ADVISOR_ROOM_CONFIG.mobileChipCount);
    for (const chip of beyond) expect(chip.className).toContain("hidden");
    const more = screen.getByRole("button", { name: `More (${beyond.length})` });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    for (const chip of beyond) expect(chip.className).not.toContain("hidden");
    expect(screen.getByRole("button", { name: "Less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("offers no disclosure when the chips fit", () => {
    renderStrip({ ...SIGNALS, collapses: SIGNALS.collapses.slice(0, 2) });
    expect(screen.queryByRole("button", { name: /More/ })).toBeNull();
  });
});
