import type { Position } from "@/domain/player";
import type { BoardReason } from "../preseason/board";
import type { DiscoveryFacts } from "./discovery-facts";
import { generateCandidates, type CandidateLaw } from "./discovery/generate";
import { primaryQuantityDefOf } from "./discovery/templates";
import { LAW_CONDITIONS, LAW_ELIGIBILITY, type LawConditionFacts } from "./populations";
import type { Law } from "./types";

/**
 * MAGNITUDE, PER TRIBAL LAW — the player's OWN value of the exact quantity his condition (`LAW_CONDITIONS`,
 * `populations.ts`) reads, so a "law" reason says not just "this law applies to him" but "by how
 * much." Every case here mirrors the matching `*Condition` predicate's own fields, so a magnitude can
 * never name a quantity its condition did not check:
 *
 *   - `rb_workload_cliff`: his own touches (carries + receptions), season N — the workload the
 *     cliff claim is about.
 *   - `rb_age_curve`: his own age at season N's opener.
 *   - `wr_target_competition`: his BEST teammate's own season-N target share — the competing claim
 *     on the room, not his own share.
 *   - `target_share_persistence`: his OWN season-N target share — the share the claim says persists.
 *   - `td_regression`: his season-N touchdown-points share divided by his position's season-N
 *     threshold for it (1.5x the position median, `populations.ts`'s `tdShareThresholds`) — how far
 *     over the regression line he sits, rather than the raw share alone, since the threshold itself
 *     moves by position and by season. A zero threshold (never seen in real data, possible in a
 *     fixture) falls back to the raw share rather than dividing by zero.
 *   - `play_caller_fingerprint`: the incoming play-caller's own prior pass-rate-over-expected. Not
 *     among today's confirmed laws, but a total mapping keeps `lawReasonsFor` from needing a special
 *     case the day the registry confirms a seventh law.
 *
 * Returns `null` for a law id this function has no case for, or when the specific fact its case
 * reads is itself unknown — the same tri-state discipline every `LawConditionFacts` field keeps.
 * `lawReasonsFor` treats either as "this law's condition passed but its magnitude cannot be read,"
 * which should never happen for a law whose condition it just confirmed true (every case above reads
 * the identical field(s) its condition predicate already required to be non-null) — see its own
 * docblock for why that combination throws rather than drops.
 *
 * TRIBAL ONLY — see `magnitudeForDiscoveredLaw`, below, for a discovered law's own (template-driven,
 * never hand-listed) magnitude rule.
 */
export function magnitudeForLaw(lawId: string, facts: LawConditionFacts): number | null {
  switch (lawId) {
    case "rb_workload_cliff":
      return facts.touches;
    case "rb_age_curve":
      return facts.age;
    case "wr_target_competition":
      return facts.bestTeammateTargetShare;
    case "target_share_persistence":
      return facts.targetShare;
    case "td_regression": {
      const { touchdownPointsShare, touchdownPointsShareThreshold } = facts;
      if (touchdownPointsShare === null || touchdownPointsShareThreshold === null) return null;
      return touchdownPointsShareThreshold > 0 ? touchdownPointsShare / touchdownPointsShareThreshold : touchdownPointsShare;
    }
    case "play_caller_fingerprint":
      return facts.incomingCoachPriorPassRateOverExpected;
    default:
      return null;
  }
}

/**
 * MAGNITUDE, PER DISCOVERED LAW'S TEMPLATE (Task 8) — the ONE mechanical rule every discovered
 * candidate's magnitude follows, regardless of which of the ~1,737 candidates it is or which
 * discovery round produced it. Never a per-id case list like `magnitudeForLaw`'s tribal one: a
 * discovered law's id changes between rounds (a re-run of `npm run laws:discover` can confirm a
 * different subset), so a hand-entry keyed by id could never stay in sync.
 *
 *   - THRESHOLD or DELTA (a single clause): the player's own CURRENT-season value of the ONE
 *     quantity the clause reads (`facts.current`) — the exact quantity `candidate.condition`
 *     compared against the fitted threshold, so the reason says not just "this pattern applies" but
 *     "by how much."
 *   - AND: the PRIMARY quantity's value — `discovery/templates.ts`'s `primaryQuantityIdOf`, defined
 *     as the left (structurally first) clause's own quantity. `generate.ts`'s own AND-pairing rule
 *     only ever builds an AND out of two THRESHOLD singles on distinct quantities, so this is
 *     well-defined for every AND this generator can produce.
 *
 * `null` when the primary quantity's own current-season value is itself unknown for this player —
 * the same tri-state discipline `magnitudeForLaw` keeps for a tribal law's fact.
 */
export function magnitudeForDiscoveredLaw(candidate: CandidateLaw, facts: DiscoveryFacts): number | null {
  return primaryQuantityDefOf(candidate.claimParts.clause).get(facts.current);
}

/**
 * EVERY DISCOVERED CANDIDATE, INDEXED BY ID — built ONCE, at module load, from the real
 * `generateCandidates()` (pure, no DB, no filesystem — see that function's own docblock), so
 * `lawReasonsFor` can match a `discovered.json`-sourced `Law.id` back to the `CandidateLaw` whose
 * `condition` and `claimParts` it needs, without regenerating the ~1,737-candidate family on every
 * call this function makes (once per player, per board). Passed as a DEFAULT PARAMETER on
 * `lawReasonsFor` itself, never hardcoded inside it, so `board-reasons.test.ts` can drive the
 * function with a small hand-built map instead of the real one — the identical `candidateIds`-as-
 * parameter discipline `registry.ts`'s own `discoveredLawsFrom` uses for the same reason.
 */
const DISCOVERED_CANDIDATES_BY_ID: ReadonlyMap<string, CandidateLaw> = new Map(
  generateCandidates().map((candidate) => [candidate.id, candidate] as const),
);

/**
 * THE ONE PLACE A CANDIDATE'S FACTS BECOME "law" BOARD REASONS (Task 8, 2026-08-31 — supersedes
 * Task 7's own narrower patch, which skipped every discovered law here regardless of verdict because
 * this wiring did not exist yet) — every CONFIRMED law (`registry.ts`: only a confirmed law's
 * evidence is strong enough to speak on the board) whose condition is TRUE for him, in `laws` order,
 * TRIBAL OR DISCOVERED ALIKE:
 *
 *   - TRIBAL: `LAW_CONDITIONS` (`populations.ts`) holds the exact predicate the tribal harness
 *     measured the law's own effect with, over `LawConditionFacts`.
 *   - DISCOVERED: a `discovery/generate.ts` candidate's own `condition(DiscoveryFacts)` predicate,
 *     matched to the law's id through `DISCOVERED_CANDIDATES_BY_ID` above. That id is the SAME one
 *     `discoveredLawsFrom`'s own orphan guard (`registry.ts`) already checked exists in
 *     `generateCandidates()` before this law could ever appear in `registry()`'s output, so the
 *     lookup below is guaranteed to resolve for any REAL discovered law reaching this function
 *     through the normal `registry()` -> `chipEligibleLaws`/`loadPreseason` path. The throw below
 *     exists for the same "drift would otherwise fail silently several calls deep" reason
 *     `LAW_CONDITIONS.get` failing already throws for a tribal law.
 *
 * A `weak` or `debunked` law, or a confirmed law whose condition is `false` or unknown (`null` — no
 * evidence, never treated as false), contributes nothing: this is a filter over the registry's own
 * verdicts, never a synthesis of a new one.
 *
 * THE POSITION GATE (C1, Task 4 fix round — a real defect this function shipped WITHOUT for every
 * board this engine has ever built until now). `position` is the CANDIDATE's own position — the
 * player this reason list is being built for — and BOTH arms below now check it before a law's
 * condition is ever evaluated:
 *
 *   - TRIBAL: `LAW_ELIGIBILITY.get(law.id)(position)` — `populations.ts`'s own docblock states the
 *     symmetry this fixes: `buildPopulations` gates the exact same law's MEASUREMENT population with
 *     `law.eligible(position)` at its own call site (`if (!law.eligible(position)) continue;`), and
 *     until this fix `lawReasonsFor` gated nothing — `rb_age_curve`'s effect, fitted ONLY over RBs,
 *     reached a wide receiver's board row the instant his own age cleared the same numeric field,
 *     because `LawConditionFacts` carries identically-named fields for every position and a
 *     condition predicate cannot see who it was measured on. MEASURED-ON = APPLIED-TO is now one
 *     predicate, reused rather than re-approximated.
 *   - DISCOVERED: `candidate.position === "all" || candidate.position === position` — a discovered
 *     candidate is generated FOR one concrete position (`discovery/generate.ts`'s own per-position
 *     candidate construction; `"all"` is allowed by the type but not produced in practice today) and
 *     must never speak for a different one, for the identical reason.
 *
 * `facts` and `discoveryFacts` are INDEPENDENTLY NULLABLE, because they are read from two DIFFERENT
 * per-season populations (`populations.ts`'s `factsForSeason` vs. `discovery-facts.ts`'s
 * `discoveryFactsForSeason`) that overlap heavily in practice — both are built over the same
 * `seasonContext` — but are never guaranteed to for every player. A player present in one and absent
 * from the other still gets reasons from whichever origin has evidence for him; `null` for a fact
 * skips every law of that origin; both `null` (or `laws` empty) produces `[]`.
 *
 * CONTAINMENT (C2 RULING, carried through from Task 7's tribal wiring, now stated for discovery
 * too): the caller (`preseason/source.ts`'s `loadPreseason`) reads BOTH `factsForSeason` and
 * `discoveryFactsForSeason` with `admitDerived: false` on EVERY REPLAY board and on a LIVE board's
 * prior season UNLESS that season is one of the narrow, explicitly named exceptions
 * `LIVE_ADMITTED_DERIVED_SEASONS` allows (Task 4 main round, `admitsDerivedPriorSeason`) — so a
 * pbp-derived gap-season stat line (e.g. 2019) never reaches a live board's law reasons through
 * EITHER origin outside that named allowlist. `admitDerived: true` unconditionally stays scoped to
 * the tribal/discovery HARNESSES' own measurement (`buildPopulations`, `discovery/measure.ts`),
 * which is exactly where it belongs.
 *
 * `laws` and `candidates` are PARAMETERS rather than calls to `registry()`/`generateCandidates()`
 * inside here, so this stays the pure, DB-free, disk-free core every caller — a live board via
 * `laws/board-reasons.ts`'s only export, and a test with hand-built fixtures of both — can drive
 * identically.
 */
export function lawReasonsFor(
  position: Position,
  facts: LawConditionFacts | null,
  discoveryFacts: DiscoveryFacts | null,
  laws: readonly Law[],
  candidates: ReadonlyMap<string, CandidateLaw> = DISCOVERED_CANDIDATES_BY_ID,
): readonly BoardReason[] {
  const reasons: BoardReason[] = [];
  for (const law of laws) {
    if (law.verdict !== "confirmed") continue;

    if (law.origin === "tribal") {
      if (facts === null) continue;
      const condition = LAW_CONDITIONS.get(law.id);
      if (condition === undefined) {
        throw new Error(`lawReasonsFor: "${law.id}" has no condition predicate in LAW_CONDITIONS — a law and populations.ts have drifted.`);
      }
      // C1 — THE POSITION GATE, tribal arm: `LAW_ELIGIBILITY` is built from the IDENTICAL
      // `LAW_ENTRIES` `LAW_CONDITIONS` is, so a defined `condition` above should guarantee a
      // defined `eligible`; the throw below still guards the invariant against future drift.
      const eligible = LAW_ELIGIBILITY.get(law.id);
      if (eligible === undefined) {
        throw new Error(`lawReasonsFor: "${law.id}" has no eligibility predicate in LAW_ELIGIBILITY — a law and populations.ts have drifted.`);
      }
      if (!eligible(position)) continue;
      if (condition(facts) !== true) continue;
      const magnitude = magnitudeForLaw(law.id, facts);
      if (magnitude === null) {
        throw new Error(
          `lawReasonsFor: "${law.id}"'s condition is true but magnitudeForLaw returned null — its magnitude case reads a fact its condition does not guarantee.`,
        );
      }
      reasons.push({ code: "law", lawId: law.id, effect: law.measured.effect, magnitude });
      continue;
    }

    if (discoveryFacts === null) continue;
    const candidate = candidates.get(law.id);
    if (candidate === undefined) {
      throw new Error(
        `lawReasonsFor: "${law.id}" (discovered) has no matching candidate in generateCandidates() — the registry and the candidate generator have drifted.`,
      );
    }
    // C1 — THE POSITION GATE, discovered arm: a candidate speaks for ONE concrete position (or,
    // per the type, "all" — not produced by generateCandidates() today, allowed anyway rather than
    // narrowing the type here). Gated BEFORE the consistency guard below: a candidate that is not
    // even about this player's position has nothing to be consistent about for him.
    if (candidate.position !== "all" && candidate.position !== position) continue;
    // CONSISTENCY GUARD (Task 8 fix round) — `law.primaryQuantityId` was written, once, at discovery
    // time (`discovery/measure.ts`, from this SAME `primaryQuantityDefOf` rule). Recomputing it here
    // and asserting the two agree catches the one drift a stale `discovered.json` could otherwise
    // pass silently to a CLIENT (`ReasonChip`, which reads the persisted field and never recomputes
    // it — see that component's own docblock for why): a hand-edited entry, or a
    // `discovery/templates.ts` change (e.g. the AND-pairing rule's own "which half is left" logic)
    // that moved a candidate's primary quantity without a fresh `npm run laws:discover` run.
    const primaryDef = primaryQuantityDefOf(candidate.claimParts.clause);
    if (law.primaryQuantityId !== primaryDef.id) {
      throw new Error(
        `lawReasonsFor: "${law.id}"'s persisted primaryQuantityId ("${String(law.primaryQuantityId)}") disagrees with the live template's own primary quantity ("${primaryDef.id}") — discovered.json and discovery/templates.ts have drifted. Re-run \`npm run laws:discover\`.`,
      );
    }
    if (candidate.condition(discoveryFacts) !== true) continue;
    const magnitude = magnitudeForDiscoveredLaw(candidate, discoveryFacts);
    if (magnitude === null) {
      throw new Error(
        `lawReasonsFor: "${law.id}"'s condition is true but magnitudeForDiscoveredLaw returned null — its primary quantity's own current-season value is unknown despite the condition being true.`,
      );
    }
    reasons.push({ code: "law", lawId: law.id, effect: law.measured.effect, magnitude });
  }
  return reasons;
}
