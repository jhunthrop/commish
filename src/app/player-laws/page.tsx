import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { MICRO_LABEL } from "@/components/ui/config";
import { ReadingFrame, ReadingSection } from "@/components/app-shell/reading-frame";
import { discoveredPipelineCounts, registry, type PipelineCounts } from "@/projections/laws/registry";
import type { Law, LawMeasurement, LawVerdict } from "@/projections/laws/types";
import { signedPoints } from "@/components/ui/event-feed-row";

/**
 * THE PLAYER-LAWS REFERENCE (Task 9, Sunday v5, 2026-08-31; fix round 1, same date).
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
 * DISCOVERED LAWS ARE GATED, TRIBAL LAWS ARE NOT (fix round, CRITICAL 3). The tribal verdict groups
 * above publish every tribal law regardless of verdict (Part 3's own rule, unchanged). The
 * "Discovered laws" section below is different on purpose: it publishes only `origin: "discovered"`
 * laws that reached `verdict: "confirmed"` — the other BH survivors (weak or debunked after
 * replication) stay in the committed `discovered.json` as the honest record, never hidden, but this
 * page is not the place a reader sees 37 near-misses next to 13 real findings; the pipeline's own
 * top-level accounting (`discoveredPipelineCounts()`) is what tells that fuller story, in ONE
 * methodology sentence per `discoveryMethodologySentence`'s own docblock.
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
 * law's title is mechanically built from its position and quantity/quantities' own short labels
 * (`discovery/templates.ts`'s `renderTitle`, composed into the claim by that same module's
 * `renderSignedClaim` — see its own docblock for why the two kinds of law can share ONE claim shape).
 * This splits on the first `": "` so the title becomes this section's own heading and the rest
 * stays exactly the sentence a reader already gets in a board's reason chip (`reason-chip.tsx`). A
 * claim with no colon (should not happen; defensive only) renders whole as the heading with an
 * empty body rather than throwing on a content page.
 */
function splitClaim(claim: string): { readonly title: string; readonly body: string } {
  const separator = ": ";
  const index = claim.indexOf(separator);
  if (index === -1) return { title: claim, body: "" };
  const body = claim.slice(index + separator.length);
  // The body was mid-sentence before the split; as standalone prose it opens a sentence.
  return { title: claim.slice(0, index), body: body.charAt(0).toUpperCase() + body.slice(1) };
}

/** Every measured figure, formatted, never typed — the four values (spec Part 3) a reader needs
 *  to judge a law for themselves: signed effect, the 95% interval, the sample and the seasons. */
function measuredFigures(measured: LawMeasurement): { readonly effect: string; readonly interval: string; readonly sample: string; readonly seasons: string } {
  const [low, high] = measured.ci;
  return {
    effect: `${signedPoints(measured.effect)} pts per game`,
    interval: `${signedPoints(low)} to ${signedPoints(high)} pts per game`,
    sample: `${Math.round(measured.sample)} player-seasons`,
    seasons: measured.seasons,
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
 * THE DISCOVERED-LAWS SECTION'S ONE METHODOLOGY SENTENCE (fix round, CRITICAL 3), built from
 * `discoveredPipelineCounts()` — never a number typed into this file's own copy, the identical "read
 * it at render time" discipline every other figure on this page keeps. States the whole funnel
 * (tested -> untestable -> BH survivors -> replicated) AND, per IMPORTANT 1 RULING, that only 2022
 * and 2023 are genuinely out-of-sample for a discovered law (2021 sits inside the discovery screen's
 * own training window — see `discovery/measure.ts`'s docblock, step 4, and `registry.ts`'s
 * `verdictForDiscoveredLaw` for where that distinction changes a verdict).
 */
function discoveryMethodologySentence(counts: PipelineCounts): string {
  return (
    `Every one of the ${counts.tested} mechanically generated candidates above is measured the same way: matched to a similar ` +
    `player-season, screened for a false-discovery rate of at most 10% across the whole candidate family, then required to ` +
    `replicate on seasons the screen never trained on. ${counts.untestable} could not be matched on the training window and were ` +
    `excluded rather than scored; ${counts.bhSurvivors} survived the false-discovery screen; ${counts.replicated} of those also ` +
    `replicated on 2022 or 2023, the two seasons genuinely outside the screen's own training window (2021 sits inside it). Only ` +
    `the ${counts.replicated} law${counts.replicated === 1 ? "" : "s"} below cleared every bar; the rest of the survivors are ` +
    `recorded, with their own non-confirmed verdict, in the committed discovery file.`
  );
}

/**
 * WHAT A CONFIRMED LAW ACTUALLY DOES, DERIVED MECHANICALLY, ORIGIN-AWARE (fix round, CRITICAL 3 —
 * this sentence used to read `laws` as one undifferentiated list; now that `registry()` merges
 * discovered laws in too, that would either mislabel a discovered law's own board absence as "not
 * wired to the model" — a narrower, misleading claim, since a discovered law does not even reach a
 * board's reason chip yet, model wiring or not — or silently count it toward a "confirmed" total the
 * tribal sentence's own numbers were never written to include).
 *
 * TRIBAL: unchanged from the original (fix round, I7) — only a confirmed TRIBAL law with a wired
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

export default async function PlayerLawsPage() {
  const user = await getCurrentUser();
  const laws = registry();
  const tribalLaws = laws.filter((law) => law.origin === "tribal");
  const confirmedDiscovered = laws.filter((law) => law.origin === "discovered" && law.verdict === "confirmed");
  const groups = groupByVerdict(tribalLaws);
  const discoveredCounts = discoveredPipelineCounts();
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
          Every law here started as a piece of fantasy football folklore. To grade one, we find
          every player-season that fits its claim, match each one to an otherwise similar
          player-season that does not, and compare what actually happened the following season.
          A law only counts as confirmed when that difference also holds up separately on each of
          several seasons checked one at a time, not only when every season is pooled together.
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
        {confirmedDiscovered.length === 0 ? (
          <p>
            No discovered candidate has replicated yet. The pipeline&apos;s own full record, including every
            survivor that did not, is committed alongside this page&apos;s own source.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {confirmedDiscovered.map((law) => (
              <LawArticle key={law.id} law={law} />
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
