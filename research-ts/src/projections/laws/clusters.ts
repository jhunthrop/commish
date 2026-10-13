/**
 * LAW CORRELATION CLUSTERS (fit-round Task 3, deliverable B) — which confirmed laws are, for pricing
 * purposes, RESTATEMENTS OF ONE ANOTHER rather than independent pieces of evidence.
 *
 * THE FINDING THIS ANSWERS. Task 2's report, section 3c-E: the confirmed family grew 4.1x and the
 * number of DISTINCT CLAIMS in it did not. Ninety confirmations span twelve quantities; forty of them
 * touch the touchdown/goal-line cluster (`touchdownPointsShare`, `insideTenTouchShare`,
 * `redZoneTouchShare` — mechanically a restatement of the tribal `td_regression` at a different
 * granularity), thirty-three touch the age/experience cluster (`age` and `experienceYear` at RB are
 * near-restatements of one another, and an AND of the two is close to a tautology). Summing forty
 * correlated goal-line deltas for one player is admitting the same fact forty times; the per-law cap
 * that made sense over a handful of independent laws is a different, much weaker control over forty
 * correlated ones. That is a FIT-CONSUMPTION concern, which is why the answer lives here and in the
 * blend's own grid rather than anywhere near a verdict.
 *
 * WHAT DEFINES A CLUSTER — two rules, in this order, and nothing else:
 *
 *   1. THE QUANTITY IS THE CLUSTER. Every candidate over one quantity — every quantile level, and
 *      the threshold and delta templates alike — is one cluster. `threshold:RB:age:q70`,
 *      `threshold:RB:age:q80` and `threshold:RB:age:q90` are NESTED populations stating one claim at
 *      three distances from the middle, not three claims. This rule is entirely mechanical: the
 *      cluster is the quantity id the candidate's own generated id names.
 *   2. A NAMED FAMILY MERGES SEVERAL QUANTITIES. Two, both from Task 2's redundancy table and from
 *      the mechanism each names: `goal_line` (the three touchdown/goal-line share quantities) and
 *      `age_experience` (age and experience year). `CLUSTER_FAMILY_BY_QUANTITY` below is the whole of
 *      it; every other quantity is its own family by rule 1.
 *
 * POSITION IS DELIBERATELY NOT PART OF THE KEY. Dedup is applied PER PLAYER, and every law that ever
 * fires for a player has already passed `lawReasonsFor`'s own position gate, so within one player's
 * reason list a position-free family key IS a per-position cluster. Leaving position out is what lets
 * a tribal law declared for `"all"` (`td_regression`) share a cluster with the discovered RB goal-line
 * laws that restate it, which is precisely the merge Task 2 asked for.
 *
 * AN AND CANDIDATE JOINS THE FAMILY OF THE CLAUSE ITS OWN ID SPELLS FIRST. `generate.ts`'s `idFor`
 * sorts an AND's two clause ids lexicographically, so "first" is a deterministic, reproducible fact
 * about the id itself. This is a DIFFERENT rule from `primaryQuantityIdOf` (which reads structural
 * order, for a magnitude), and the difference does not matter here: a cluster assignment only has to
 * be deterministic and to put nested restatements together, which the sorted-first rule does — an
 * `age + touchdownPointsShare` AND lands in `age_experience` alongside the plain age law it nests
 * over, and an `insideTenTouchShare + redZoneTouchShare` AND lands in `goal_line` alongside both of
 * its own singles. Single assignment, never membership in two clusters: a law contributes at most one
 * delta, so it can only ever be deduped against one family.
 *
 * ID PARSING RATHER THAN A CANDIDATE LOOKUP, and why that is safe. The runtime cost of resolving a
 * cluster must be a string split, not a regeneration of the 4,165-candidate family, because the blend
 * fit resolves clusters inside its innermost grid loop. The grammar parsed here is exactly
 * `generate.ts`'s own `idFor` output, and `clusters.test.ts` pins the parse against the GENERATOR
 * itself: every candidate `generateCandidates()` produces must resolve to a family drawn from its own
 * `quantityIdsOf(claimParts.clause)`, and none may fall through to the unrecognised-id default. A
 * change to the id grammar therefore fails that test rather than silently un-clustering the family.
 */

/**
 * THE MERGED FAMILIES — a quantity id to the family it belongs to. A quantity ABSENT from this table
 * is its own family (rule 1), which is the common case and deliberately does not need an entry.
 * Keys are `discovery/templates.ts` `QuantityId`s; `clusters.test.ts` pins that.
 */
export const CLUSTER_FAMILY_BY_QUANTITY: Readonly<Record<string, string>> = {
  touchdownPointsShare: "goal_line",
  insideTenTouchShare: "goal_line",
  redZoneTouchShare: "goal_line",
  age: "age_experience",
  experienceYear: "age_experience",
};

/**
 * THE SIX TRIBAL LAWS' OWN FAMILIES. A tribal id carries no quantity grammar to parse, so the six are
 * named here, each mapped to the family of the quantity its own `LAW_CONDITIONS` predicate reads:
 *
 *   - `td_regression` reads touchdown-points share against a positional threshold: `goal_line`, the
 *     family Task 2 records the discovered goal-line laws as restating.
 *   - `rb_age_curve` reads age: `age_experience`.
 *   - `rb_workload_cliff` reads touches, `target_share_persistence` reads the player's own target
 *     share: each joins the discovered family over that same quantity.
 *   - `wr_target_competition` reads his BEST TEAMMATE's target share and `play_caller_fingerprint`
 *     reads the incoming play-caller's prior pass rate over expected — neither is a discovery
 *     quantity a candidate can be generated over, so each is its own singleton family.
 */
export const TRIBAL_CLUSTER_FAMILY: Readonly<Record<string, string>> = {
  td_regression: "goal_line",
  rb_age_curve: "age_experience",
  rb_workload_cliff: "touches",
  target_share_persistence: "targetShare",
  wr_target_competition: "bestTeammateTargetShare",
  play_caller_fingerprint: "incomingCoachPriorPassRateOverExpected",
};

function familyOfQuantity(quantityId: string): string {
  return CLUSTER_FAMILY_BY_QUANTITY[quantityId] ?? quantityId;
}

/** The quantity a single-clause id names: `threshold:<POS>:<quantity>:<level>` and
 *  `delta:<POS>:<quantity>:<level>:<direction>` both carry it in the third field. */
function quantityOfSingleClauseId(id: string): string | null {
  const parts = id.split(":");
  if (parts[0] === "threshold" && parts.length === 4) return parts[2]!;
  if (parts[0] === "delta" && parts.length === 5) return parts[2]!;
  return null;
}

/**
 * THE CLUSTER ONE LAW BELONGS TO — a family key, or the law's own id when the id belongs to neither
 * grammar (an unrecognised law is its own singleton cluster and can never be deduped against
 * anything, which is the conservative direction: it keeps its full delta).
 */
export function clusterKeyFor(lawId: string): string {
  const tribal = TRIBAL_CLUSTER_FAMILY[lawId];
  if (tribal !== undefined) return tribal;

  const single = quantityOfSingleClauseId(lawId);
  if (single !== null) return familyOfQuantity(single);

  // `and:<POS>:<clauseIdA>+<clauseIdB>`, the two clause ids already lexicographically sorted by
  // `idFor`. Everything after the position prefix is the pair, so the split below is on the FIRST
  // two colons only and the halves keep their own colons intact.
  const parts = lawId.split(":");
  if (parts[0] === "and" && parts.length > 2) {
    const [first] = parts.slice(2).join(":").split("+");
    const quantity = first === undefined ? null : quantityOfSingleClauseId(first);
    if (quantity !== null) return familyOfQuantity(quantity);
  }
  return lawId;
}
