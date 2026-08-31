import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { MICRO_LABEL } from "@/components/ui/config";
import { ReadingFrame, ReadingSection } from "@/components/app-shell/reading-frame";
import { registry } from "@/projections/laws/registry";
import type { Law, LawMeasurement, LawVerdict } from "@/projections/laws/types";
import { signedPoints } from "@/components/ui/event-feed-row";

/**
 * THE PLAYER-LAWS REFERENCE (Task 9, Sunday v5, 2026-08-31).
 *
 * `/league-rules`'s own pattern, applied to the six claims `registry()` carries: a full-bleed
 * masthead, a measured prose column, chapters with anchors. This page's own subject makes ONE
 * rule non-negotiable that `/league-rules` never had to keep (law 7): every figure below is
 * FORMATTED from a `Law` object read at render time, never typed into this file's own copy — an
 * effect, an interval bound, a sample size or a seasons string that drifted between a re-measure
 * and this page would otherwise go stale silently. `splitClaim`, `measuredFigures` and
 * `verdictElaboration` below are the only places this file turns a `Law` into words, and none of
 * them read a law's `id` to decide what to say — they read only `claim`, `measured` and `verdict`,
 * the same three fields for all six, so a seventh law slots in with no new prose to write.
 *
 * DEBUNKED AND WEAK LAWS GET EQUAL BILLING (spec Part 3). `play_caller_fingerprint` measured
 * `debunked` and the two RB laws measured `weak` are on this page in full, grouped after the
 * confirmed laws but never hidden or hedged into a footnote — the whole point of measuring a
 * folk claim instead of asserting it is publishing what did not hold up, not just what did.
 * `verdictElaboration` says what a `weak` or `debunked` verdict actually means in general terms
 * (an interval that spans zero, an effect that points the wrong way) rather than inventing a
 * specific story per law, which is exactly the hardcoded-prose-that-goes-stale risk law 7 exists
 * to prevent.
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
 * One more sentence per verdict, keyed only by the verdict itself, never by which law carries
 * it — the mechanical characterization law 7 requires instead of hand-written per-law prose that
 * a re-measure could leave stale. Framed once per group (below), so a reader meets it once
 * rather than once per law.
 */
function verdictElaboration(verdict: LawVerdict): string {
  switch (verdict) {
    case "confirmed":
      return "The measured effect points in the claimed direction, the 95% interval clears zero, and the same direction held on seasons the projection model never trained on.";
    case "weak":
      return "The measured effect points in the claimed direction, but the 95% interval spans zero, so it cannot be told apart from no effect at all with the seasons measured so far.";
    case "debunked":
      return "The measured effect points against the claimed direction, so the popular version of this claim does not hold up under measurement.";
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

/**
 * Every law's `claim` is written "Name: plain-words description" (`populations.ts`'s
 * `LAW_ENTRIES`) — this splits on the first `": "` so the name becomes this section's own
 * heading and the rest stays exactly the sentence a reader already gets in a board's reason
 * chip (`reason-chip.tsx`). A claim with no colon (should not happen; defensive only) renders
 * whole as the heading with an empty body rather than throwing on a content page.
 */
function splitClaim(claim: string): { readonly title: string; readonly body: string } {
  const separator = ": ";
  const index = claim.indexOf(separator);
  return index === -1 ? { title: claim, body: "" } : { title: claim.slice(0, index), body: claim.slice(index + separator.length) };
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

export default async function PlayerLawsPage() {
  const user = await getCurrentUser();
  const groups = groupByVerdict(registry());

  return (
    <ReadingFrame
      title="Player laws"
      kicker="Reference"
      lede="Six claims about fantasy production, tested against what actually happened rather than assumed true."
      intent={PAGE_INTENT}
      signedIn={user !== null}
    >
      <ReadingSection id="how-measured" title="How these are measured">
        <p>
          Every law here started as a piece of fantasy football folklore. To grade one, we find
          every player-season that fits its claim, match each one to an otherwise similar
          player-season that does not, and compare what actually happened the following season.
          A law only counts as confirmed when that difference also holds up on seasons the
          projection model never trained on, not only on the years used to build it.
        </p>
      </ReadingSection>

      {groups.map((group) => (
        <ReadingSection key={group.verdict} id={group.verdict} title={VERDICT_GROUP_TITLE[group.verdict]}>
          <p>{verdictElaboration(group.verdict)}</p>
          <div className="flex flex-col gap-6">
            {group.laws.map((law) => {
              const { title, body } = splitClaim(law.claim);
              const figures = measuredFigures(law.measured);
              return (
                <article key={law.id} id={law.id} className="flex scroll-mt-6 flex-col gap-2">
                  <h3 className="font-display text-lg font-semibold leading-display text-text-primary">{title}</h3>
                  {body === "" ? null : <p>{body}</p>}
                  <p className="font-medium text-text-primary">{verdictSentence(law.verdict)}</p>
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
            })}
          </div>
        </ReadingSection>
      ))}

      <ReadingSection id="see-it-live" title="Where these show up">
        <p>
          Every confirmed law here feeds the board&apos;s own rankings, and a reason chip beside a
          player&apos;s name states its measured effect the same way this page does.
        </p>
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
