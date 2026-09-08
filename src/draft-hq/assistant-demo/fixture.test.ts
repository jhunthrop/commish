import { describe, expect, it } from "vitest";
import { ASSISTANT_DEMO_FIXTURE, DEMO_POV_TEAM_ID, DEMO_ROUNDS, DEMO_RUNS, DEMO_TEAM_COUNT } from "./fixture";

describe("ASSISTANT_DEMO_FIXTURE", () => {
  it("replays the full configured draft, in pick order, with one advisor view per step", () => {
    const totalPicks = DEMO_TEAM_COUNT * DEMO_ROUNDS;
    expect(ASSISTANT_DEMO_FIXTURE.picks).toHaveLength(totalPicks);
    expect(ASSISTANT_DEMO_FIXTURE.picks.map((p) => p.pickNumber)).toEqual(Array.from({ length: totalPicks }, (_, i) => i + 1));
    expect(ASSISTANT_DEMO_FIXTURE.advisor).toHaveLength(totalPicks + 1);
    ASSISTANT_DEMO_FIXTURE.advisor.forEach((view, step) => expect(view.stamp.computedAtPick).toBe(step + 1));
  });

  it("never repeats a player across the whole replayed room", () => {
    const ids = ASSISTANT_DEMO_FIXTURE.picks.map((p) => p.playerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels the point-of-view seat 'You' and every other seat a numbered team", () => {
    expect(ASSISTANT_DEMO_FIXTURE.povTeamId).toBe(DEMO_POV_TEAM_ID);
    expect(ASSISTANT_DEMO_FIXTURE.povLabel).toBe("You");
    for (const pick of ASSISTANT_DEMO_FIXTURE.picks.filter((p) => p.teamId === DEMO_POV_TEAM_ID)) expect(pick.teamLabel).toBe("You");
    for (const pick of ASSISTANT_DEMO_FIXTURE.picks.filter((p) => p.teamId !== DEMO_POV_TEAM_ID)) expect(pick.teamLabel).toMatch(/^Team \d+$/);
  });

  it("puts the point-of-view seat on the clock exactly once per round, with a pick each time", () => {
    const onClock = ASSISTANT_DEMO_FIXTURE.advisor.filter((view) => view.onTheClock);
    expect(onClock).toHaveLength(DEMO_ROUNDS);
    for (const view of onClock) {
      expect(view.pick).not.toBeNull();
      expect(view.picksUntilYourTurn).toBe(0);
    }
  });

  it("carries the one card and the pool odds at every step: a pick with its why, odds over the stated runs for every undrafted player, tiers for the projected ones", () => {
    const drafted = new Set<string>();
    ASSISTANT_DEMO_FIXTURE.advisor.forEach((view, step) => {
      if (step > 0) drafted.add(ASSISTANT_DEMO_FIXTURE.picks[step - 1]!.playerId);
      expect(view.runs).toBe(DEMO_RUNS);
      expect(view.pick).not.toBeNull();
      expect(view.pick!.why.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
      expect(view.pick!.makeItBack!.runs).toBe(DEMO_RUNS);
      const undrafted = ASSISTANT_DEMO_FIXTURE.players.map((p) => p.playerId).filter((id) => !drafted.has(id));
      expect(Object.keys(view.odds!.survived).sort()).toEqual([...undrafted].sort());
      for (const id of undrafted) {
        const standing = view.tiers[id];
        if (id.startsWith("k") || id.startsWith("def")) expect(standing).toBeUndefined();
        else expect(standing!.left).toBeGreaterThan(0);
      }
    });
  });

  it("moves the odds as the room steps: at least one player's survival changes between the first two views", () => {
    const [first, second] = ASSISTANT_DEMO_FIXTURE.advisor;
    const moved = Object.entries(second!.odds!.survived).filter(([id, count]) => first!.odds!.survived[id] !== count);
    expect(moved.length).toBeGreaterThan(0);
  });

  it("orders the board best first by value and names every player, never a real athlete", () => {
    const names = new Map(ASSISTANT_DEMO_FIXTURE.players.map((p) => [p.playerId, p.displayName]));
    expect(ASSISTANT_DEMO_FIXTURE.boardOrder).toHaveLength(ASSISTANT_DEMO_FIXTURE.players.length);
    for (const id of ASSISTANT_DEMO_FIXTURE.boardOrder) expect(names.get(id)).toMatch(/^[A-Z]+ \d+$/);
    for (const view of ASSISTANT_DEMO_FIXTURE.advisor) expect(names.has(view.pick!.playerId)).toBe(true);
  });

  it("is seeded and reproducible", () => {
    expect(ASSISTANT_DEMO_FIXTURE.seed).toBe(20260905);
    expect(ASSISTANT_DEMO_FIXTURE.runs).toBe(DEMO_RUNS);
  });
});
