import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { MICRO_LABEL } from "@/components/ui/config";
import { ReadingFrame, ReadingSection } from "@/components/app-shell/reading-frame";
import { discoveredPipelineCounts, registry, type PipelineCounts } from "@/projections/laws/registry";
import { generateCandidates } from "@/projections/laws/discovery/generate";
import { quantityIdsOf, type QuantityId } from "@/projections/laws/discovery/templates";
import type { Law, LawMeasurement, LawVerdict } from "@/projections/laws/types";
import { signedPoints } from "@/components/ui/event-feed-row";

/**
 * THE PLAYER-LAWS REFERENCE (Task 9, Sunday v5, 2026-08-31; fix round 1 and 2, same date).
 *
 * `/league-rules`'s own pattern, applied to every claim `registry()` carries: a full-bleed masthead,
 * a measured prose column, chapters with anchors. This page's own subject makes ONE rule
 * non-negotiable that `/league-rules` never had to keep (law 7): every figure below is FORMATTED
 * from a `Law` object read at render time, never typed into this file's own copy — an effect, an
 * interval bound, a sample size or a seasons string that drifted between a re-measure and this page
 * would otherwise go stale silently. `splitClaim`, `measuredFigures` and `verdictElaboration` below
 * are the only places this file turns a `Law` into words, and none of them read a law's `id` to
 * decide what to say — they read only `claim`, `measured` and `verdict`, the same three fields
 * regardless of origin, so a discovered law slots into the identical `LawArticle` a tribal one uses.
 *
 * DEBUNKED AND WEAK TRIBAL LAWS GET EQUAL BILLING (spec Part 3). `play_caller_fingerprint` measured
 * `debunked` and `rb_workload_cliff` measured `weak` are on this page in full, grouped after the
 * confirmed laws but never hidden or hedged into a footnote — the whole point of measuring a folk
 * claim instead of asserting it is publishing what did not hold up, not just what did.
 * `verdictElaboration` says what a `weak` or `debunked` verdict actually means, read straight off
 * that law's own `verdict`, `measured.ci` and `hasFoldEvidence` (an interval that spans zero, an
 * interval that clears zero but a fold disagreed, an interval that clears zero but no fold had
 * evidence, an effect that points the wrong way) rather than inventing a specific story per law,
 * which is exactly the hardcoded-prose-that-goes-stale risk law 7 exists to prevent — see that
 * function's own docblock for the distinct shapes `weak` can take.
 *
 * DISCOVERED LAWS ARE GATED, TRIBAL LAWS ARE NOT (fix round 1, CRITICAL 3). The tribal verdict
 * groups above publish every tribal law regardless of verdict (Part 3's own rule, unchanged). The
 * "Discovered laws" section below is different on purpose: it publishes only `origin: "discovered"`
 * laws that reached `verdict: "confirmed"` — the other BH survivors (weak or debunked after
 * replication) stay in the committed `discovered.json` as the honest record, never hidden, but this
 * page is not the place a reader sees the full survivor list next to the real findings; the
 * pipeline's own top-level accounting (`discoveredPipelineCounts()`) is what tells that fuller
 * story, in ONE methodology sentence per `discoveryMethodologySentence`'s own docblock.
 *
 * ONE CARD PER FINDING, NOT ONE PER CANDIDATE (fix round 2, NESTING RULING). Two or more confirmed
 * discovered laws can be nested or overlapping restatements of the SAME underlying finding — the
 * screen tests every quantile level of every quantity independently, so a real signal on
 * "touchdown-points share" routinely surfaces as several candidates at once (a single-clause law at
 * one quantile level, and AND-pairs that include the same quantity at others). `groupIntoFamilies`
 * collapses these into ONE card per family before rendering — see that function's own docblock for
 * the exact rule — so a reader sees one finding with its own nested variants named plainly, not
 * three or four cards that each look like an independent discovery.
 */
export const metadata: Metadata = pageTitle("Player laws");

/** This page's own path — its `PublicBar`'s sign-in link returns here, the same seam
 *  `/league-rules` uses (Task 16, F6). */
const PAGE_INTENT = "/player-laws";

/** Confirmed first, then weak (not conclusive), then debunked — the spec's own reading order. */
const VERDICT_ORDER: readonly LawVerdict[] = ["confirmed", "weak", "debunked"];

const VERDICT_GROUP_TITLE: Readonly<Record<LawVerdict, string>> = {
  confirmed: "Confirmed",
  weak: "Not conclusive",
  debunked: "Not supported",
};

/** The plain sentence a verdict renders as, word for word what the spec's own examples say. */
function verdictSentence(verdict: LawVerdict): string {
  switch (verdict) {
    case "confirmed":
      return "Confirmed by the data.";
    case "weak":
      return "The data is not conclusive.";
    case "debunked":
      return "Not supported by the data.";
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

/**
 * One more sentence per law, derived mechanically from its own `verdict`, `measured.ci` and
 * `hasFoldEvidence` — never from its `id`, and never assuming today's shape is the only shape a
 * verdict can take.
 *
 * `weak` in particular has THREE distinct paths out of `registry.ts`'s `verdictForFullWindow`:
 * (1) the full-window interval can itself span zero (`verdictFor`'s ordinary "signMatches but not
 * ciExcludesZero" case) — `ciSpansZero` below catches this one first, regardless of folds. OR the
 * full-window interval can already exclude zero — a candidate `verdictFor` alone would call
 * confirmed — and get capped at `weak` for one of two fold-driven reasons: (2) a replication fold
 * disagreed in sign (`hasFoldEvidence: true` — some fold had pairs to check, and at least one of
 * them pointed the other way), or (3) zero folds carried any matched pairs at all
 * (`hasFoldEvidence: false` — nothing existed to check the direction against). Today's one weak
 * tribal law, `rb_workload_cliff`, takes path (1), but a sentence that always said "the interval
 * spans zero" would go silently wrong the day a law takes path (2) or (3) instead, sitting directly
 * above an interval that plainly excludes zero. `ciSpansZero` and `law.hasFoldEvidence` together
 * tell all three paths apart at render time, so the sentence stays true on any of them without
 * this file ever learning about `foldEffects` itself (not part of `Law`'s own public shape —
 * `registry.ts`'s `MeasuredEntry` keeps it internal; `hasFoldEvidence` is the one derived boolean
 * `Law` exposes instead). Identical for a discovered law: `verdictForDiscoveredLaw` only ever
 * TIGHTENS `verdictForFullWindow`'s own rule, never changes what a returned `confirmed` means.
 */
function verdictElaboration(law: Law): string {
  const [low, high] = law.measured.ci;
  const ciSpansZero = (low > 0) !== (high > 0);
  switch (law.verdict) {
    case "confirmed":
      return "The measured effect points in the claimed direction, the 95% interval clears zero, and the same direction held when checked separately on every season used to test it.";
    case "weak":
      if (ciSpansZero) {
        return "The measured effect points in the claimed direction, but the 95% interval spans zero, so it cannot be told apart from no effect at all with the seasons measured so far.";
      }
      return law.hasFoldEvidence
        ? "The full-window 95% interval clears zero in the claimed direction, but at least one season checked separately pointed the other way, so the page does not call this confirmed."
        : "The full-window 95% interval clears zero in the claimed direction, but none of the seasons checked separately had enough matched pairs to test it against, so the page does not call this confirmed.";
    case "debunked":
      return "The measured effect points against the claimed direction, so the popular version of this claim does not hold up under measurement.";
    default: {
      const exhaustive: never = law.verdict;
      return exhaustive;
    }
  }
}

/**
 * Every law's `claim` is written "Title: plain-words description" — a tribal law's title is a
 * hand-authored name (`populations.ts`'s `LAW_ENTRIES`, e.g. "The workload cliff"); a discovered
 * law's title is mechanically built from its position, quantity/quantities' own short labels, AND
 * their real committed threshold values (`discovery/templates.ts`'s `renderTitle`, composed into
 * the claim by that same module's `renderSignedClaim` — see its own docblock for why the two kinds
 * of law can share ONE claim shape). This splits on the first `": "` so the title becomes this
 * section's own heading and the rest stays exactly the sentence a reader already gets in a board's
 * reason chip (`reason-chip.tsx`). A claim with no colon (should not happen; defensive only) renders
 * whole as the heading with an empty body rather than throwing on a content page.
 */
function splitClaim(claim: string): { readonly title: string; readonly body: string } {
  const separator = ": ";
  const index = claim.indexOf(separator);
  if (index === -1) return { title: claim, body: "" };
  const body = claim.slice(index + separator.length);
  // The body was mid-sentence before the split; as standalone prose it opens a sentence.
  return { title: claim.slice(0, index), body: body.charAt(0).toUpperCase() + body.slice(1) };
}

/**
 * The card's own SHORT seasons label — just the window (and any gap-season note), never the full
 * replication-provenance sentence, which can run well past 200 characters for a discovered law and
 * breaks the figure grid's own layout (fix round 2, NEW-4). The committed file keeps the FULL
 * record (`measured.seasons`, untouched by this); this is presentation-only, extracting everything
 * before the first comma — every `seasonsLabel()` (`measure-laws.ts`, `discover-laws.ts`) builds its
 * own string with the window-and-gap-note as that leading, comma-terminated clause, by construction.
 * The out-of-sample caveat itself (2021 sits inside a discovered law's own train window) stays in
 * the discovered section's own methodology sentence, not repeated on every card.
 */
function shortSeasonsLabel(seasons: string): string {
  const commaIndex = seasons.indexOf(",");
  return commaIndex === -1 ? seasons : seasons.slice(0, commaIndex);
}

/** Every measured figure, formatted, never typed — the four values (spec Part 3) a reader needs
 *  to judge a law for themselves: signed effect, the 95% interval, the sample and the seasons. */
function measuredFigures(measured: LawMeasurement): { readonly effect: string; readonly interval: string; readonly sample: string; readonly seasons: string } {
  const [low, high] = measured.ci;
  return {
    effect: `${signedPoints(measured.effect)} pts per game`,
    interval: `${signedPoints(low)} to ${signedPoints(high)} pts per game`,
    sample: `${Math.round(measured.sample)} player-seasons`,
    seasons: shortSeasonsLabel(measured.seasons),
  };
}

/** `registry()`'s own order, split into the three verdict groups in the spec's reading order,
 *  registry order preserved within each group by construction (a `filter` never reorders). Empty
 *  groups (no debunked law today, say) are dropped rather than rendered as a bare heading. */
function groupByVerdict(laws: readonly Law[]): readonly { readonly verdict: LawVerdict; readonly laws: readonly Law[] }[] {
  return VERDICT_ORDER.map((verdict) => ({ verdict, laws: laws.filter((law) => law.verdict === verdict) })).filter(
    (group) => group.laws.length > 0,
  );
}

/** One law, rendered — the ONE place a `Law` becomes an `<article>`, shared by the tribal verdict
 *  groups and the discovered-laws section below rather than duplicated markup for each. */
function LawArticle({ law }: { readonly law: Law }) {
  const { title, body } = splitClaim(law.claim);
  const figures = measuredFigures(law.measured);
  return (
    <article id={law.id} className="flex scroll-mt-6 flex-col gap-2">
      <h3 className="font-display text-lg font-semibold leading-display text-text-primary">{title}</h3>
      {body === "" ? null : <p>{body}</p>}
      <p className="font-medium text-text-primary">{verdictSentence(law.verdict)}</p>
      <p>{verdictElaboration(law)}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-text-muted sm:grid-cols-4">
        <div>
          <dt className={`${MICRO_LABEL} text-text-faint`}>Effect</dt>
          <dd>{figures.effect}</dd>
        </div>
        <div>
          <dt className={`${MICRO_LABEL} text-text-faint`}>95% interval</dt>
          <dd>{figures.interval}</dd>
        </div>
        <div>
          <dt className={`${MICRO_LABEL} text-text-faint`}>Sample</dt>
          <dd>{figures.sample}</dd>
        </div>
        <div>
          <dt className={`${MICRO_LABEL} text-text-faint`}>Seasons</dt>
          <dd>{figures.seasons}</dd>
        </div>
      </dl>
    </article>
  );
}

/**
 * THE DISCOVERED-LAWS SECTION'S ONE METHODOLOGY SENTENCE (fix round 1, CRITICAL 3; reworded fix
 * round 2, NEW-1 and NEW-2), built from `discoveredPipelineCounts()` — never a number typed into
 * this file's own copy, the identical "read it at render time" discipline every other figure on
 * this page keeps. States the whole funnel (candidates -> untestable -> BH survivors -> replicated)
 * AND, per IMPORTANT 1 RULING, that only 2022 and 2023 are genuinely out-of-sample for a discovered
 * law (2021 sits inside the discovery screen's own training window — see `discovery/measure.ts`'s
 * docblock, step 4, and `registry.ts`'s `verdictForDiscoveredLaw` for where that distinction changes
 * a verdict).
 *
 * TWO WORDING FIXES, FIX ROUND 2: (NEW-1) "untestable" no longer claims those candidates matched
 * zero pairs — most of them DID match, just fewer than `MIN_TRAIN_PAIRS`, and the old wording was
 * false for the large majority of that count. (NEW-2) the stray "candidates above" — there is no
 * candidate LISTING above this sentence for "above" to refer to — is gone; this sentence describes
 * the whole 2,487-candidate family the page never lists in full, not something rendered nearby.
 */
function discoveryMethodologySentence(counts: PipelineCounts): string {
  return (
    `Every discovered candidate is measured the same way: matched to a similar player-season, screened for a false-discovery ` +
    `rate of at most 10% across the whole ${counts.candidates}-candidate family, then required to replicate on seasons the ` +
    `screen never trained on. ${counts.untestable} could not be matched on enough training seasons (fewer than 20 matched ` +
    `pairs) and were excluded rather than scored; ${counts.bhSurvivors} survived the false-discovery screen; ` +
    `${counts.replicated} of those also replicated on 2022 or 2023, the two seasons genuinely outside the screen's own ` +
    `training window (2021 sits inside it). Only the ${counts.replicated} finding${counts.replicated === 1 ? "" : "s"} below ` +
    `cleared every bar; the rest of the survivors are recorded, with their own non-confirmed verdict, in the committed ` +
    `discovery file.`
  );
}

/**
 * WHAT A CONFIRMED LAW ACTUALLY DOES, DERIVED MECHANICALLY, ORIGIN-AWARE (fix round 1, CRITICAL 3 —
 * this sentence used to read `laws` as one undifferentiated list; now that `registry()` merges
 * discovered laws in too, that would either mislabel a discovered law's own board absence as "not
 * wired to the model" — a narrower, misleading claim, since a discovered law does not even reach a
 * board's reason chip yet, model wiring or not — or silently count it toward a "confirmed" total the
 * tribal sentence's own numbers were never written to include).
 *
 * TRIBAL: unchanged from the original (fix round 1, I7) — only a confirmed TRIBAL law with a wired
 * `modelPath` (`populations.ts`'s own docblock: "null means the law is content only, no model
 * wiring") actually feeds the fitted ranking model a board reads. EVERY confirmed tribal law still
 * shows up as a reason chip beside a player's name (`board-reasons.ts`'s `lawReasonsFor` gates on
 * `verdict === "confirmed"` AND `origin === "tribal"`), so "every confirmed law feeds the board's own
 * rankings" was true only by coincidence, for exactly as long as every confirmed law happened to also
 * be wired.
 *
 * DISCOVERED: a confirmed discovered law does not show up as a reason chip and does not feed the
 * model — `lawReasonsFor` skips every non-tribal law (see that function's own docblock), and
 * `modelPath` is `null` for every discovered law today (`registry.ts`'s `discoveredLawsFrom`). This
 * function says so explicitly, in one added sentence, rather than letting the tribal sentence's own
 * numbers silently undercount by ignoring the discovered ones.
 */
function boardConsequenceSentence(laws: readonly Law[]): string {
  const tribalConfirmed = laws.filter((law) => law.origin === "tribal" && law.verdict === "confirmed");
  const wired = tribalConfirmed.filter((law) => law.modelPath !== null);
  const discoveredConfirmed = laws.filter((law) => law.origin === "discovered" && law.verdict === "confirmed");
  const chipSentence = "A reason chip beside a player's name states a confirmed law's measured effect the same way this page does.";

  const tribalSentence = (() => {
    if (tribalConfirmed.length === 0) return chipSentence;
    if (wired.length === tribalConfirmed.length) {
      return `Every confirmed law here feeds the board's own rankings, and ${chipSentence.charAt(0).toLowerCase()}${chipSentence.slice(1)}`;
    }
    if (wired.length === 0) {
      return `None of the confirmed laws here are wired into the board's rankings yet. ${chipSentence}`;
    }
    return `${wired.length} of ${tribalConfirmed.length} confirmed laws here feed the board's own rankings. ${chipSentence}`;
  })();

  if (discoveredConfirmed.length === 0) return tribalSentence;
  const plural = discoveredConfirmed.length === 1 ? "law does" : "laws do";
  return `${tribalSentence} The ${discoveredConfirmed.length} confirmed discovered ${plural} not show up as a reason chip or feed the board's rankings yet.`;
}

// ---------------------------------------------------------------------------------------------
// NESTING RULING (fix round 2) — one card per finding family, never one per surviving candidate.
// ---------------------------------------------------------------------------------------------

/** Every real candidate's own quantity set + position, keyed by id — built ONCE per render from the
 *  pure, no-DB `generateCandidates()` (never re-parsing `Law.id` as a string; the id already names a
 *  real candidate, `discoveredLawsFrom`'s own orphan guard already checked that at merge time). */
function candidateInfoById(): ReadonlyMap<string, { readonly quantityIds: ReadonlySet<QuantityId>; readonly position: string }> {
  const out = new Map<string, { quantityIds: ReadonlySet<QuantityId>; position: string }>();
  for (const candidate of generateCandidates()) {
    out.set(candidate.id, { quantityIds: quantityIdsOf(candidate.claimParts.clause), position: candidate.position });
  }
  return out;
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function isStrictSubset<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size >= b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

interface DiscoveredFamily {
  readonly representative: Law;
  readonly nested: readonly Law[];
}

/**
 * NESTING RULING (fix round 2, adopting the reviewer's stronger fix): confirmed discovered laws
 * drawn from the SAME POSITION, sharing an identical quantity set (ignoring thresholds) OR one
 * nested inside the other via STRICT CONTAINMENT, collapse into ONE page card — the representative
 * is the member with the LARGEST full-window sample, and every other member of the family is listed
 * on that card as a nested variant (`DiscoveredFamilyArticle`, below).
 *
 * POSITION IS A REQUIRED, ADDED CONDITION beyond the ruling's own literal wording: a WR
 * touchdown-points-share law and an RB touchdown-points-share law share a quantity NAME but are
 * drawn from entirely different populations — collapsing them would misrepresent two distinct
 * findings as one, the same reason `stratumKeyFor` (`registry.ts`) never lets a match cross a
 * position boundary either.
 *
 * Implemented as union-find over `laws`' own indices: two laws are connected when `related` holds;
 * the resulting connected components are each family. Ties in sample size (should not happen with
 * real floating-point data) break on id, so the grouping is fully deterministic regardless of
 * `laws`' own input order.
 */
function groupIntoFamilies(laws: readonly Law[]): readonly DiscoveredFamily[] {
  const info = candidateInfoById();
  const infoFor = (law: Law): { readonly quantityIds: ReadonlySet<QuantityId>; readonly position: string } => {
    const found = info.get(law.id);
    if (found === undefined) {
      throw new Error(`groupIntoFamilies: "${law.id}" has no matching candidate in generateCandidates() — a discovered law and the generator have drifted.`);
    }
    return found;
  };

  const n = laws.length;
  const parent = Array.from({ length: n }, (_unused, index) => index);
  function find(index: number): number {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    parent[index] = root;
    return root;
  }
  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = infoFor(laws[i]!);
      const b = infoFor(laws[j]!);
      if (a.position !== b.position) continue;
      const related = setsEqual(a.quantityIds, b.quantityIds) || isStrictSubset(a.quantityIds, b.quantityIds) || isStrictSubset(b.quantityIds, a.quantityIds);
      if (related) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  const families: DiscoveredFamily[] = [...groups.values()].map((indices) => {
    const sorted = [...indices].sort((x, y) => {
      const sampleDiff = laws[y]!.measured.sample - laws[x]!.measured.sample; // largest sample first
      if (sampleDiff !== 0) return sampleDiff;
      return laws[x]!.id < laws[y]!.id ? -1 : 1; // deterministic tie-break
    });
    const [repIndex, ...restIndices] = sorted;
    return { representative: laws[repIndex!]!, nested: restIndices.map((idx) => laws[idx]!) };
  });

  return families.sort((a, b) => (a.representative.id < b.representative.id ? -1 : 1));
}

/**
 * MECHANICAL TRIBAL OVERLAP TABLE (fix round 2, NESTING RULING) — every tribal law whose own
 * antecedent is structurally a single named discovery quantity's threshold, keyed by that quantity,
 * naming which of ITS OWN positions the tribal law's population is drawn from. A discovered family
 * whose own quantity set includes one of these AND whose own position is among the tribal law's own
 * positions gets ONE plain overlap sentence (`overlapNoteFor`) — the same underlying quantity, a
 * different framing (a hand-picked cliff vs. a fitted quantile), both independently measured. Object-
 * derived, not a single hardcoded id check: a future confirmed discovered law on `touches` (RB) or
 * `age` (RB) or `targetShare` (WR) gets the identical treatment with no new code, only whatever
 * `overlapNoteFor` finds when it looks a family's own quantities up here.
 *
 * HAND-MAINTAINED, WITH A SILENT FAILURE MODE (fix round 2 concern, copied in here fix round 3): this
 * table is not generated from `LAW_SPECS` and nothing forces it to stay in sync the way
 * `discoveredLawsFrom`'s own orphan guard forces `discovered.json` to stay in sync with
 * `generateCandidates()`. A future tribal law added without a matching entry here simply produces no
 * overlap note — silently, never a drift error. That is the right failure mode for what this table
 * is (a soft editorial nicety, one plain sentence, never a correctness guarantee a reader depends
 * on), but it is worth naming here rather than only in this task's own report: nobody adding a
 * seventh tribal law should expect this table to complain if they forget it.
 */
const TRIBAL_QUANTITY_OVERLAP: ReadonlyMap<QuantityId, { readonly tribalLawId: string; readonly positions: readonly string[] }> = new Map([
  ["touches", { tribalLawId: "rb_workload_cliff", positions: ["RB"] }],
  ["age", { tribalLawId: "rb_age_curve", positions: ["RB"] }],
  ["touchdownPointsShare", { tribalLawId: "td_regression", positions: ["QB", "RB", "WR", "TE"] }],
  ["targetShare", { tribalLawId: "target_share_persistence", positions: ["WR"] }],
]);

function overlapNoteFor(family: DiscoveredFamily, tribalLaws: readonly Law[], info: ReadonlyMap<string, { readonly quantityIds: ReadonlySet<QuantityId>; readonly position: string }>): string | null {
  const members = [family.representative, ...family.nested];
  const quantityIds = new Set<QuantityId>();
  let position: string | null = null;
  for (const member of members) {
    const found = info.get(member.id);
    if (found === undefined) continue;
    position = found.position;
    for (const quantityId of found.quantityIds) quantityIds.add(quantityId);
  }
  if (position === null) return null;

  for (const quantityId of quantityIds) {
    const overlap = TRIBAL_QUANTITY_OVERLAP.get(quantityId);
    if (overlap === undefined || !overlap.positions.includes(position)) continue;
    const tribalLaw = tribalLaws.find((law) => law.id === overlap.tribalLawId);
    if (tribalLaw === undefined) continue;
    const { title: tribalTitle } = splitClaim(tribalLaw.claim);
    return `This finding shares its own quantity with the tribal law "${tribalTitle}": the same underlying measurement, framed and tested independently.`;
  }
  return null;
}

/** One finding family, rendered: the representative's own `LawArticle`, plus a plain-text line
 *  naming every nested variant's own threshold/effect/sample (NESTING RULING: "the representative's
 *  card lists the nested variants in one plain line"), plus a mechanical tribal-overlap note when
 *  one applies. */
function DiscoveredFamilyArticle({ family, overlapNote }: { readonly family: DiscoveredFamily; readonly overlapNote: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      <LawArticle law={family.representative} />
      {family.nested.length === 0 ? null : (
        <p className="text-sm text-text-muted">
          Also holds, at a different threshold:{" "}
          {family.nested
            .map((law) => {
              const { title } = splitClaim(law.claim);
              const figures = measuredFigures(law.measured);
              return `${title} (effect ${figures.effect}, ${figures.sample})`;
            })
            .join("; ")}
          .
        </p>
      )}
      {overlapNote === null ? null : <p className="text-sm text-text-muted">{overlapNote}</p>}
    </div>
  );
}

export default async function PlayerLawsPage() {
  const user = await getCurrentUser();
  const laws = registry();
  const tribalLaws = laws.filter((law) => law.origin === "tribal");
  const confirmedDiscovered = laws.filter((law) => law.origin === "discovered" && law.verdict === "confirmed");
  const groups = groupByVerdict(tribalLaws);
  const discoveredCounts = discoveredPipelineCounts();
  const families = groupIntoFamilies(confirmedDiscovered);
  const candidateInfo = candidateInfoById();
  const totalClaims = tribalLaws.length + confirmedDiscovered.length;

  return (
    <ReadingFrame
      title="Player laws"
      kicker="Reference"
      lede={`${totalClaims} claims about fantasy production, tested against what actually happened rather than assumed true.`}
      intent={PAGE_INTENT}
      signedIn={user !== null}
    >
      <ReadingSection id="how-measured" title="How these are measured">
        <p>
          Every law here is graded the same way: find every player-season that fits its claim, match
          each one to an otherwise similar player-season that does not, and compare what actually
          happened the following season. A law only counts as confirmed when that difference also
          holds up separately on each of several seasons checked one at a time, not only when every
          season is pooled together.
        </p>
        <p>
          The tribal laws below started as pieces of fantasy football folklore, one antecedent
          hand-picked and tested on its own. The discovered laws further down started differently:
          {" "}{discoveredCounts.candidates} candidates, generated mechanically by crossing every
          tracked quantity against every quantile level, screened by the identical matched-baseline
          method described above.
        </p>
      </ReadingSection>

      {groups.map((group) => (
        <ReadingSection key={group.verdict} id={group.verdict} title={VERDICT_GROUP_TITLE[group.verdict]}>
          <div className="flex flex-col gap-6">
            {group.laws.map((law) => (
              <LawArticle key={law.id} law={law} />
            ))}
          </div>
        </ReadingSection>
      ))}

      <ReadingSection id="discovered" title="Discovered laws">
        <p>{discoveryMethodologySentence(discoveredCounts)}</p>
        {families.length === 0 ? (
          <p>
            No discovered candidate has replicated yet. The pipeline&apos;s own full record, including every
            survivor that did not, is committed alongside this page&apos;s own source.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {families.map((family) => (
              <DiscoveredFamilyArticle key={family.representative.id} family={family} overlapNote={overlapNoteFor(family, tribalLaws, candidateInfo)} />
            ))}
          </div>
        )}
      </ReadingSection>

      <ReadingSection id="see-it-live" title="Where these show up">
        <p>{boardConsequenceSentence(laws)}</p>
        <p>
          <Link href="/browse" className="font-medium text-accent underline">
            See who is drafting soon
          </Link>
          .
        </p>
      </ReadingSection>
    </ReadingFrame>
  );
}
