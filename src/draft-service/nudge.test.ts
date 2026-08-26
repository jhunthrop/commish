import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players, users } from "@/db/schema";
import type { DraftState } from "@/draft-engine";
import { createDraftStore } from "./store";
import { createNudgeScheduler, NO_OP_NUDGE_SCHEDULER } from "./nudge";
import { DRAFT_NUDGE_CONFIG } from "./config";
import { staticNudge, type NudgeCopyFn } from "./nudge-copy";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const START = "2026-09-01T00:00:00.000Z";
const clock = { now: () => START };
// The 8-hour tier is in force nine days from kickoff: the turn is 28,800s long, so the 75%
// mark is +6h (2026-09-01T06:00:00.000Z, which happens to land exactly at the overnight
// freeze's own open — 2 AM ET — and so is not itself pushed any further by it; see the
// "does not extend a deadline that starts exactly at the window's open" reasoning in
// `pause.test.ts`). The raw, un-paused deadline would be +8h; `loadDraftConfig` (via
// `store.startDraft`, which every fixture below runs through) attaches the REAL
// `DRAFT_PAUSE_WINDOW`, so this fixture's true deadline is pushed to +11h instead, past the
// 2-5 AM ET freeze the turn's own start (8 PM ET, 8/31) runs straight into.
const BEFORE_THRESHOLD = "2026-09-01T05:00:00.000Z";
// After the threshold (06:00Z), past the freeze's own close (09:00Z) and well before the
// pause-extended deadline (11:00Z) — the ordinary "yes, nudge" instant every existing test
// below already assumed, just moved off 07:00Z now that 07:00Z sits inside the freeze itself.
const AFTER_THRESHOLD = "2026-09-01T09:30:00.000Z";
// Inside the freeze itself (3 AM ET) — after the (unmoved) threshold and before the
// (pause-extended) deadline, which is exactly the gap `isPaused` exists to close: a due time
// that sits at the window's own open and a deadline pushed past its close still leave the whole
// freeze inside the "nudge now" range, so the range check alone is not enough.
const DURING_THE_FREEZE = "2026-09-01T07:00:00.000Z";
const AFTER_DEADLINE = "2026-09-01T12:00:00.000Z";

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

async function liveDraft(format: "snake" | "auction" = "snake") {
  const f = await seedDraftFixture(db, {
    draftId: `draft_nudge_${format}`, leagueId: `league_nudge_${format}`, format, teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: format === "auction" ? 200 : null,
  });
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
  const store = createDraftStore({ db, clock, publish: async () => "1-0" });
  await store.startDraft(f.draftId);
  const state = (await store.getDraftState(f.draftId)) as DraftState;
  return { ...f, store, state };
}

function schedulerWith(copy: NudgeCopyFn = async () => "Custom nudge.") {
  const published: { type: string; leagueId: string; payload: unknown }[] = [];
  const scheduler = createNudgeScheduler({
    db,
    copy,
    publish: async (input) => {
      published.push({ type: input.type, leagueId: input.leagueId, payload: input.payload });
      return "1-0";
    },
  });
  return { scheduler, published };
}

describe("nudge scheduler", () => {
  it("says nothing before the threshold", async () => {
    const draft = await liveDraft();
    const { scheduler, published } = schedulerWith();
    expect(await scheduler.nudge(draft.state, BEFORE_THRESHOLD)).toBe("skipped");
    expect(published).toEqual([]);
  });

  it("publishes exactly one draft.nudge at the threshold, addressed to the team on the clock", async () => {
    const draft = await liveDraft();
    const { scheduler, published } = schedulerWith();
    expect(await scheduler.nudge(draft.state, AFTER_THRESHOLD)).toBe("published");
    expect(published).toHaveLength(1);
    expect(published[0]!.type).toBe("draft.nudge");
    expect(published[0]!.leagueId).toBe(draft.leagueId);
    expect(published[0]!.payload).toMatchObject({
      draftId: draft.draftId,
      teamId: draft.state.draftOrder[0]!,
      message: "Custom nudge.",
    });
    expect((published[0]!.payload as { clock: { sequence: number } }).clock.sequence).toBe(draft.state.sequence);
  });

  it("does not nudge the same turn twice", async () => {
    const draft = await liveDraft();
    const { scheduler, published } = schedulerWith();
    expect(await scheduler.nudge(draft.state, AFTER_THRESHOLD)).toBe("published");
    expect(await scheduler.nudge(draft.state, AFTER_THRESHOLD)).toBe("already-nudged");
    expect(published).toHaveLength(1);
  });

  it("does not re-arm when somebody edits a queue mid-turn", async () => {
    // A SET_QUEUE by ANY manager bumps `sequence` while deliberately leaving `turnStartedAt`
    // and `pickNumber` alone — editing a queue must never touch anybody's clock. A claim keyed
    // on `sequence` therefore released mid-turn: duplicate nudges to the team on the clock, and
    // a way for one manager to drive another's nudges (and the model spend) at will.
    const draft = await liveDraft();
    const { scheduler, published } = schedulerWith();
    expect(await scheduler.nudge(draft.state, AFTER_THRESHOLD)).toBe("published");

    const edited = await draft.store.applyAction(draft.draftId, {
      v: 1, type: "SET_QUEUE", timestamp: START, teamId: draft.state.draftOrder[1]!, playerIds: ["wr1"],
    });
    expect(edited.ok).toBe(true);
    const after = (edited as { state: DraftState }).state;
    expect(after.sequence).toBe(draft.state.sequence + 1);
    expect(after.pickNumber).toBe(draft.state.pickNumber);

    expect(await scheduler.nudge(after, AFTER_THRESHOLD)).toBe("already-nudged");
    expect(published).toHaveLength(1);
  });

  it("nudges exactly once when two independent scheduler instances race on the same turn", async () => {
    const draft = await liveDraft();
    const a = schedulerWith();
    const b = schedulerWith();
    // Two processes hit the same threshold in the same tick. The in-process code cannot
    // coordinate them; the (draft_id, pick_number) primary key's ON CONFLICT DO NOTHING is
    // what must let exactly one claim through — mirroring the store's double-append race.
    const results = await Promise.all([
      a.scheduler.nudge(draft.state, AFTER_THRESHOLD),
      b.scheduler.nudge(draft.state, AFTER_THRESHOLD),
    ]);
    expect(results.filter((r) => r === "published")).toHaveLength(1);
    expect(results.filter((r) => r === "already-nudged")).toHaveLength(1);
    expect(a.published.length + b.published.length).toBe(1);
  });

  it("stays idempotent across a restart, because the claim is a row and not a memory", async () => {
    const draft = await liveDraft();
    const first = schedulerWith();
    expect(await first.scheduler.nudge(draft.state, AFTER_THRESHOLD)).toBe("published");
    // A brand-new scheduler is exactly what a redeploy or a second instance looks like.
    const second = schedulerWith();
    expect(await second.scheduler.nudge(draft.state, AFTER_THRESHOLD)).toBe("already-nudged");
    expect(second.published).toEqual([]);
  });

  it("says nothing once the clock has already run out — that is the ticker's job", async () => {
    const draft = await liveDraft();
    const { scheduler, published } = schedulerWith();
    expect(await scheduler.nudge(draft.state, AFTER_DEADLINE)).toBe("skipped");
    expect(published).toEqual([]);
  });

  it("says nothing during the overnight freeze, even though the un-extended threshold and deadline would otherwise bracket it", async () => {
    // Task 4. `dueAt` for this fixture sits exactly at the freeze's own open (2 AM ET) and never
    // moves — a deadline landing exactly on a window's boundary is not itself inside it — while
    // `deadlineAt` gets pushed all the way to 11 AM UTC. That leaves the ENTIRE 2-5 AM ET freeze
    // sitting inside `[dueAt, deadlineAt)`, so a bare range check would nudge right through it;
    // `isPaused` is what actually closes the gap.
    const draft = await liveDraft();
    const { scheduler, published } = schedulerWith();
    expect(await scheduler.nudge(draft.state, DURING_THE_FREEZE)).toBe("skipped");
    expect(published).toEqual([]);
  });

  it("says nothing while an auction lot is live, because nobody is on the clock alone", async () => {
    const draft = await liveDraft("auction");
    const nominated = await draft.store.applyAction(draft.draftId, {
      v: 1, type: "NOMINATE", timestamp: START, teamId: draft.state.draftOrder[0]!, playerId: "qb1", openingBid: 1,
    });
    expect(nominated.ok).toBe(true);
    const { scheduler, published } = schedulerWith();
    expect(await scheduler.nudge((nominated as { state: DraftState }).state, AFTER_THRESHOLD)).toBe("skipped");
    expect(published).toEqual([]);
  });

  it("nudges the nominating team to nominate, before any lot is open", async () => {
    // Before the first NOMINATE, teamOnClock() is the nominating team (auction.lot === null),
    // and the copy is for "nominate" rather than "pick" — the auction lot's own live-lot test
    // above only proves the OPPOSITE state (skipped, nobody on the clock alone).
    const draft = await liveDraft("auction");
    const { scheduler, published } = schedulerWith();
    expect(await scheduler.nudge(draft.state, AFTER_THRESHOLD)).toBe("published");
    expect(published[0]!.payload).toMatchObject({ teamId: draft.state.draftOrder[0]! });
  });

  it("falls back to a generic team name when the on-the-clock team row is somehow gone", async () => {
    // Real Postgres always has a team row for whoever's drafting — this proves the copy still
    // reads sensibly if it somehow doesn't, without inventing a code path that produces it.
    const draft = await liveDraft();
    const ghostState: DraftState = { ...draft.state, draftOrder: ["team_ghost", ...draft.state.draftOrder.slice(1)] };
    const { scheduler, published } = schedulerWith(async (input) => input.teamName);
    expect(await scheduler.nudge(ghostState, AFTER_THRESHOLD)).toBe("published");
    expect(published[0]!.payload).toMatchObject({ message: "Your team" });
  });

  it("falls back to the static reminder, using the team's real name", async () => {
    const draft = await liveDraft();
    const { scheduler, published } = schedulerWith(async (input) => staticNudge(input));
    await scheduler.nudge(draft.state, AFTER_THRESHOLD);
    // Brief-test defect (documented, fixed minimally): `draftOrderFor` deterministically
    // shuffles by a hash of the draft id, so `draftOrder[0]` isn't guaranteed to be the
    // first-seeded team — for this fixture's draft id it is actually "Team 2". Derive the
    // expected name from whichever team is really on the clock instead of hardcoding it.
    const onClockIndex = draft.teamIds.indexOf(draft.state.draftOrder[0]!);
    expect((published[0]!.payload as { message: string }).message).toContain(`Team ${onClockIndex + 1}`);
    expect((published[0]!.payload as { message: string }).message).toContain("Make your pick");
  });

  it("reports a publish failure instead of throwing it at the ticker", async () => {
    const draft = await liveDraft();
    const onError = vi.fn();
    const scheduler = createNudgeScheduler({
      db,
      copy: async () => "x",
      publish: async () => {
        throw new Error("redis down");
      },
      onError,
    });
    await expect(scheduler.nudge(draft.state, AFTER_THRESHOLD)).resolves.toBe("skipped");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("uses the configured threshold, not a literal", () => {
    expect(DRAFT_NUDGE_CONFIG.thresholdPct).toBeGreaterThan(0);
    expect(DRAFT_NUDGE_CONFIG.thresholdPct).toBeLessThanOrEqual(100);
  });

  it("has a no-op scheduler for callers that do not want one", async () => {
    const draft = await liveDraft();
    expect(await NO_OP_NUDGE_SCHEDULER.nudge(draft.state, AFTER_THRESHOLD)).toBe("skipped");
  });

  it("never nudges a bot on the clock (Task 4) — the moderator only ever speaks to a human", async () => {
    const draft = await liveDraft();
    const onClockTeamIndex = draft.teamIds.indexOf(draft.state.draftOrder[0]!);
    await db.update(users).set({ isBot: true }).where(eq(users.id, draft.userIds[onClockTeamIndex]!));
    const { scheduler, published } = schedulerWith();

    expect(await scheduler.nudge(draft.state, AFTER_THRESHOLD)).toBe("skipped");
    expect(published).toEqual([]);
  });

  it("still nudges a human even after a DIFFERENT team's owner was resolved as a bot — the cache is keyed per team", async () => {
    const draft = await liveDraft();
    // A team NOT on the clock is the bot here — proves `isBotCache` keys on the team id actually
    // checked, not on "any bot exists in this draft".
    const offClockTeamIndex = draft.teamIds.indexOf(draft.state.draftOrder[1]!);
    await db.update(users).set({ isBot: true }).where(eq(users.id, draft.userIds[offClockTeamIndex]!));
    const { scheduler, published } = schedulerWith();

    expect(await scheduler.nudge(draft.state, AFTER_THRESHOLD)).toBe("published");
    expect(published).toHaveLength(1);
  });
});
