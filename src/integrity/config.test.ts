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
    expect(autoHoldThreshold).not.toBeNull();
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

  it("ships autoHoldThreshold as 35, Plan D's own number, above the fairness flag threshold", () => {
    expect(INTEGRITY_CONFIG.trade.autoHoldThreshold).toBe(35);
    expect(INTEGRITY_CONFIG.trade.autoHoldThreshold).toBeGreaterThan(INTEGRITY_CONFIG.trade.fairnessFlagThreshold);
  });

  it("bounds sweepBatchSize — an unbounded manual re-run is a script nobody runs twice", () => {
    expect(INTEGRITY_CONFIG.trade.sweepBatchSize).toBeGreaterThan(0);
    expect(Number.isFinite(INTEGRITY_CONFIG.trade.sweepBatchSize)).toBe(true);
  });
});

describe("INTEGRITY_CONFIG.participation", () => {
  it("keeps the verified cutoff at or below the veteran cutoff", () => {
    // An inversion would mean an account the platform segregates as experienced and refuses to
    // call verified, which is two statements about one person that contradict each other.
    expect(INTEGRITY_CONFIG.participation.verifiedSeasonCutoff).toBeLessThanOrEqual(INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
  });

  it("keeps both cutoffs positive and finite", () => {
    for (const value of [INTEGRITY_CONFIG.participation.veteranSeasonCutoff, INTEGRITY_CONFIG.participation.verifiedSeasonCutoff]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("ships enforceTierSegregation true — this task computes the tier; the join gate that reads this switch is a later task's", () => {
    expect(INTEGRITY_CONFIG.participation.enforceTierSegregation).toBe(true);
  });
});

/**
 * FINAL REVIEW, MEDIUM 6. The notices ceiling is reachable by ORDINARY BROWSING, not by abuse:
 * every page mounts `useNotices` in its own subtree (there is no shared app layout), and each
 * mount costs TWO `GET /api/notices` — the mount fetch and the SSE `open` refetch. At the old 30
 * that was fifteen navigations, and a 429 replaces the member's notices with an error state.
 *
 * The architectural fix is Plan D's (ledgered in the Phase 3 overview). This is the honest
 * stopgap, and the point of pinning it here is that the NUMBER is derived rather than picked: the
 * arithmetic lives in `config.ts`'s own docblock, and this test is what stops a later edit from
 * quietly walking it back below what real navigation costs.
 */
describe("the notices ceiling is above what real navigation costs", () => {
  /** What `useNotices` (`@/account-room/hooks/use-notices`) spends per client-side navigation:
   *  the mount fetch, plus the refcounted stream's `open` refetch after it reopens. */
  const REQUESTS_PER_NAVIGATION = 2;
  /** One navigation every two seconds, sustained for the whole window — click, render, look.
   *  Faster than any real member browses for a full minute. */
  const NAVIGATION_INTERVAL_MS = 2_000;

  it("lets a member navigate every two seconds for a whole window without a 429", () => {
    const { maxRequests, windowMs } = INTEGRITY_CONFIG.notices.rateLimit;
    const navigationsPerWindow = windowMs / NAVIGATION_INTERVAL_MS;
    // Plus the shared `POST /api/notices/read`, at most one per navigation when the bell is
    // opened with unread notices — the two routes spend one budget on purpose.
    const worstCaseRequests = navigationsPerWindow * (REQUESTS_PER_NAVIGATION + 1);
    expect(maxRequests).toBeGreaterThanOrEqual(worstCaseRequests);
  });

  it("keeps the ceiling finite and the window a real minute", () => {
    expect(Number.isFinite(INTEGRITY_CONFIG.notices.rateLimit.maxRequests)).toBe(true);
    expect(INTEGRITY_CONFIG.notices.rateLimit.windowMs).toBe(60_000);
  });
});
