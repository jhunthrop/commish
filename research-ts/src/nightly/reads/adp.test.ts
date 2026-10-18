import { describe, expect, it } from "vitest";
import { placeCapture } from "./adp";

// One rule for a capture whose rows reach one player id (Lane 66o re-review M2): the lower ADP wins, as
// the api's room read (`min(adp)`, api/internal/boards/market.go) and the Python nightly
// (`place_capture`, research/nightly/reads/adp.py) keep it, so the three readers agree.
describe("placeCapture", () => {
  it("keeps the lower ADP when two capture rows reach one player", () => {
    const placed = placeCapture([
      { playerId: "rb", adp: 7.7 },
      { playerId: "wr", adp: 5 },
      { playerId: "rb", adp: 4.2 },
    ]);
    expect(Object.fromEntries(placed)).toEqual({ rb: 4.2, wr: 5 });
  });

  it("does not depend on the order the rows arrive in", () => {
    const rows = [
      { playerId: "rb", adp: 4.2 },
      { playerId: "rb", adp: 7.7 },
    ];
    expect(placeCapture(rows).get("rb")).toBe(4.2);
    expect(placeCapture([...rows].reverse()).get("rb")).toBe(4.2);
  });
});
