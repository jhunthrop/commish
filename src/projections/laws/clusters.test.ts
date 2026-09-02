import { describe, expect, it } from "vitest";
import { generateCandidates } from "./discovery/generate";
import { quantityIdsOf } from "./discovery/templates";
import { CLUSTER_FAMILY_BY_QUANTITY, clusterKeyFor, TRIBAL_CLUSTER_FAMILY } from "./clusters";
import { LAW_SPECS } from "./populations";

describe("clusterKeyFor — nested levels on one quantity are ONE cluster", () => {
  it("puts every level of one quantity in the same cluster, threshold and delta alike", () => {
    const keys = new Set([
      clusterKeyFor("threshold:RB:draftPick:q70"),
      clusterKeyFor("threshold:RB:draftPick:q80"),
      clusterKeyFor("threshold:RB:draftPick:q90"),
      clusterKeyFor("delta:RB:draftPick:q70:rose_into"),
    ]);
    expect(keys.size).toBe(1);
  });

  it("keeps two DIFFERENT quantities in different clusters", () => {
    expect(clusterKeyFor("threshold:RB:draftPick:q70")).not.toBe(clusterKeyFor("threshold:RB:targetShare:q70"));
  });

  it("is position-free: the same quantity at two positions is one key, because dedup is per player", () => {
    expect(clusterKeyFor("threshold:RB:draftPick:q70")).toBe(clusterKeyFor("threshold:WR:draftPick:q70"));
  });
});

describe("clusterKeyFor — the two correlated families Task 2 named", () => {
  it("folds the whole touchdown/goal-line family into one cluster", () => {
    const keys = new Set([
      clusterKeyFor("threshold:RB:touchdownPointsShare:q70"),
      clusterKeyFor("threshold:RB:insideTenTouchShare:q80"),
      clusterKeyFor("threshold:RB:redZoneTouchShare:q90"),
      clusterKeyFor("td_regression"),
    ]);
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("goal_line");
  });

  it("folds age and experience into one cluster, the tribal age law included", () => {
    const keys = new Set([
      clusterKeyFor("threshold:RB:age:q70"),
      clusterKeyFor("threshold:RB:experienceYear:q80"),
      clusterKeyFor("rb_age_curve"),
    ]);
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("age_experience");
  });
});

describe("clusterKeyFor — AND candidates", () => {
  it("assigns an AND to the family of the clause its own id spells FIRST", () => {
    // `age` sorts before `touchdownPointsShare`, so this AND joins the age/experience cluster.
    expect(clusterKeyFor("and:RB:threshold:RB:age:q70+threshold:RB:touchdownPointsShare:q70")).toBe("age_experience");
    // `insideTenTouchShare` sorts before `redZoneTouchShare`; both are goal-line either way.
    expect(clusterKeyFor("and:RB:threshold:RB:insideTenTouchShare:q80+threshold:RB:redZoneTouchShare:q80")).toBe("goal_line");
  });

  it("puts an AND in the SAME cluster as the single law it nests over", () => {
    expect(clusterKeyFor("and:RB:threshold:RB:age:q70+threshold:RB:experienceYear:q70")).toBe(clusterKeyFor("threshold:RB:age:q70"));
  });
});

describe("clusterKeyFor — the whole generated family, checked against the generator itself", () => {
  const candidates = generateCandidates();

  it("assigns every generated candidate a family drawn from one of ITS OWN quantities", () => {
    const familyOf = (quantityId: string): string => CLUSTER_FAMILY_BY_QUANTITY[quantityId] ?? quantityId;
    for (const candidate of candidates) {
      const own = new Set([...quantityIdsOf(candidate.claimParts.clause)].map(familyOf));
      expect(own.has(clusterKeyFor(candidate.id)), `${candidate.id} -> ${clusterKeyFor(candidate.id)}`).toBe(true);
    }
  });

  it("never falls back to the whole id for a generated candidate — every id parses", () => {
    for (const candidate of candidates) {
      expect(clusterKeyFor(candidate.id), candidate.id).not.toBe(candidate.id);
    }
  });
});

describe("TRIBAL_CLUSTER_FAMILY", () => {
  it("names every tribal law, so a tribal law never silently becomes its own singleton", () => {
    for (const spec of LAW_SPECS) {
      expect(Object.keys(TRIBAL_CLUSTER_FAMILY)).toContain(spec.id);
    }
  });
});

describe("clusterKeyFor — an id from neither grammar", () => {
  it("falls back to the id itself: an unrecognised law is its own singleton cluster, never merged", () => {
    expect(clusterKeyFor("something_nobody_generated")).toBe("something_nobody_generated");
  });
});
