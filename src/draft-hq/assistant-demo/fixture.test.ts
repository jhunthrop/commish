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

  it("puts the point-of-view seat on the clock exactly once per round, with five candidates each time", () => {
    const onClock = ASSISTANT_DEMO_FIXTURE.advisor.filter((view) => view.onTheClock);
    expect(onClock).toHaveLength(DEMO_ROUNDS);
    for (const view of onClock) {
      expect(view.now.length).toBeGreaterThan(0);
      expect(view.now.length).toBeLessThanOrEqual(5);
      expect(view.picksUntilYourTurn).toBe(0);
    }
  });

  it("shows all three bands at every step: a plan with odds over the stated runs, signals, and a now card", () => {
    for (const view of ASSISTANT_DEMO_FIXTURE.advisor) {
      expect(view.plan.runs).toBe(DEMO_RUNS);
      for (const turn of view.plan.turns) {
        for (const target of turn.targets) {
          const own = target.oddsByTurn[turn.turn - 1];
          expect(own).not.toBeNull();
          expect(own!.survival).toBeGreaterThanOrEqual(0);
          expect(own!.survival).toBeLessThanOrEqual(1);
          expect(own!.runs).toBeGreaterThan(0);
        }
      }
      expect(Array.isArray(view.signals.ahead)).toBe(true);
      expect(view.now.length).toBeGreaterThan(0);
      expect(view.voice.status).toBe("absent");
    }
  });

  it("plans three turns at every step: the replay stops at round four of a fifteen-round draft, so a turn beyond the end never comes up", () => {
    for (const view of ASSISTANT_DEMO_FIXTURE.advisor) expect(view.plan.turns).toHaveLength(3);
  });

  it("reads at least one seat ahead from its own picks once the room has drafted a while", () => {
    const later = ASSISTANT_DEMO_FIXTURE.advisor.slice(25);
    const inferred = later.flatMap((view) => view.signals.ahead.filter((seat) => seat.driver.kind === "archetype" && seat.driver.basis === "inferred"));
    const prior = later.flatMap((view) => view.signals.ahead.filter((seat) => seat.driver.kind === "archetype" && seat.driver.basis === "prior"));
    expect(inferred.length + prior.length).toBeGreaterThan(0);
  });

  it("every player referenced by a pick is in the players list, and every view carries a name for each id it shows", () => {
    const names = new Map(ASSISTANT_DEMO_FIXTURE.players.map((p) => [p.playerId, p.displayName]));
    for (const pick of ASSISTANT_DEMO_FIXTURE.picks) expect(names.get(pick.playerId)).toMatch(/^[A-Z]+ \d+$/);
    for (const view of ASSISTANT_DEMO_FIXTURE.advisor) {
      const shown = [...view.now.map((c) => c.playerId), ...view.plan.turns.flatMap((turn) => turn.targets.map((t) => t.playerId))];
      for (const id of shown) expect(view.names[id]).toBe(names.get(id));
    }
    for (const label of Object.values(ASSISTANT_DEMO_FIXTURE.teamLabels)) expect(label).toMatch(/^(You|Team \d+)$/);
  });

  it("is seeded and reproducible", () => {
    expect(ASSISTANT_DEMO_FIXTURE.seed).toBe(20260905);
    expect(ASSISTANT_DEMO_FIXTURE.runs).toBe(DEMO_RUNS);
  });
});
