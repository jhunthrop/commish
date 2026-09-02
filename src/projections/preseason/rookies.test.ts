import { describe, expect, it } from "vitest";
import {
  capitalShares,
  DRAFT_BUCKETS,
  draftBucketFor,
  landingMultiplier,
  rookieOpportunity,
  UNDRAFTED_PICK,
  type RookieFeatures,
  type RookieInput,
} from "./rookies";
import { FITTED_ROOKIE_PRIORS } from "./fitted";

/**
 * The plan's own cases: a first-round back projects materially more opportunity than a fifth-round
 * back on the same depth chart, and the same player behind an entrenched starter projects less.
 *
 * `docs/research/2026-08-27-preseason-board.md` records that the second of those two, measured on
 * the held-out seasons, makes the rookie ordering WORSE than ranking the class by draft pick alone.
 * These tests pin what the module does, which is what makes that measurement interpretable; they do
 * not claim the module earns its place, because the measurement says it does not.
 */

function rookie(overrides: Partial<RookieInput> = {}): RookieInput {
  return { playerId: "rookie", position: "RB", team: "ATL", overallPick: 8, incumbentClaim: 1, ...overrides };
}

describe("draftBucketFor", () => {
  it("buckets an overall pick by the modern seven-round draft's own boundaries", () => {
    expect(draftBucketFor(1)).toBe("round1");
    expect(draftBucketFor(32)).toBe("round1");
    expect(draftBucketFor(33)).toBe("round2");
    expect(draftBucketFor(64)).toBe("round2");
    expect(draftBucketFor(105)).toBe("round3");
    expect(draftBucketFor(180)).toBe("rounds4to5");
    expect(draftBucketFor(250)).toBe("rounds6to7");
  });

  it("reads the undrafted as a status rather than as a very late pick or as a missing value", () => {
    expect(draftBucketFor(null)).toBe("undrafted");
    expect(draftBucketFor(0)).toBe("undrafted");
    expect(DRAFT_BUCKETS).toContain(draftBucketFor(null));
  });
});

describe("the committed fit", () => {
  it("NEVER PROJECTS MORE OPPORTUNITY FOR LESS DRAFT CAPITAL, at any position", () => {
    // The premise of the whole module is that a team giving up more for a player intends him a
    // larger role. A thin cell saying third-rounders out-target first-rounders is noise, and a board
    // acting on it would rank a fifth-round back above a top-ten pick for no defensible reason.
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const cells = DRAFT_BUCKETS.map((bucket) => FITTED_ROOKIE_PRIORS.byBucket[position][bucket]);
      for (let index = 1; index < cells.length; index += 1) {
        expect(cells[index]!.snapShare).toBeLessThanOrEqual(cells[index - 1]!.snapShare);
        expect(cells[index]!.targetShare).toBeLessThanOrEqual(cells[index - 1]!.targetShare);
        expect(cells[index]!.carryShare).toBeLessThanOrEqual(cells[index - 1]!.carryShare);
      }
    }
  });

  it("holds a positive team volume, or every rookie would compose to exactly zero points", () => {
    expect(FITTED_ROOKIE_PRIORS.leagueTeamVolume.targets).toBeGreaterThan(0);
    expect(FITTED_ROOKIE_PRIORS.leagueTeamVolume.carries).toBeGreaterThan(0);
  });
});

describe("landingMultiplier", () => {
  const priors = FITTED_ROOKIE_PRIORS;

  it("is one for a rookie landing in a typical room, so the capital prior passes through unchanged", () => {
    const typical = priors.typicalIncumbentClaim.RB;
    expect(landingMultiplier(rookie({ incumbentClaim: typical }), priors)).toBeCloseTo(1, 10);
  });

  it("cuts a rookie landing behind an entrenched starter and raises one landing in an empty room", () => {
    const typical = priors.typicalIncumbentClaim.RB;
    expect(landingMultiplier(rookie({ incumbentClaim: typical * 1.8 }), priors)).toBeLessThan(1);
    expect(landingMultiplier(rookie({ incumbentClaim: 0 }), priors)).toBeGreaterThan(1);
  });

  it("IS BOUNDED, so a depth chart in August can never overturn a first-round pick", () => {
    const bound = priors.landingBound;
    for (const claim of [0, 0.1, 5, 50]) {
      const multiplier = landingMultiplier(rookie({ incumbentClaim: claim }), priors);
      expect(multiplier).toBeLessThanOrEqual(1 + bound);
      expect(multiplier).toBeGreaterThanOrEqual(1 - bound);
    }
  });
});

describe("rookieOpportunity", () => {
  const priors = FITTED_ROOKIE_PRIORS;
  /** What the board ships: the landing term off, the capital curve on. */
  const SHIPPED: RookieFeatures = { landingSpot: false, pickCurve: true };
  /** The rejected arm, kept because the two landing cases below are what it exists to do. */
  const WITH_LANDING: RookieFeatures = { landingSpot: true, pickCurve: true };

  it("PINS THE PLAN'S CASE: a first-round back projects materially more than a fifth-round back on the same depth chart", () => {
    const first = rookieOpportunity(rookie({ overallPick: 8 }), priors, SHIPPED);
    const fifth = rookieOpportunity(rookie({ overallPick: 150 }), priors, SHIPPED);
    expect(first.carryShare).toBeGreaterThan(fifth.carryShare);
    expect(first.snapShare).toBeGreaterThan(fifth.snapShare);
  });

  it("PINS THE PLAN'S SECOND CASE: the same player behind an entrenched starter projects less", () => {
    const typical = priors.typicalIncumbentClaim.RB;
    const openRoom = rookieOpportunity(rookie({ incumbentClaim: typical * 0.2 }), priors, WITH_LANDING);
    const crowded = rookieOpportunity(rookie({ incumbentClaim: typical * 1.8 }), priors, WITH_LANDING);
    expect(crowded.carryShare).toBeLessThan(openRoom.carryShare);
    expect(crowded.snapShare).toBeLessThan(openRoom.snapShare);
  });

  it("emits the SAME SHAPE layer 1 emits for everybody else, so nothing downstream forks on rookies", () => {
    const predicted = rookieOpportunity(rookie(), priors, SHIPPED);
    expect(predicted.playerId).toBe("rookie");
    for (const share of [predicted.snapShare, predicted.targetShare, predicted.carryShare, predicted.passAttemptShare]) {
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
    expect(predicted.teamTargets).toBe(priors.leagueTeamVolume.targets);
  });

  it("does not take the landing adjustment twice on a rookie quarterback's throws", () => {
    // The bucket prior already encodes that a first-round quarterback starts and a sixth-round one
    // does not. Multiplying by the incumbent claim as well would rate a rookie behind a franchise
    // starter at a share the bucket has already set near zero.
    const behindAStarter = rookieOpportunity(rookie({ position: "QB", incumbentClaim: 10 }), priors, WITH_LANDING);
    const emptyRoom = rookieOpportunity(rookie({ position: "QB", incumbentClaim: 0 }), priors, WITH_LANDING);
    expect(behindAStarter.passAttemptShare).toBe(emptyRoom.passAttemptShare);
  });

  it("gives an undrafted rookie the least of anybody, which is what nobody spending a pick means", () => {
    const undrafted = rookieOpportunity(rookie({ overallPick: null }), priors, SHIPPED);
    const last = rookieOpportunity(rookie({ overallPick: 250 }), priors, SHIPPED);
    expect(undrafted.snapShare).toBeLessThanOrEqual(last.snapShare);
  });
});

describe("capitalShares", () => {
  const priors = FITTED_ROOKIE_PRIORS;
  const CURVE: RookieFeatures = { landingSpot: false, pickCurve: true };
  const BUCKETS: RookieFeatures = { landingSpot: false, pickCurve: false };

  it("ORDERS A CLASS BY DRAFT CAPITAL, which six flat buckets cannot", () => {
    // Six cells hand a whole round one number: the fourth pick and the twentieth are both "round 1"
    // and a bucket table cannot tell them apart. That is the defect the curve exists for.
    //
    // THE POSITION AND THE PAIR BOTH MATTER, and pretending otherwise would overclaim (fit-round
    // Task 4). The full-cohort refit is a step function with wide plateaus, and RB's is flat from
    // roughly pick 16 to pick 40, so the pair this test used to use (RB 4 against RB 30) now sits
    // inside one plateau and the curve honestly cannot separate it either. QB has a real step inside
    // round one, which is what this asserts. The guarantee is that the curve separates picks the
    // bucket table cannot WHERE THE MEASURED CURVE ACTUALLY MOVES, never everywhere; the monotone
    // test below is what holds across the whole draft.
    const share = (pick: number, features: RookieFeatures): number =>
      capitalShares("QB", pick, priors, features).carryShare;
    expect(share(4, BUCKETS)).toBe(share(20, BUCKETS));
    expect(share(4, CURVE)).toBeGreaterThan(share(20, CURVE));
  });

  it("is monotone in the pick across the whole draft, never rewarding a later pick", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      for (let pick = 2; pick <= UNDRAFTED_PICK; pick += 1) {
        const above = capitalShares(position, pick - 1, priors, CURVE);
        const below = capitalShares(position, pick, priors, CURVE);
        expect(below.snapShare).toBeLessThanOrEqual(above.snapShare + 1e-12);
        expect(below.carryShare).toBeLessThanOrEqual(above.carryShare + 1e-12);
        expect(below.targetShare).toBeLessThanOrEqual(above.targetShare + 1e-12);
      }
    }
  });

  it("LEAVES EVERY FITTED MEAN WHERE THE FIT PUT IT, at the middle of its own bucket", () => {
    // The curve interpolates between the measured cells and invents no level of its own. Checked at
    // each bucket's own anchor, which is the only place a bucket mean is claimed to hold exactly.
    for (const [bucket, anchor] of [["round2", 48.5], ["round3", 84.5], ["rounds4to5", 142.5]] as const) {
      const curved = capitalShares("WR", anchor, priors, CURVE);
      expect(curved.targetShare).toBeCloseTo(priors.byBucket.WR[bucket].targetShare, 12);
    }
  });

  it("puts an undrafted man on the undrafted cell rather than anywhere on the curve", () => {
    expect(capitalShares("WR", null, priors, CURVE)).toEqual(priors.byBucket.WR.undrafted);
  });

  it("BLENDS TWO ANCHORS AT THE RATE THE DRAFT-CAPITAL CURVE SAYS CAPITAL DECAYS AT, not at the rate the raw pick number counts up", () => {
    // Task 4: `rookie-curve.ts`'s fitted points curve now underpins this interpolation. Pick 32 sits
    // almost exactly halfway from the round-1 anchor (16.5) to the round-2 one (48.5) IN RAW PICK
    // SPACE, so a naive linear-in-pick blend would land roughly halfway between the two bucket
    // means. The real fitted curve says WR value has already fallen almost the whole way to the
    // round-2 level by pick 32, and the shares interpolation now follows that shape instead.
    const round1 = priors.byBucket.WR.round1.targetShare;
    const round2 = priors.byBucket.WR.round2.targetShare;
    const naiveLinearWeight = (32 - 16.5) / (48.5 - 16.5);
    const naiveLinear = round1 + (round2 - round1) * naiveLinearWeight;
    const curved = capitalShares("WR", 32, priors, CURVE).targetShare;
    expect(curved).not.toBeCloseTo(naiveLinear, 3);
    expect(curved).toBeCloseTo(round2, 10);
  });

  it("FALLS BACK TO THE ORIGINAL LINEAR-IN-PICK BLEND when the curve has no signal for the position", () => {
    // `rookieCurve` returns 0 for K and DEF unconditionally (`rookie-curve.ts` never fits either —
    // neither is ever drafted onto a board this engine projects), so `capitalCurveWeight`'s
    // above/below span is always exactly 0 there and the `!(span > 0)` guard has to take over. K's
    // OWN committed bucket shares are uniformly zero too, which would make the fallback invisible —
    // so this synthesises distinct round1/round2 shares for K to make the weight it actually used
    // observable in the output.
    const kSharePriors = {
      ...priors,
      byBucket: {
        ...priors.byBucket,
        K: {
          ...priors.byBucket.K,
          round1: { snapShare: 0.8, targetShare: 0, carryShare: 0, passAttemptShare: 0 },
          round2: { snapShare: 0.2, targetShare: 0, carryShare: 0, passAttemptShare: 0 },
        },
      },
    };
    const midpointPick = 32.5; // the exact midpoint of the round1 (16.5) and round2 (48.5) anchors
    const linearWeight = (midpointPick - 16.5) / (48.5 - 16.5);
    const expectedLinear = 0.8 + (0.2 - 0.8) * linearWeight;
    expect(capitalShares("K", midpointPick, kSharePriors, CURVE).snapShare).toBeCloseTo(expectedLinear, 10);
  });
});
