import { describe, it, expect } from "vitest";
import { DRAFT_ROOM_CONFIG } from "./config";

/**
 * `config.ts` is a bare object literal — no functions, no branches. This smoke test is the
 * "imports it and asserts its exports exist" case `vitest.config.mts` calls out for a file
 * with no logic of its own: without it, the 100%-gated `src/draft-room/state/**` directory
 * would report this file uncovered (0/0 would trivially pass a threshold, but v8 still
 * counts the literal's own statement/line as unexecuted until something imports it).
 *
 * Asserts the SHAPE (every tunable a hook/component might read, each a positive number, plus
 * the one non-numeric tunable's own shape), not the literal values — a value tweak (e.g. a
 * shorter celebration) shouldn't require touching this test.
 */
describe("DRAFT_ROOM_CONFIG", () => {
  it("defines every numeric tunable as a positive number", () => {
    const numericKeys: readonly (keyof typeof DRAFT_ROOM_CONFIG)[] = ["poolPageSize", "celebrationMs"];
    const allKeys = [...numericKeys, "emptyCellBorderClass", "wire", "tv", "verdict", "tiers", "boardFutureRoundsShown", "dock", "debrief"] as const;
    expect(Object.keys(DRAFT_ROOM_CONFIG).sort()).toEqual([...allKeys].sort());
    for (const key of numericKeys) {
      expect(Number.isFinite(DRAFT_ROOM_CONFIG[key])).toBe(true);
      expect(DRAFT_ROOM_CONFIG[key]).toBeGreaterThan(0);
    }
  });

  // `PickWire`'s own tunable: a positive item count, or the band silently shows nothing (0)
  // or an unbounded history (a negative/non-finite cap would never trim).
  it("caps the pick wire at a positive number of items", () => {
    expect(Number.isFinite(DRAFT_ROOM_CONFIG.wire.maxItems)).toBe(true);
    expect(DRAFT_ROOM_CONFIG.wire.maxItems).toBeGreaterThan(0);
  });

  // Task 2 (review E5): the TV's own hot threshold. Positive, or the rule it gates never fires.
  it("defines the TV's own hot-threshold as a positive number", () => {
    expect(Number.isFinite(DRAFT_ROOM_CONFIG.tv.hotThresholdMs)).toBe(true);
    expect(DRAFT_ROOM_CONFIG.tv.hotThresholdMs).toBeGreaterThan(0);
  });

  // Gameday, law 4: the board's round horizon, now on BOTH variants. Every value positive, or
  // the rule collapses everything including the active round; and the room's horizon stays at
  // least the TV's, because a manager plans against the next few rounds and a party does not.
  it("gives every board variant a positive round horizon, the room's no shorter than the TV's", () => {
    for (const [variant, rounds] of Object.entries(DRAFT_ROOM_CONFIG.boardFutureRoundsShown)) {
      expect(Number.isFinite(rounds), variant).toBe(true);
      expect(rounds, variant).toBeGreaterThan(0);
    }
    expect(DRAFT_ROOM_CONFIG.boardFutureRoundsShown.room).toBeGreaterThanOrEqual(DRAFT_ROOM_CONFIG.boardFutureRoundsShown.tv);
  });

  // Gameday, law 1's grade channel: the pool's tier ladder. A cliff of zero would open a band
  // between every adjacent pair; a band size under two would let the sparse tail of the ADP feed
  // draw a rung per player. The ladder itself must end unbounded, or a deep-enough ADP falls off
  // the end and gets no grade at all.
  it("keeps the tier ladder measurable and unbounded at its foot", () => {
    expect(DRAFT_ROOM_CONFIG.tiers.cliffAdp).toBeGreaterThan(0);
    expect(DRAFT_ROOM_CONFIG.tiers.minBandSize).toBeGreaterThanOrEqual(2);
    expect(DRAFT_ROOM_CONFIG.tiers.ladder.length).toBeGreaterThan(0);
    const rungs = DRAFT_ROOM_CONFIG.tiers.ladder;
    expect(rungs[rungs.length - 1]!.throughRound).toBe(Number.POSITIVE_INFINITY);
    // Ascending, so `find` returns the FIRST rung a round still fits inside.
    for (let index = 1; index < rungs.length; index++) {
      expect(rungs[index]!.throughRound).toBeGreaterThan(rungs[index - 1]!.throughRound);
    }
  });

  // Task 7 (the fun pass): the even band has to be a positive count of picks, or every pick in
  // every room becomes a verdict — a zero band makes "took him one slot early" a reach, which is
  // the manufactured judgement the band exists to prevent.
  it("keeps the verdict's even band a positive number of picks", () => {
    expect(Number.isFinite(DRAFT_ROOM_CONFIG.verdict.evenBandPicks)).toBe(true);
    expect(DRAFT_ROOM_CONFIG.verdict.evenBandPicks).toBeGreaterThan(0);
  });

  // The debrief's thresholds (the mock-drafts workflow pass): a reach definition of zero would
  // brand every non-perfect pick a reach; a shape window under a round reads no build at all;
  // a bye-stack floor under three names the two-teammate coincidence every roster has.
  it("keeps the debrief's thresholds meaningful", () => {
    expect(DRAFT_ROOM_CONFIG.debrief.reachRankedHigher).toBeGreaterThan(0);
    expect(DRAFT_ROOM_CONFIG.debrief.shapeRounds).toBeGreaterThanOrEqual(1);
    expect(DRAFT_ROOM_CONFIG.debrief.byeStackMin).toBeGreaterThanOrEqual(3);
  });

  // `DraftBoard`'s empty-cell recede: a future round's border may shrink, never dim past
  // `border-line`'s own decorative-hairline contrast (see `config.ts`'s own docblock for the
  // founder-reported defect this floor fixes).
  it("floors both empty-cell border classes at border-line, never a diluted border-line/NN", () => {
    const { emptyCellBorderClass } = DRAFT_ROOM_CONFIG;
    for (const value of Object.values(emptyCellBorderClass)) {
      expect(value).toMatch(/(?:^|\s)border-line(?:\s|$)/);
      expect(value).not.toMatch(/border-line\//);
    }
    // The two classes differ only by height — the recede is shape, never color.
    expect(emptyCellBorderClass.future).not.toBe(emptyCellBorderClass.near);
  });
});
