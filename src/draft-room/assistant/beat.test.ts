import { describe, expect, it } from "vitest";
import type { AssistantCallView } from "@/draft-service/assistant/call";
import { postPickBeat } from "./beat";

const CALL_BASE = { pickNumber: 4, onTheClock: true, yourBuild: [], winningBuilds: null, computedBasis: "gen1" } as const;

function names(id: string): string {
  const registry: Record<string, string> = { rb1: "Marcus Reed", wr1: "Andre Salas", te1: "Cole Whitmore" };
  return registry[id] ?? id;
}

function call(over: Partial<AssistantCallView> = {}): AssistantCallView {
  return { ...CALL_BASE, candidates: [], ...over };
}

describe("postPickBeat", () => {
  it("says 'Best available.' when the picked player was the board's own top candidate", () => {
    const prePickCall = call({
      candidates: [
        { playerId: "rb1", position: "RB", reasons: [], makeItBack: null },
        { playerId: "wr1", position: "WR", reasons: [], makeItBack: null },
      ],
    });
    expect(postPickBeat({ pickedPlayerId: "rb1", prePickCall, playerName: names })).toBe("Best available.");
  });

  it("names the passed-on top candidate and reports his make-it-back odds when they exist", () => {
    const prePickCall = call({
      candidates: [
        { playerId: "rb1", position: "RB", reasons: [], makeItBack: { playerId: "rb1", survival: 0.75, runs: 200 } },
        { playerId: "wr1", position: "WR", reasons: [], makeItBack: null },
      ],
    });
    expect(postPickBeat({ pickedPlayerId: "wr1", prePickCall, playerName: names })).toBe(
      "Our board had Marcus Reed first. Our sims make it about 3 in 4 he is still there at your next turn.",
    );
  });

  it("stops after the first sentence when the passed-on top candidate carries no odds", () => {
    const prePickCall = call({
      candidates: [
        { playerId: "rb1", position: "RB", reasons: [], makeItBack: null },
        { playerId: "wr1", position: "WR", reasons: [], makeItBack: null },
      ],
    });
    expect(postPickBeat({ pickedPlayerId: "wr1", prePickCall, playerName: names })).toBe("Our board had Marcus Reed first.");
  });

  it("has no top candidate to reference when the call carries an empty shortlist", () => {
    const prePickCall = call({ candidates: [] });
    expect(postPickBeat({ pickedPlayerId: "rb1", prePickCall, playerName: names })).toBeNull();
  });

  it("no em-dashes or semicolons in any branch's copy", () => {
    const withOdds = call({
      candidates: [{ playerId: "rb1", position: "RB", reasons: [], makeItBack: { playerId: "rb1", survival: 0.5, runs: 200 } }],
    });
    const withoutOdds = call({ candidates: [{ playerId: "rb1", position: "RB", reasons: [], makeItBack: null }] });
    const bestAvailable = call({ candidates: [{ playerId: "rb1", position: "RB", reasons: [], makeItBack: null }] });
    const outputs = [
      postPickBeat({ pickedPlayerId: "rb1", prePickCall: bestAvailable, playerName: names }),
      postPickBeat({ pickedPlayerId: "wr1", prePickCall: withOdds, playerName: names }),
      postPickBeat({ pickedPlayerId: "wr1", prePickCall: withoutOdds, playerName: names }),
    ];
    for (const output of outputs) {
      expect(output).not.toBeNull();
      expect(output).not.toMatch(/—|–/);
      expect(output).not.toContain(";");
    }
  });
});
