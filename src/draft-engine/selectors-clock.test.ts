import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@research-ts/domain/draft";
import type { RosterSlotConfig } from "@research-ts/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_SKIP_POLICY, type PauseWindow } from "./config";
import { reduceDraft } from "./reduce";
import { currentClockSeconds, currentDeadline, currentTier, draftClockView, draftStateView, nextTightening, nudgeDeadline } from "./selectors";

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];
const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
];
const KICKOFF = "2026-09-10T17:00:00.000Z";
const CONFIG: DraftConfig = {
  draftId: "d1", leagueId: "l1", format: "snake", kickoffAt: KICKOFF,
  auctionBudget: null, slotConfig: SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

function startedAt(timestamp: string, config: DraftConfig = CONFIG): DraftState {
  const start: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, timestamp, draftOrder: ["t1", "t2"], pool: POOL };
  const result = reduceDraft(initialDraftState(config), start);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe("the auto-tightening clock, seen through the state", () => {
  it("gives four different pick durations for the same draft at four distances from kickoff", () => {
    const durations = [
      "2026-09-02T09:00:00.000Z",
      "2026-09-06T13:00:00.000Z",
      "2026-09-10T04:00:00.000Z",
      "2026-09-10T14:30:00.000Z",
    ].map((at) => currentClockSeconds(startedAt(at)));
    expect(durations).toEqual([8 * 3600, 4 * 3600, 3600, 600]);
    expect(new Set(durations).size).toBe(4);
  });

  it("derives the deadline from when the turn started plus the tier's pick seconds", () => {
    const state = startedAt("2026-09-10T14:30:00.000Z"); // 10-minute tier
    expect(currentDeadline(state)).toBe("2026-09-10T14:40:00.000Z");
    expect(currentTier(state)?.pickSeconds).toBe(600);
  });

  it("reports when the clock next shortens and to what", () => {
    expect(nextTightening(startedAt("2026-09-10T04:00:00.000Z"))).toEqual({ at: "2026-09-10T05:00:00.000Z", pickSeconds: 600 });
  });

  it("has no clock before the draft starts or after it finishes", () => {
    const scheduled = initialDraftState(CONFIG);
    expect(currentDeadline(scheduled)).toBeNull();
    expect(currentClockSeconds(scheduled)).toBeNull();
    expect(currentTier(scheduled)).toBeNull();
    expect(nextTightening(scheduled)).toBeNull();
  });

  it("shortens the window to the auction bid window while a lot is live", () => {
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: 10 };
    let state = startedAt("2026-09-02T09:00:00.000Z", auctionConfig); // 8-hour tier
    expect(currentClockSeconds(state)).toBe(8 * 3600);
    const nominated = reduceDraft(state, { v: 1, type: "NOMINATE", timestamp: "2026-09-02T09:05:00.000Z", teamId: "t1", playerId: "qb1", openingBid: 1 });
    if (!nominated.ok) throw new Error(nominated.reason);
    state = nominated.state;
    // Live bidding uses the shorter of the tier and the configured bid window.
    expect(currentClockSeconds(state)).toBe(15);
    expect(currentDeadline(state)).toBe("2026-09-02T09:05:15.000Z");
  });
});

describe("draftStateView", () => {
  it("serializes everything a client needs in one shape", () => {
    const state = startedAt("2026-09-10T14:30:00.000Z");
    const view = draftStateView(state);
    expect(view).toMatchObject({
      draftId: "d1",
      leagueId: "l1",
      format: "snake",
      phase: "in_progress",
      sequence: 1,
      draftOrder: ["t1", "t2"],
      pickNumber: 1,
      onClockTeamId: "t1",
      deadlineAt: "2026-09-10T14:40:00.000Z",
      clockSeconds: 600,
      nextTightening: { at: "2026-09-10T15:00:00.000Z", pickSeconds: 90 },
      picks: [],
      budgets: {},
      auction: null,
    });
    expect(view.availablePlayerIds).toEqual(["qb1", "rb1", "qb2", "rb2"]);
    expect(view.rosters).toEqual({ t1: [], t2: [] });
  });
});

describe("the overnight pause, seen through the state", () => {
  const ET: PauseWindow = { zone: "America/New_York", startHour: 2, endHour: 5, appliesAtOrAbovePickSeconds: 60 * 60 };
  const MS_PER_MINUTE = 60_000;
  const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

  function minutes(n: number): number {
    return n * MS_PER_MINUTE;
  }
  function days(n: number): number {
    return n * MS_PER_DAY;
  }
  function plusSeconds(iso: string, seconds: number): string {
    return new Date(Date.parse(iso) + seconds * 1_000).toISOString();
  }
  function days3After(iso: string): string {
    return new Date(Date.parse(iso) + days(3)).toISOString();
  }

  /** A snake draft, freshly started at `turnStartedAt`, whose kickoff sits `kickoffIn`
   *  milliseconds later — the two team draft order the pause tests need, on the pause-window
   *  config the rest of this file's `CONFIG` never carries. */
  function draftAt({ kickoffIn, turnStartedAt }: { readonly kickoffIn: number; readonly turnStartedAt: string }): DraftState {
    const config: DraftConfig = { ...CONFIG, kickoffAt: new Date(Date.parse(turnStartedAt) + kickoffIn).toISOString(), pauseWindow: ET };
    const start: StartDraftAction = {
      v: 1,
      type: "START_DRAFT",
      minBid: 1,
      skipPolicy: DRAFT_SKIP_POLICY,
      timestamp: turnStartedAt,
      draftOrder: ["t_alice", "t_bob"],
      pool: POOL,
    };
    const result = reduceDraft(initialDraftState(config), start);
    if (!result.ok) throw new Error(result.reason);
    return result.state;
  }

  function makePick(teamId: string, playerId: string) {
    return { v: 1 as const, type: "MAKE_PICK" as const, timestamp: "2026-09-15T06:31:00.000Z", teamId, playerId };
  }

  it("does not pause the 90-second clock, because that room is awake", () => {
    // `appliesAtOrAbovePickSeconds` is one hour. At the 10-minute and 90-second tiers the draft
    // is within two hours of kickoff and everybody in it is at their keyboard; freezing them at
    // 2 AM would strand eleven managers to protect the one who is asleep.
    const state = draftAt({ kickoffIn: minutes(30), turnStartedAt: "2026-09-15T06:00:00.000Z" });
    expect(currentDeadline(state)).toBe(plusSeconds(state.turnStartedAt!, 90));
    expect(draftClockView(state).pausedUntil).toBeNull();
  });

  it("tells the room when picks come back, without stopping anybody picking now", () => {
    const state = draftAt({ kickoffIn: days(5), turnStartedAt: "2026-09-15T06:30:00.000Z" });
    expect(draftClockView(state).pausedUntil).toBe("2026-09-15T09:00:00.000Z");
    expect(reduceDraft(state, makePick("t_alice", "qb1")).ok).toBe(true);
  });

  it("pushes the moderator's nudge threshold past the freeze too, not just the deadline", () => {
    // Same 4h-tier turn, started at 2:30 AM ET. A naive 12.5% threshold (30 minutes) would land
    // at 3:00 AM ET — squarely inside the freeze — which is exactly what would have the
    // moderator speaking up in the middle of the night if `nudgeDeadline` did not route through
    // the same `deadlineAfter` fixpoint `currentDeadline` uses.
    const state = draftAt({ kickoffIn: days(5), turnStartedAt: "2026-09-15T06:30:00.000Z" });
    expect(nudgeDeadline(state, 12.5)).toBe("2026-09-15T09:30:00.000Z");
  });

  it("never extends a deadline when no pause window is configured at all", () => {
    // The optional field's other value: omitted entirely, exactly like every `DraftConfig`
    // this suite's OTHER describe blocks build. Behavior must be identical to before this task.
    const start: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, timestamp: "2026-09-15T03:30:00.000Z", draftOrder: ["t1", "t2"], pool: POOL };
    // 11:30 PM ET, more than 48h from kickoff, so the 4h tier would otherwise straddle the freeze.
    const config: DraftConfig = { ...CONFIG, kickoffAt: days3After("2026-09-15T03:30:00.000Z") };
    const result = reduceDraft(initialDraftState(config), start);
    if (!result.ok) throw new Error(result.reason);
    expect(currentDeadline(result.state)).toBe(plusSeconds(result.state.turnStartedAt!, 4 * 60 * 60));
    expect(draftClockView(result.state).pausedUntil).toBeNull();
  });

  it("never extends a deadline when the configured window is explicitly null", () => {
    const start: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, timestamp: "2026-09-15T03:30:00.000Z", draftOrder: ["t1", "t2"], pool: POOL };
    const config: DraftConfig = { ...CONFIG, kickoffAt: days3After("2026-09-15T03:30:00.000Z"), pauseWindow: null };
    const result = reduceDraft(initialDraftState(config), start);
    if (!result.ok) throw new Error(result.reason);
    expect(currentDeadline(result.state)).toBe(plusSeconds(result.state.turnStartedAt!, 4 * 60 * 60));
  });
});
