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
    // Six cells hand a whole round one number: the fourth pick and the thirtieth are both "round 1"
    // and a bucket table cannot tell them apart. That is the defect the curve exists for.
    const share = (pick: number, features: RookieFeatures): number =>
      capitalShares("RB", pick, priors, features).carryShare;
    expect(share(4, BUCKETS)).toBe(share(30, BUCKETS));
    expect(share(4, CURVE)).toBeGreaterThan(share(30, CURVE));
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
});
