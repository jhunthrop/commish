import Link from "next/link";
import { Badge, Card, EYEBROW, InfoTip, SeatMeter } from "@/components/ui";
import { Icon, type IconName } from "@/components/ui/icon";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import type { DraftFormat } from "@/domain/league";
import type { TermKey } from "@/help/glossary";
import type { HelpLevel } from "@/identity/preferences";
import { describeStartTiming, rollNoticeSentence } from "@/matchmaking/roll";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { stakeTierLabel } from "@/matchmaking/filter";
import { HOUSE_RUNG_LABEL } from "@/matchmaking/house-catalog";
import { TIER_COMPOSITION_LABEL, type CompositionCategory } from "@/participation/composition";
import { JoinPublicLeagueButton } from "./join-public-league-button";

const FORMAT_LABEL: Readonly<Record<string, string>> = { snake: "Snake", auction: "Auction" };
const FORMAT_TERM: Readonly<Record<DraftFormat, TermKey>> = { snake: "snake-draft", auction: "auction-draft" };

/** See `public-league-list.tsx`'s identical constant for why every `InfoTip` on this card opens
 *  `guided` unconditionally: `/browse` and the front door are this product's unauthenticated
 *  surfaces, with no signed-in caller's `helpLevel` to read. */
const CARD_HELP_LEVEL: HelpLevel = "guided";

/** `scoringLabel` is a derived string (`describeScoring`), not a `TermKey` — see
 *  `public-league-list.tsx`'s identical map for why every label but "Standard" gets an `InfoTip`. */
const SCORING_LABEL_TERM: Readonly<Record<string, TermKey>> = {
  PPR: "ppr",
  "Half PPR": "half-ppr",
  "PPR, TE premium": "te-premium",
  Custom: "custom-scoring",
};

/** `clover` for newcomer, `crown` for veteran — see `public-league-list.tsx`'s identical map. */
const COMPOSITION_ICON: Readonly<Record<CompositionCategory, IconName>> = {
  all_newcomers: "clover",
  mostly_newcomers: "clover",
  open: "crown",
};

/** "Weeks 15, 16 and 17" / "Weeks 15 and 16" / "Week 15" — the one place a raw week-number list
 *  becomes a sentence, so `PublicLeagueSummary.playoffWeeks` stays raw data on the wire (its own
 *  docblock) and every reader of it says "and" the same way. */
function formatPlayoffWeeks(weeks: readonly number[]): string {
  if (weeks.length === 0) return "Not scheduled yet";
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  const last = weeks[weeks.length - 1];
  const rest = weeks.slice(0, -1);
  return `Weeks ${rest.join(", ")} and ${last}`;
}

/**
 * Whether `league` names the LAST open seat — the exact remaining count, never accounting for a
 * live hold: a hold is a fact about who is CLAIMING the seat, not about how many are left to be
 * claimed, and the two never agree on the wire in a way this label needs to second-guess.
 */
function isLastSeat(league: PublicLeagueSummary): boolean {
  return league.teamCount - league.filledTeams === 1;
}

/**
 * The one CTA accessible name every card on the shelf uses (Phase 3.6, Task 5): "Take the last
 * seat in Median #13. Newer players only." or "Take a seat in Half-PPR #241." — a stranger who
 * lands on this control by voice or screen reader hears what they are about to do and who it is
 * for, in the one sentence rather than a bare "Join" that says neither. Fed into BOTH the signed-
 * out `SignInLink`'s `aria-label` and (via the visible half alone) a signed-in `Button`'s own
 * label — see `ctaVisibleText` below for the shorter half a sighted visitor actually reads.
 */
function ctaAccessibleName(league: PublicLeagueSummary): string {
  const who = league.experienceTier === "beginner" ? " Newer players only." : "";
  return `Take ${isLastSeat(league) ? "the last seat" : "a seat"} in ${league.name}.${who}`;
}

function ctaVisibleText(league: PublicLeagueSummary): string {
  return isLastSeat(league) ? "Take the last seat" : "Take a seat";
}

export interface OpenLeagueCardProps {
  readonly league: PublicLeagueSummary;
  readonly signedIn: boolean;
}

/**
 * THE open-league card (Phase 3.6, Task 5) — the one shape `PublicLeagueList`'s member card and
 * `HouseLeagueShelf`'s house card each hand-rolled a near-identical copy of before this task, now
 * a single component both render. Every fact on it comes from `PublicLeagueSummary` and nothing
 * else — see that contract for what a stranger is and is not told.
 *
 * The gauntlet's veteran finding was that the card "looks premium, reads shallow" — the four
 * facts (Drafts, Who, Roster, Playoffs) are the fix: two existed already (`draftAt`,
 * `experienceTier`), two are new this task (`rosterSummary`, `playoffWeeks`), and all four render
 * together rather than the mock's own selective omission, because the data is already on the
 * wire and a veteran comparing two cards should never have to open one to see what the other
 * already showed for free.
 *
 * The when-full commitment is `describeStartTiming`'s own sentence (F9), quoted rather than
 * restated, and it REPLACES the `Drafts` fact's value for a `when_full` league — never both a
 * date and the sentence, and never the placeholder kickoff `startTrigger`'s own docblock warns
 * every other reader away from rendering as though somebody chose it.
 */
export function OpenLeagueCard({ league, signedIn }: OpenLeagueCardProps) {
  const authority: "house" | "member" = league.houseRung === null ? "member" : "house";
  const isBeginnerOnly = league.experienceTier === "beginner";

  return (
    <Card as="article" className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        {/* `min-w-0 break-words`: see `HomeLeagueCard`'s identical heading — a grid item's
            default `min-width: auto` otherwise lets a long league name widen the item past its
            column at 360px. */}
        <h3 className="min-w-0 break-words font-display text-2xl font-semibold leading-display text-text-primary">
          {league.name}
        </h3>
        {league.houseRung === null ? (
          <Badge tone="neutral">{stakeTierLabel(league.stakeTier)}</Badge>
        ) : (
          <Badge tone="accent">{HOUSE_RUNG_LABEL[league.houseRung]}</Badge>
        )}
      </div>

      {/* NEW-3: each term is its own full-width line (`basis-full`) rather than a shared
          `flex-wrap` row of same-line chunks. A guided `InfoTip` stacks its caption directly
          beneath its own trigger (`info-tip.tsx`'s own behavior, untouched), and a chunk that
          can grow to two lines cannot safely share a text-flow row with a `·` separator and its
          neighbor — the separator ends up orphaned on its own line the moment one chunk wraps.
          Giving every chunk `basis-full` removes the ambiguity outright: one line (icon + label,
          then its caption) per term, its own leading separator folded IN rather than a sibling
          that can strand itself. */}
      <div className={`${EYEBROW} flex flex-col gap-y-1`}>
        <span className="inline-flex items-center gap-1">
          {FORMAT_LABEL[league.format] ?? league.format}
          <InfoTip term={FORMAT_TERM[league.format]} helpLevel={CARD_HELP_LEVEL} />
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true">·</span>
          {league.scoringLabel}
          {SCORING_LABEL_TERM[league.scoringLabel] === undefined ? null : (
            <InfoTip term={SCORING_LABEL_TERM[league.scoringLabel]!} helpLevel={CARD_HELP_LEVEL} />
          )}
        </span>
        {/* Deciding a week is a fact about the league, not about anyone in it — the same
            reasoning `PublicLeagueSummary.medianGame`'s own docblock carries. */}
        {league.medianGame ? (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true">·</span>
            Median
            <InfoTip term="median-game" helpLevel={CARD_HELP_LEVEL} />
          </span>
        ) : null}
      </div>

      {/* The four facts a veteran actually shops on (Task 5, Step 3). */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="min-w-0">
          <p className={`${EYEBROW} text-text-muted`}>Drafts</p>
          <p className={`font-medium ${league.startTrigger === "when_full" ? "text-warning" : "text-text-primary"}`}>
            {league.startTrigger === "when_full" ? describeStartTiming({ startTrigger: "when_full", authority }) : league.draftAt}
          </p>
          {/* Task 7 (F12/F21): `kickoffRolls` is `PublicLeagueSummary`'s own field, read here
              rather than silently showing a different date than the one a visitor is comparing
              against their own calendar — only a SCHEDULED league can ever roll (Step 2's own
              model ruling), so a `when_full` card never renders this line. */}
          {league.startTrigger === "scheduled" && league.kickoffRolls > 0 ? (
            <p className="mt-1 text-xs text-text-muted">{rollNoticeSentence(league.kickoffRolls)}</p>
          ) : null}
        </div>
        <div className="min-w-0">
          <p className={`${EYEBROW} text-text-muted`}>Who</p>
          <p className="font-medium text-text-primary">{isBeginnerOnly ? "Newer players only" : "Open to everyone"}</p>
        </div>
        <div className="min-w-0">
          <p className={`${EYEBROW} text-text-muted`}>Roster</p>
          <p className="font-medium text-text-primary">{league.rosterSummary}</p>
        </div>
        <div className="min-w-0">
          <p className={`inline-flex items-center gap-1 ${EYEBROW} text-text-muted`}>
            Playoffs
            {/* NEW-3: `standard`, not `CARD_HELP_LEVEL`, only here. A guided caption stacks
                between this label and its value, growing this one cell past its three siblings
                in the same grid row and knocking "Weeks 15, 16 and 17" out of alignment with
                them — a popover-only trigger keeps every cell in this 2x2 grid the same shape;
                the definition is still one click away, same as it is everywhere `InfoTip` is not
                the always-visible kind. */}
            <InfoTip term="playoffs" helpLevel="standard" />
          </p>
          <p className="font-medium text-text-primary">{formatPlayoffWeeks(league.playoffWeeks)}</p>
        </div>
      </div>

      <p className="inline-flex items-center gap-1 text-sm text-text-muted">
        <Icon name={COMPOSITION_ICON[league.compositionCategory]} size={16} />
        {TIER_COMPOSITION_LABEL[league.compositionCategory]}
      </p>

      {isBeginnerOnly ? (
        <p className="text-sm text-text-muted">
          Reserved for players newer to Commish so everyone starts even. Played here before?{" "}
          <Link href="/browse?experienceTier=experienced" className="font-medium text-accent underline">
            Browse leagues open to everyone
          </Link>
          .
        </p>
      ) : null}

      {/* F17: the seat sentence is `SeatMeter`'s, everywhere, held seats included. */}
      <SeatMeter filled={league.filledTeams} total={league.teamCount} heldSeats={league.heldSeats} />

      <div className="mt-auto">
        {signedIn ? (
          <JoinPublicLeagueButton leagueId={league.id} leagueName={league.name} />
        ) : (
          // The HOLD interstitial for THIS league (Task 6, F6), not a generic `/app` — the
          // parent's Task 6 seats a visitor who comes back still holding a live token.
          <SignInLink
            intent={`/join/${league.id}/hold`}
            aria-label={ctaAccessibleName(league)}
            className="inline-flex h-10 min-w-0 items-center justify-center [overflow-wrap:anywhere] rounded-md bg-accent px-4 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {ctaVisibleText(league)}
          </SignInLink>
        )}
      </div>
    </Card>
  );
}
