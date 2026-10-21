import { describe, expect, it } from "vitest";
import { clubChanges, listedClubs } from "./player-clubs";

const listed = (playerID: unknown, team: unknown, isFreeAgent = "False") => ({ playerID, team, isFreeAgent });

describe("listedClubs", () => {
  it("names a club for a listed player on one of the 32, and none for a free agent", () => {
    const clubs = listedClubs([
      listed("1", "BUF"),
      listed("2", "MIA", "True"),
      listed("3", "FA"),
      listed(" 4 ", "WSH"),
      listed("", "KC"),
      listed(5, "KC"),
      listed("6", null),
      "not a player",
    ]);
    expect([...clubs]).toEqual([
      ["1", "BUF"],
      ["2", null],
      ["4", "WSH"],
    ]);
  });

  it("reads nothing from a body that is not a list", () => {
    expect(listedClubs({ body: [listed("1", "BUF")] }).size).toBe(0);
  });
});

describe("clubChanges", () => {
  it("names each stored player the list moves, in id order, and no one else", () => {
    const stored = [
      { id: "4433970", team: "MIN" },
      { id: "4037235", team: "DET" },
      { id: "3918298", team: "BUF" },
      { id: "4872957", team: "IND" },
      { id: "4362238", team: null },
      { id: "parity-off-list", team: "KC" },
    ];
    const list = new Map<string, string | null>([
      ["4037235", "BUF"],
      ["4433970", "NYG"],
      ["3918298", "BUF"],
      ["4872957", null],
      ["4362238", null],
      ["9999999", "LAC"],
    ]);
    // The free agent's club is cleared; one already cleared, and the player off the list, are not changes.
    expect(clubChanges(stored, list)).toEqual([
      { playerId: "4037235", before: "DET", after: "BUF" },
      { playerId: "4433970", before: "MIN", after: "NYG" },
      { playerId: "4872957", before: "IND", after: null },
    ]);
  });
});
