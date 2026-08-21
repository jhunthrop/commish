import { describe, expect, it } from "vitest";
import { ADVISOR_CONFIG } from "@/domain/advisor";
import { INTEGRITY_CONFIG } from "./config";

describe("INTEGRITY_CONFIG.multiAccount", () => {
  it("keeps the release gate: the ip weight is exactly 0", () => {
    // The gate `similarity.test.ts` proves is arithmetic (a perfect ip match moves nothing) is
    // only real while this stays 0. Flipping it needs Fly's proxy AND the platform_verified
    // filter together — see the docblock on `weights` itself.
    expect(INTEGRITY_CONFIG.multiAccount.weights.ip).toBe(0);
  });

  it("every weight is non-negative, and at least one is positive", () => {
    // The three ways a tuning edit turns the detector off or on for everybody without anybody
    // noticing: a negative weight, every weight at 0, or a threshold outside (0, 1].
    const weights = Object.values(INTEGRITY_CONFIG.multiAccount.weights);
    for (const weight of weights) {
      expect(weight).toBeGreaterThanOrEqual(0);
    }
    expect(weights.some((weight) => weight > 0)).toBe(true);
  });

  it("flagThreshold is inside (0, 1] — reachable, and not trivially satisfied by every pair", () => {
    expect(INTEGRITY_CONFIG.multiAccount.flagThreshold).toBeGreaterThan(0);
    expect(INTEGRITY_CONFIG.multiAccount.flagThreshold).toBeLessThanOrEqual(1);
  });

  it("flagThreshold is reachable on device plus behavioral alone, with the ip weight held at 0", () => {
    // "Reachable on device plus behavioral alone, by design" — the config's own comment. If this
    // ever regressed, the ip gate being 0 would make the whole detector unreachable.
    const { device, behavioral } = INTEGRITY_CONFIG.multiAccount.weights;
    expect(device + behavioral).toBeGreaterThanOrEqual(INTEGRITY_CONFIG.multiAccount.flagThreshold);
  });

  it("carries the signal caps every heuristic and session-signal writer reads, with no duplicate keys", () => {
    const signals = INTEGRITY_CONFIG.multiAccount.signals;
    expect(signals).toEqual({
      cadenceToleranceSeconds: 60,
      minActionsForBehavioral: 5,
      maxUserAgentLength: 512,
      maxAcceptLanguageLength: 128,
      maxSignaturesPerAccount: 50,
    });
  });

  it("cadenceToleranceSeconds and minActionsForBehavioral are both positive — a 0 tolerance or a 0-action floor would not gate anything", () => {
    expect(INTEGRITY_CONFIG.multiAccount.signals.cadenceToleranceSeconds).toBeGreaterThan(0);
    expect(INTEGRITY_CONFIG.multiAccount.signals.minActionsForBehavioral).toBeGreaterThan(0);
  });
});

describe("INTEGRITY_CONFIG.trade", () => {
  it("keeps all four thresholds on one axis in one order, not just the two the spec names", () => {
    const { evenDelta, lopsidedDelta } = ADVISOR_CONFIG;
    const { fairnessFlagThreshold, autoHoldThreshold } = INTEGRITY_CONFIG.trade;
    // even <= lopsided <= flag <= hold. Every one of these is a real failure mode if inverted:
    // even > lopsided makes the verdict unreachable; lopsided > flag flags trades the advisor
    // itself calls fine; flag > hold holds a trade nobody ever flagged, which is the spec's own
    // Step 5 invariant read the right way round.
    expect(evenDelta).toBeLessThanOrEqual(lopsidedDelta);
    expect(lopsidedDelta).toBeLessThanOrEqual(fairnessFlagThreshold);
    if (autoHoldThreshold !== null) {
      expect(fairnessFlagThreshold).toBeLessThanOrEqual(autoHoldThreshold);
    }
  });

  it("keeps every threshold on the axis positive and finite", () => {
    for (const value of [ADVISOR_CONFIG.evenDelta, ADVISOR_CONFIG.lopsidedDelta, INTEGRITY_CONFIG.trade.fairnessFlagThreshold]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("ships autoHoldThreshold null — Plan D supplies a number, not a code path", () => {
    expect(INTEGRITY_CONFIG.trade.autoHoldThreshold).toBeNull();
  });

  it("bounds sweepBatchSize — an unbounded manual re-run is a script nobody runs twice", () => {
    expect(INTEGRITY_CONFIG.trade.sweepBatchSize).toBeGreaterThan(0);
    expect(Number.isFinite(INTEGRITY_CONFIG.trade.sweepBatchSize)).toBe(true);
  });
});
