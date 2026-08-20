import { describe, expect, it } from "vitest";
import { initialDraftState, type CompletedPick, type DraftConfig, type DraftState } from "@/draft-engine";
import { auditEventsForPicks } from "./audit";

const CONFIG: DraftConfig = {
  draftId: "draft_1",
  leagueId: "league_1",
  format: "snake",
  kickoffAt: "2026-08-10T17:00:00.000Z",
  auctionBudget: null,
  slotConfig: [],
  clockSchedule: [],
};

function pickAt(pickNumber: number, over: Partial<CompletedPick> = {}): CompletedPick {
  return {
    pickNumber,
    round: 1,
    teamId: `team_${pickNumber}`,
    playerId: `player_${pickNumber}`,
    slot: "RB",
    slotIndex: 0,
    price: null,
    timestamp: "2026-08-20T17:03:00.000Z",
    auto: false,
    ...over,
  };
}

/** A draft state with `count` picks already made, and a pool that names each pick's player RB. */
function stateWithPicks(count: number): DraftState {
  return {
    ...initialDraftState(CONFIG),
    phase: "in_progress",
    pool: Array.from({ length: count }, (_, i) => ({ playerId: `player_${i + 1}`, position: "RB" as const })),
    picks: Array.from({ length: count }, (_, i) => pickAt(i + 1)),
  };
}

/** `count` picks, the last one made by the clock rather than a manager. */
function stateWithAutoPick(count: number): DraftState {
  const state = stateWithPicks(count);
  return { ...state, picks: [...state.picks.slice(0, -1), pickAt(count, { auto: true })] };
}

describe("auditEventsForPicks", () => {
  it("produces one event for the pick this action added", () => {
    const events = auditEventsForPicks(stateWithPicks(2), stateWithPicks(3), "user_alice");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "draft_pick",
      actorId: "user_alice",
      actorType: "user",
      leagueId: "league_1",
      occurredAt: "2026-08-20T17:03:00.000Z",
    });
    expect(events[0]!.payload).toEqual({
      draftId: "draft_1", teamId: "team_3", playerId: "player_3", position: "RB",
      round: 1, pickNumber: 3, slot: "RB", slotIndex: 0, price: null, auto: false,
    });
  });

  it("attributes a clock-made pick to the platform, with no actor", () => {
    // The manager who missed the clock did not do this; the platform did. `actorType: system`
    // makes the audit row structurally identical to a human's, attributed honestly, and it is
    // what Task 7's notice keys on to tell that manager what happened.
    const events = auditEventsForPicks(stateWithPicks(2), stateWithAutoPick(3), null);
    expect(events[0]).toMatchObject({ actorType: "system", actorId: null });
    expect(events[0]!.payload).toMatchObject({ auto: true });
  });

  it("produces nothing for an action that added no pick", () => {
    expect(auditEventsForPicks(stateWithPicks(2), stateWithPicks(2), "user_alice")).toEqual([]);
  });

  it("produces one event per pick when several land at once", () => {
    // An auction lot that closes and immediately auto-nominates the next can advance picks by
    // more than one; the audit trail is per pick, never per action.
    expect(auditEventsForPicks(stateWithPicks(2), stateWithPicks(4), "user_alice")).toHaveLength(2);
  });

  it("resolves a contested pick with no submitting actor from its winning team's owner", () => {
    // The only real-world shape this covers: `TIMER_EXPIRE` (no actor) closes an auction lot a
    // human actually won (`auto: false`). `ownerOf` is looked up by the caller and handed in —
    // this function stays pure, no I/O of its own.
    const ownerOf = new Map([["team_3", "user_bob"]]);
    const events = auditEventsForPicks(stateWithPicks(2), stateWithPicks(3), null, ownerOf);
    expect(events[0]).toMatchObject({ actorId: "user_bob", actorType: "user" });
  });

  it("still attributes an unopposed auto award to the platform even with an owner map available", () => {
    // `auto: true` short-circuits before `ownerOf` is ever consulted — the clock's own award,
    // never quietly re-attributed to whoever happens to own the team.
    const ownerOf = new Map([["team_3", "user_bob"]]);
    const events = auditEventsForPicks(stateWithPicks(2), stateWithAutoPick(3), null, ownerOf);
    expect(events[0]).toMatchObject({ actorType: "system", actorId: null });
  });
});
