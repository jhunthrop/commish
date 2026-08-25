import { describe, expect, it } from "vitest";
import { createSeededRng, rngFor } from "./rng";

describe("createSeededRng", () => {
  it("produces the identical sequence for the identical seed, and a different one for the next seed", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const c = createSeededRng(43);
    const seqA = [a.next(), a.next(), a.next()];
    expect(seqA).toEqual([b.next(), b.next(), b.next()]);
    expect(seqA).not.toEqual([c.next(), c.next(), c.next()]);
  });

  it("returns floats in the half-open range [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 50; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("advances its own internal state rather than repeating the first draw", () => {
    const rng = createSeededRng(1);
    const first = rng.next();
    const second = rng.next();
    expect(second).not.toBe(first);
  });
});

describe("rngFor", () => {
  it("derives independent, reproducible per-bot streams from one draft seed", () => {
    const a1 = [rngFor(42, "team_a").next(), rngFor(42, "team_a").next()];
    expect(rngFor(42, "team_a").next()).toBe(a1[0]); // same seed + key: same stream
    expect(rngFor(42, "team_b").next()).not.toBe(a1[0]); // different key: distinct stream
  });

  it("derives a different stream for the same key under a different draft seed", () => {
    expect(rngFor(42, "team_a").next()).not.toBe(rngFor(43, "team_a").next());
  });

  it("is stable across every character of the key, not just its length", () => {
    // "team_a" and "team_b" are the same length; only their content may distinguish the streams.
    expect(rngFor(1, "team_a").next()).not.toBe(rngFor(1, "team_b").next());
  });
});
