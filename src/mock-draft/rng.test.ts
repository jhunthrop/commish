import { describe, expect, it } from "vitest";
import { createSeededRng, rngFor, seededShuffle } from "./rng";

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

  it("treats a negative seed as the raw bit pattern of its unsigned twin — the |0 route bug's invariant", () => {
    // `cryptoSeed32` reinterprets an unsigned 32-bit draw as signed (`| 0`) to fit the Postgres
    // integer column; `seedForKey`'s ToInt32 coercion makes the sign immaterial. This pin is what
    // keeps a stored negative seed replaying byte-identically to its unsigned twin forever.
    const negative = rngFor(-1, "team_a");
    const unsignedTwin = rngFor(-1 >>> 0, "team_a");
    for (let i = 0; i < 8; i++) expect(negative.next()).toBe(unsignedTwin.next());
  });

  it("is stable across every character of the key, not just its length", () => {
    // "team_a" and "team_b" are the same length; only their content may distinguish the streams.
    expect(rngFor(1, "team_a").next()).not.toBe(rngFor(1, "team_b").next());
  });
});

describe("seededShuffle", () => {
  it("is a pure permutation: same stream, same order; the input array is never touched", () => {
    const input = ["a", "b", "c", "d", "e"];
    const frozen = [...input];
    const first = seededShuffle(input, createSeededRng(9));
    const second = seededShuffle(input, createSeededRng(9));
    expect(input).toEqual(frozen); // never mutated
    expect(second).toEqual(first); // same stream, same deal
    expect([...first].sort()).toEqual(frozen); // a permutation, nothing lost or invented
    expect(seededShuffle(input, createSeededRng(10))).not.toEqual(first);
  });
});
