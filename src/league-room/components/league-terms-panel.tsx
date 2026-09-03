import { Avatar, Card, EYEBROW, SeatMeter } from "@/components/ui";
import type { DraftFormat } from "@/domain/league";
import type { LeagueTerms } from "@/league";

/** NO TIPS (founder ruling, 2026-08-28): the format used to read "Snake" beside a trigger that
 *  defined "snake draft". The noun is now the whole word, which is what the trigger was for. */
const FORMAT_LABEL: Readonly<Record<DraftFormat, string>> = { snake: "Snake draft", auction: "Auction draft" };

/**
 * `scoringLabel` is a derived string (`describeScoring`, `@/scoring`), not a term key. Every label
 * it can produce used to carry an `InfoTip` except "Standard"; the founder ruling retired the
 * triggers, so THE RULE ITSELF IS PRINTED instead — one clause, beside the label, in the words a
 * manager would use. That is the ruling's own instruction ("change the word") rather than a
 * deletion: a scoring name is the one term on this panel a reader genuinely cannot infer, and
 * dropping the definition without replacing it would have made the panel less true, not quieter.
 *
 * A label with nothing to add ("Standard", or a name this map has never seen) renders alone.
 */
const SCORING_RULE: Readonly<Record<string, string>> = {
  PPR: "a point for every catch",
  "Half PPR": "half a point for every catch",
  "PPR, TE premium": "a point for every catch, and more for a tight end's",
  Standard: "no points for catches",
  Custom: "this league wrote its own",
};

/**
 * What a person reads before they join a league — and, unchanged, what a member reads about
 * their own league (Task 8). One definition list, one `LeagueTerms` prop, no data fetching and
 * no loading or error state of its own: the caller (`JoinForm` here; the league home page in
 * Task 8) owns getting the data, because the two callers get it two different ways — a client
 * fetch on the invite page, a server render inside the league — and this component's whole job
 * is to render identically either way.
 */
export function LeagueTermsPanel({
  terms,
  titleAs: Title = "h2",
  draftValue,
}: {
  readonly terms: LeagueTerms;
  /**
   * `Card`'s own `as` idiom, one remove out. `"h2"` (the default, used unchanged on `JoinForm`)
   * is the real, primary heading for that page's content — the invite page's own `PageTitle`
   * reads "Join a league", so `terms.name` here is the only heading naming the actual league.
   *
   * `"p"` is what the room's rail (`room-shell.tsx`) passes: the week strip already has an `h1`
   * carrying the league's name verbatim, so a SECOND element exposed with `role="heading"` and the
   * identical accessible name gives a screen reader's headings list two entries for one fact and
   * fails any accessible-name-scoped query with a strict-mode ambiguity — exactly the Task 9 e2e
   * regression (`league-lifecycle.spec.ts`) this fixes. `terms.name` still renders, still reads
   * identically to the eye; it is only no longer announced as a second heading, because the
   * page's own `h1` and this panel's `aria-label="League terms"` landmark already say who and
   * what it is.
   */
  readonly titleAs?: "h2" | "p";
  /** Overrides the Draft row's value. The first-timer persona read "(starting now)" a week
   *  after the draft finished and panicked — `terms.draftAt` bakes a relative clause at format
   *  time, and a card must not narrate a moment that has passed. */
  readonly draftValue?: string;
}) {
  return (
    <Card as="section" aria-label="League terms" className="flex flex-col gap-3">
      {/* `min-w-0 [overflow-wrap:anywhere]`: the league name is user content, and this panel
          renders it at display size inside a card — see `PageTitle`, which carries the same
          rule for the same reason (`break-words` wraps visually but is ignored when a browser
          computes min-content, so an unbroken name can still widen the card past its container). */}
      <Title className="min-w-0 [overflow-wrap:anywhere] font-display text-2xl font-semibold leading-display text-text-primary">
        {terms.name}
      </Title>
      {/* ONE GRID (founder, 2026-08-30: the rail's facts card mixed inline and stacked rows —
          no rhythm). Every fact is label-column + value-column at one size; a fact's aside is a
          faint second line under its value, never a layout of its own. */}
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5">
          <dt className={`${EYEBROW} text-text-muted`}>Format</dt>
          <dd className="text-text-primary">{FORMAT_LABEL[terms.format]}</dd>
        {/* Veteran persona review, fix round 1: the money fact is what a real-money decision
            reads first — Stake moves to position 2, right after Format, label and disclosure
            kept tightly paired. */}
          <dt className={`${EYEBROW} text-text-muted`}>Stake</dt>
          <dd className="flex flex-col gap-1 text-text-primary">
            <span>{terms.stakeLabel}</span>
            <span className="text-sm text-text-faint">{terms.stakeDisclosure}</span>
          </dd>
          <dt className={`${EYEBROW} text-text-muted`}>Size</dt>
          {/* F17: SeatMeter owns the seat sentence everywhere it counts seats — this row used to
              write its own "N of N managers" phrasing, a fourth wording of the same count. */}
          <dd className="text-text-primary">
            <SeatMeter filled={terms.filledTeams} total={terms.teamCount} />
          </dd>
          <dt className={`${EYEBROW} text-text-muted`}>Scoring</dt>
          <dd className="flex flex-col gap-1 text-text-primary">
            <span>{terms.scoringLabel}</span>
            {SCORING_RULE[terms.scoringLabel] === undefined ? null : (
              <span className="text-sm text-text-faint">{SCORING_RULE[terms.scoringLabel]}</span>
            )}
          </dd>
          <dt className={`${EYEBROW} text-text-muted`}>Roster</dt>
          <dd className="text-text-primary">{terms.rosterLine}</dd>
          <dt className={`${EYEBROW} text-text-muted`}>Draft</dt>
          <dd className="text-text-primary">{draftValue ?? terms.draftAt}</dd>
          <dt className={`${EYEBROW} text-text-muted`}>Commissioner</dt>
          <dd className="inline-flex items-center gap-2 text-text-primary">
            <Avatar name={terms.commissionerName} avatar={terms.commissionerAvatar} size="sm" />
            {terms.commissionerName}
          </dd>
        {/* Empty for a league that opted into neither the median game nor superflex — no
            "Notes" row at all, rather than an empty one, the same "nothing to show" idiom
            `StandingsTable`'s clinch badges already follow. */}
        {terms.formatNotes.length === 0 ? null : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <dt className={`${EYEBROW} text-text-muted`}>Notes</dt>
            <dd className="flex flex-col gap-1 text-text-primary">
              {terms.formatNotes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}
