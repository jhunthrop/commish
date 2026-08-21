import { describe, expect, it } from "vitest";
import type { AddressObservation } from "./similarity";
import { behavioralSimilarity, deviceSimilarity, ipCorrelation, multiAccountSuspicion } from "./similarity";
import { INTEGRITY_CONFIG } from "./config";

/** A `platform_verified` address observation — the only source `ipCorrelation` ever counts. */
function v(hash: string): AddressObservation {
  return { hash, source: "platform_verified" as const };
}

describe("deviceSimilarity", () => {
  it("is the overlap of the client signatures each account has ever signed in with", () => {
    // Jaccard: |A ∩ B| / |A ∪ B|. A = {x, y}, B = {y, z} → 1 / 3.
    expect(deviceSimilarity({ signatures: ["x", "y"] }, { signatures: ["y", "z"] })).toBeCloseTo(0.3333, 4);
  });

  it("is 1 for two accounts that have only ever signed in from the same one client", () => {
    expect(deviceSimilarity({ signatures: ["x"] }, { signatures: ["x"] })).toBe(1);
  });

  it("is 0 when they share nothing, and 0 when either side has never signed in", () => {
    expect(deviceSimilarity({ signatures: ["x"] }, { signatures: ["y"] })).toBe(0);
    expect(deviceSimilarity({ signatures: [] }, { signatures: ["y"] })).toBe(0);
    // Not NaN. An empty union is the degenerate case a Jaccard implementation gets wrong once,
    // and a NaN reaching a weighted sum silently poisons the whole score.
  });

  it("is 0, not NaN, when NEITHER side has ever signed in — the empty-union branch itself", () => {
    expect(deviceSimilarity({ signatures: [] }, { signatures: [] })).toBe(0);
  });

  it("ignores a duplicate signature within one account's own list", () => {
    // {x, x} ∪ {x} = {x}, {x, x} ∩ {x} = {x} → 1, not 2/1 or any artifact of the duplicate.
    expect(deviceSimilarity({ signatures: ["x", "x"] }, { signatures: ["x"] })).toBe(1);
  });
});

describe("ipCorrelation", () => {
  it("counts only addresses the platform itself observed", () => {
    // Every hash written before Fly's proxy overwrites X-Forwarded-For is caller-influenced, so
    // it is not evidence of anything (ruling 8). Two accounts whose only shared address is
    // unverified correlate at 0, not at 1.
    const a = { addresses: [{ hash: "h1", source: "xff_unverified" as const }] };
    const b = { addresses: [{ hash: "h1", source: "xff_unverified" as const }] };
    expect(ipCorrelation(a, b)).toBe(0);
  });

  it("is the same Jaccard once the platform is the one reporting the address", () => {
    const a = { addresses: [v("h1"), v("h2")] };
    const b = { addresses: [v("h2")] };
    expect(ipCorrelation(a, b)).toBeCloseTo(0.5, 4); // |{h2}| / |{h1,h2}|
  });

  it("filters per account: a verified match survives even beside an unverified one that would otherwise inflate it", () => {
    const a = { addresses: [v("h1"), { hash: "h9", source: "xff_unverified" as const }] };
    const b = { addresses: [v("h1")] };
    expect(ipCorrelation(a, b)).toBe(1);
  });

  it("is 0, not NaN, when neither account has ANY platform-verified address at all", () => {
    const a = { addresses: [{ hash: "h1", source: "xff_unverified" as const }] };
    const b = { addresses: [] };
    expect(ipCorrelation(a, b)).toBe(0);
  });
});

describe("behavioralSimilarity", () => {
  it("compares how long each account takes to act, which is the thing a person does the same way twice", () => {
    // 1 - min(1, |medianA - medianB| / cadenceToleranceSeconds). 12s vs 18s, tolerance 60 → 0.9.
    expect(behavioralSimilarity({ medianSeconds: 12, actions: 20 }, { medianSeconds: 18, actions: 20 })).toBeCloseTo(0.9, 4);
  });

  it("is 0, not a guess, below the minimum sample", () => {
    // A median over two picks is noise, and noise fed into a weighted sum is a flag raised about
    // a real person on the strength of nothing.
    expect(behavioralSimilarity({ medianSeconds: 12, actions: 2 }, { medianSeconds: 12, actions: 40 })).toBe(0);
  });

  it("is 0 when the OTHER side is the one below the minimum sample", () => {
    // Exercises the second half of the guard, not just the first — actions.a is at the floor,
    // actions.b is the one that is short.
    expect(behavioralSimilarity({ medianSeconds: 12, actions: 40 }, { medianSeconds: 12, actions: 2 })).toBe(0);
  });

  it("computes normally right at the minimum sample — the boundary is inclusive, not exclusive", () => {
    const minActions = INTEGRITY_CONFIG.multiAccount.signals.minActionsForBehavioral;
    expect(behavioralSimilarity({ medianSeconds: 10, actions: minActions }, { medianSeconds: 10, actions: minActions })).toBe(1);
  });

  it("floors at 0 rather than going negative when the two are nothing alike", () => {
    expect(behavioralSimilarity({ medianSeconds: 4, actions: 20 }, { medianSeconds: 300, actions: 20 })).toBe(0);
  });

  it("is 1 for two accounts with the identical median", () => {
    expect(behavioralSimilarity({ medianSeconds: 30, actions: 20 }, { medianSeconds: 30, actions: 20 })).toBe(1);
  });
});

const WEIGHTS = { device: 0.6, ip: 0, behavioral: 0.4 };

describe("multiAccountSuspicion", () => {
  it("is the weighted mean over the signals that carry any weight at all", () => {
    // device 0.6 · 0.9 + behavioral 0.4 · 0.8, over a weight sum of 1.0 → 0.86.
    expect(multiAccountSuspicion({ device: 0.9, ip: 1, behavioral: 0.8 }, { device: 0.6, ip: 0, behavioral: 0.4 })).toBeCloseTo(0.86, 4);
  });

  it("ignores a zero-weighted signal completely, however extreme it is", () => {
    // The release gate as arithmetic. With ip at 0 a perfect address match cannot move the score
    // one thousandth, so an attacker forging X-Forwarded-For to look like somebody else's session
    // manufactures nothing at all — not a smaller flag, not any flag.
    const withMatch = multiAccountSuspicion({ device: 0.2, ip: 1, behavioral: 0.1 }, WEIGHTS);
    const without = multiAccountSuspicion({ device: 0.2, ip: 0, behavioral: 0.1 }, WEIGHTS);
    expect(withMatch).toBe(without);
  });

  it("normalizes by the weights in play, so turning the ip weight on later does not deflate the others", () => {
    // A plain Σ(w·s) would silently halve every existing score's meaning the day the gate flips.
    expect(multiAccountSuspicion({ device: 1, ip: 1, behavioral: 1 }, { device: 0.6, ip: 0.3, behavioral: 0.4 })).toBe(1);
  });

  it("is 0, never NaN, when every weight is 0 — a detector with nothing switched on has nothing to say", () => {
    expect(multiAccountSuspicion({ device: 1, ip: 1, behavioral: 1 }, { device: 0, ip: 0, behavioral: 0 })).toBe(0);
  });

  it("is 0, never NaN, for two all-zero accounts scored against the real shipped weights", () => {
    expect(multiAccountSuspicion({ device: 0, ip: 0, behavioral: 0 }, INTEGRITY_CONFIG.multiAccount.weights)).toBe(0);
  });
});
