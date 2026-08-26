import { describe, it, expect } from "vitest";
import { assignDraftSlots, draftOrderFor, drawSequenceFor } from "./order";

const TEAMS = Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);

describe("drawSequenceFor", () => {
  it("is deterministic for a given draft id", () => {
    expect(drawSequenceFor("draft_abc", TEAMS)).toEqual(drawSequenceFor("draft_abc", TEAMS));
  });

  it("is a permutation of the teams — every team drafts exactly once per round", () => {
    expect([...drawSequenceFor("draft_abc", TEAMS)].sort()).toEqual([...TEAMS].sort());
  });

  it("does not simply preserve input order", () => {
    expect(drawSequenceFor("draft_abc", TEAMS)).not.toEqual(TEAMS);
  });

  it("gives different drafts different orders", () => {
    // With 12 teams a collision has probability 1/12!, but if these two ids do collide,
    // pick a different pair — do not delete the test.
    expect(drawSequenceFor("draft_abc", TEAMS)).not.toEqual(drawSequenceFor("draft_xyz", TEAMS));
  });

  it("ignores the order the team ids arrive in", () => {
    expect(drawSequenceFor("draft_abc", [...TEAMS].reverse())).toEqual(drawSequenceFor("draft_abc", TEAMS));
  });
});

describe("draftOrderFor", () => {
  // The draw order is the existing seeded shuffle. Alice is drawn first and takes slot 1;
  // Bob wanted 1 too, is drawn second, and takes his next choice.
  const KDS_TEAMS = ["t_alice", "t_bob", "t_cara"];
  const PREFS = { t_alice: [1], t_bob: [1, 3], t_cara: [] };

  it("gives each drawn manager their highest still-free choice", () => {
    const order = draftOrderFor("d_1", KDS_TEAMS, PREFS);
    expect(order[0]).toBe("t_alice");
    expect(order[2]).toBe("t_bob");
  });

  it("is identical to today's shuffle when nobody ranked anything", () => {
    // The whole feature has to be additive: a league where nobody opens the panel drafts in
    // exactly the order it would have drafted in before this task existed. `drawSequenceFor`
    // is that untouched original shuffle — comparing against it, not against `draftOrderFor`
    // itself, is what makes this a real regression guard.
    expect(draftOrderFor("d_1", TEAMS, {})).toEqual(drawSequenceFor("d_1", TEAMS));
  });

  it("ranked-first mode grants EVERY chosen slot outright, whatever the draw did (the mock rule)", () => {
    // Under draw-order, an indifferent team drawn early consumes lowestFree and can block the
    // one seat anyone asked for; ranked-first resolves choosers before the indifferent, so a
    // practice host's pick is granted for ANY slot, not only the last (founder directive
    // 2026-08-26). Prove it across every slot of the 12-team fixture and many draft ids.
    for (const wanted of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      for (const draftId of ["d_a", "d_b", "d_c"]) {
        const order = draftOrderFor(draftId, TEAMS, { t03: [wanted] }, "ranked-first");
        expect(order[wanted - 1]).toBe("t03");
      }
    }
  });

  it("ranked-first mode changes nothing when nobody ranked anything", () => {
    expect(draftOrderFor("d_1", TEAMS, {}, "ranked-first")).toEqual(drawSequenceFor("d_1", TEAMS));
  });

  it("two ranked-first choosers wanting one slot still tie-break by the draw, and both land ranked slots", () => {
    const order = draftOrderFor("d_1", KDS_TEAMS, { t_alice: [1], t_bob: [1, 3] }, "ranked-first");
    expect(order[0]).toBe("t_alice");
    expect(order[2]).toBe("t_bob");
  });

  it("reproduces the same order forever from the same draft id and the same preferences", () => {
    expect(draftOrderFor("d_1", TEAMS, { t01: [3, 1] })).toEqual(draftOrderFor("d_1", TEAMS, { t01: [3, 1] }));
  });

  it("cannot be influenced by the order the preferences arrive in", () => {
    // Ids are sorted before the shuffle for this exact reason, and preferences are read into a
    // map keyed by team id, so a different insertion order is a different object and the same draw.
    const prefs = { t01: [3, 1], t05: [1, 2] };
    const reversedInsertion = { t05: [1, 2], t01: [3, 1] };
    expect(draftOrderFor("d_1", TEAMS, reversedInsertion)).toEqual(draftOrderFor("d_1", TEAMS, prefs));
  });

  it("fills a manager whose only choice is already gone into whatever is still free", () => {
    const teams = ["t_zoe", ...TEAMS];
    const order = draftOrderFor("d_1", teams, { t_zoe: [1] });
    expect([...order].sort()).toEqual([...teams].sort());
    expect(order.includes("t_zoe")).toBe(true);
  });

  it("is a permutation even with preferences applied", () => {
    expect([...draftOrderFor("d_1", TEAMS, { t01: [12, 1], t02: [1] })].sort()).toEqual([...TEAMS].sort());
  });
});

describe("assignDraftSlots", () => {
  it("resolves each manager's ranking by cascading to the next choice still free", () => {
    // The mock's own worked example, adapted to a draw the same size as the ranked slots:
    // a is drawn first and wants slot 3, which is free. b is drawn second and also wants 3
    // (gone), falling to 1. c is drawn third and wants 3 and 1 (both gone), falling to 2.
    const order = assignDraftSlots(["a", "b", "c"], { a: [3], b: [3, 1], c: [3, 1, 2] });
    expect(order[2]).toBe("a");
    expect(order[0]).toBe("b");
    expect(order[1]).toBe("c");
  });

  it("leaves every slot filled exactly once even when nobody ranked anything", () => {
    const draw = ["a", "b", "c", "d"];
    expect(assignDraftSlots(draw, {})).toEqual(draw);
  });

  it("lets an earlier-drawn no-preference team claim the low slot a later team's ranking wanted", () => {
    // a is drawn first with no preference, so it takes the lowest free slot (1) right then — it
    // never waits to see whether somebody drawn after it would have preferred that slot. b is
    // drawn second, wanted 1, and falls to the next lowest free slot: 2.
    const order = assignDraftSlots(["a", "b"], { b: [1] });
    expect(order[0]).toBe("a");
    expect(order[1]).toBe("b");
  });

  it("ignores a ranked slot number outside the league's own range rather than assigning it", () => {
    const order = assignDraftSlots(["a", "b"], { a: [99] });
    expect(order.includes("a")).toBe(true);
    expect(order.includes("b")).toBe(true);
    expect(order).toHaveLength(2);
  });
});
