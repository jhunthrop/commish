import { describe, it, expect } from "vitest";
import { players, rosterSlots } from "@/db/schema";
import { excludedSetFor } from "./upsert";

/** Reads the raw SQL text out of a `sql.raw(...)` fragment, for assertion purposes only. */
function rawTextOf(fragment: unknown): string {
  const chunks = (fragment as { queryChunks: { value: readonly string[] }[] }).queryChunks;
  return chunks[0]!.value[0]!;
}

describe("excludedSetFor", () => {
  it("maps every non-key column to its excluded.<column> reference", () => {
    const set = excludedSetFor(players, ["id"]);
    expect(Object.keys(set).sort()).toEqual(["name", "nflTeam", "position"].sort());
    expect(rawTextOf(set.name)).toBe("excluded.name");
    expect(rawTextOf(set.nflTeam)).toBe("excluded.nfl_team");
    expect(rawTextOf(set.position)).toBe("excluded.position");
  });

  it("excludes every key column, even when there is more than one", () => {
    const set = excludedSetFor(rosterSlots, ["teamId", "slot", "slotIndex"]);
    expect(Object.keys(set)).toEqual(["playerId"]);
    expect(rawTextOf(set.playerId)).toBe("excluded.player_id");
  });

  it("never produces a no-op self-assignment for the value it replaced", () => {
    // The defect this module fixes: `{ set: { playerId: rosterSlots.playerId } }` assigns a
    // column to itself. Every value here must instead be an `excluded.*` SQL reference.
    const set = excludedSetFor(rosterSlots, ["teamId", "slot", "slotIndex"]);
    expect(rawTextOf(set.playerId)).not.toBe("player_id");
  });
});
