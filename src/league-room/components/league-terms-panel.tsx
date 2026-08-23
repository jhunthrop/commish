import { Avatar, Card, EYEBROW, InfoTip } from "@/components/ui";
import type { DraftFormat } from "@/domain/league";
import type { TermKey } from "@/help/glossary";
import type { HelpLevel } from "@/identity/preferences";
import type { LeagueTerms } from "@/league";

const FORMAT_LABEL: Readonly<Record<DraftFormat, string>> = { snake: "Snake", auction: "Auction" };
const FORMAT_TERM: Readonly<Record<DraftFormat, TermKey>> = { snake: "snake-draft", auction: "auction-draft" };

/**
 * `scoringLabel` is a derived string (`describeScoring`, `@/scoring`), not a `TermKey`. Every
 * label it can produce gets an `InfoTip` except "Standard" — that one is already plain English —
 * mirroring `PublicLeagueList`'s own `SCORING_LABEL_TERM` (`@/league-room/components/public-
 * league-list`), which this deliberately duplicates rather than shares: the two components
 * render two different contracts (`PublicLeagueSummary` and `LeagueTerms`) that happen to carry
 * the same string values, and a shared map would couple them for no reason beyond four lines.
 */
const SCORING_LABEL_TERM: Readonly<Record<string, TermKey>> = {
  PPR: "ppr",
  "Half PPR": "half-ppr",
  "PPR, TE premium": "te-premium",
  Custom: "custom-scoring",
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
  helpLevel,
  titleAs: Title = "h2",
}: {
  readonly terms: LeagueTerms;
  readonly helpLevel?: HelpLevel;
  /**
   * `Card`'s own `as` idiom, one remove out. `"h2"` (the default, used unchanged on `JoinForm`)
   * is the real, primary heading for that page's content — the invite page's own `PageTitle`
   * reads "Join a league", so `terms.name` here is the only heading naming the actual league.
   *
   * `"p"` is what `LeagueHome` (Task 8) passes: that page already has an `h1` (`PageTitle`)
   * carrying `terms.name` verbatim, so a SECOND element exposed with `role="heading"` and the
   * identical accessible name gives a screen reader's headings list two entries for one fact and
   * fails any accessible-name-scoped query with a strict-mode ambiguity — exactly the Task 9 e2e
   * regression (`league-lifecycle.spec.ts`) this fixes. `terms.name` still renders, still reads
   * identically to the eye; it is only no longer announced as a second heading, because the
   * page's own `h1` and this panel's `aria-label="League terms"` landmark already say who and
   * what it is.
   */
  readonly titleAs?: "h2" | "p";
}) {
  return (
    <Card as="section" aria-label="League terms" className="flex flex-col gap-3">
      {/* `break-words`: the league name is user content, and this panel renders it at display
          size inside a card — see `PageTitle`, which carries the same rule for the same reason. */}
      <Title className="break-words font-display text-2xl font-bold uppercase leading-display text-text-primary">{terms.name}</Title>
      <dl className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <dt className={`${EYEBROW} text-text-muted`}>Format</dt>
          <dd className="inline-flex items-center gap-1 text-text-primary">
            {FORMAT_LABEL[terms.format]}
            <InfoTip term={FORMAT_TERM[terms.format]} helpLevel={helpLevel} />
          </dd>
        </div>
        {/* Veteran persona review, fix round 1: the money fact is what a real-money decision
            reads first — Stake moves to position 2, right after Format, label and disclosure
            kept tightly paired. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <dt className={`${EYEBROW} text-text-muted`}>Stake</dt>
          <dd className="flex flex-col gap-1 text-text-primary">
            <span>{terms.stakeLabel}</span>
            <span className="text-sm text-text-muted">{terms.stakeDisclosure}</span>
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <dt className={`${EYEBROW} text-text-muted`}>Size</dt>
          <dd className="text-text-primary">{`${terms.filledTeams} of ${terms.teamCount} managers`}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <dt className={`${EYEBROW} text-text-muted`}>Scoring</dt>
          <dd className="inline-flex items-center gap-1 text-text-primary">
            {terms.scoringLabel}
            {SCORING_LABEL_TERM[terms.scoringLabel] === undefined ? null : (
              <InfoTip term={SCORING_LABEL_TERM[terms.scoringLabel]!} helpLevel={helpLevel} />
            )}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <dt className={`${EYEBROW} text-text-muted`}>Roster</dt>
          <dd className="text-text-primary">{terms.rosterLine}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <dt className={`${EYEBROW} text-text-muted`}>Draft</dt>
          <dd className="text-text-primary">{terms.draftAt}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <dt className={`${EYEBROW} text-text-muted`}>Commissioner</dt>
          <dd className="inline-flex items-center gap-2 text-text-primary">
            <Avatar name={terms.commissionerName} avatar={terms.commissionerAvatar} size="sm" />
            {terms.commissionerName}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
