import Link from "next/link";
import { Rise } from "@/components/ui";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { moneyIsLive } from "@/money/states";
import { OpenLeagueCta } from "./open-league-shared";
import { PracticeEntryLink } from "./practice-entry-link";

/**
 * The two money sentences the hero's one money line can render — the SAME `moneyIsLive()` switch
 * every other money-real surface reads (`renderWalletContent`'s own `live` parameter,
 * `@/app/app/(shell)/wallet/wallet-content`), so the sentence and the config can never disagree.
 * `FREE_SEASON_SENTENCE` is the exact string this task's own tests pin verbatim — the free branch
 * this task must leave byte-identical. `LIVE_MONEY_SENTENCE` gives way to it only once a state is
 * enabled (`MONEY_STATES.enabled`, founder decision 7), which no build ships with today.
 */
const FREE_SEASON_SENTENCE = "Every league is free this season.";
const LIVE_MONEY_SENTENCE = "Play free everywhere, or play for real money where your state allows.";

/**
 * B1 (flow analysis journey J01/J09; flow analysis finding 3) — Maya, the first-timer persona,
 * quit having never been told what fantasy football is: the one sentence that answers it already
 * existed, verbatim, but only past the account wall (`FIRST_RUN_EXPLAINER`, `first-run-panel.tsx`
 * — `/app`'s own opening line). Copied here rather than imported: `first-run-panel.tsx` does not
 * export its constant, and the two components sit in different render contexts (this one runs
 * signed out); a byte-identical copy, both swept by `src/integrity/rendered-copy.test.tsx`, is
 * the same discipline `CLOSING_STOP`'s own docblock in `room-tour.tsx` argues for a quoted phrase
 * with no shared import to pin it against. The copy gate: no dash, no passive construction, no
 * contraction outside the one allowlisted phrase, nothing accusatory, nothing from the forbidden
 * vocabulary (`src/integrity/copy-rules.ts`) — already true of this exact sentence, which is why
 * it survives verbatim rather than being rewritten a second time.
 */
const GAME_DEFINITION =
  "A league is a group of managers who draft NFL players, then start the ones they think will " +
  "score most each week. You play one other manager every week of the NFL season. Your team's " +
  "score is whatever your starters do in their real games.";

export interface FrontDoorHeroProps {
  /** Defaults to the real `moneyIsLive()` — injectable so a test can exercise the live sentence
   *  without editing shipped state, the identical `renderWalletContent`/`leagueTerms` idiom. No
   *  production caller, and no test in this task beyond the live-branch one, ever passes anything
   *  but the default: `MONEY_STATES.enabled` ships empty, so every real render reaches the dark
   *  branch. */
  readonly live?: boolean;
  /**
   * Task 9: whether the visitor is signed in — required, not defaulted, so every caller (`/`,
   * and any future one) states it explicitly rather than this component guessing. Decides where
   * `PracticeEntryLink` points and its label (B2), and which real control `OpenLeagueCta` renders
   * for `featuredLeague`; every other word on this hero is unconditional marketing copy, said the
   * same way to everyone.
   */
  readonly signedIn: boolean;
  /**
   * E2 (storefront review) — the SAME fullest-filling league `page.tsx` derives once and threads
   * to `NextDraftModule` and `OpenLeagueShelf`'s `featuredInHero` (that prop's own docblock
   * carries the whole "derive once, thread twice" account). `null` when nothing on the shelf is
   * genuinely filling — rule 6, real or absent: the hero then renders no seat action at all,
   * exactly this component's behavior before this prop existed. Optional and defaulted to `null`
   * so every existing caller (the copy sweep at `src/integrity/rendered-copy.test.tsx` renders
   * this component with only `signedIn`) keeps compiling and rendering exactly as before.
   */
  readonly featuredLeague?: PublicLeagueSummary | null;
}

/**
 * The front door's hero (Phase 3.6, Task 5; retoned by Phase 3.7, Task 7 to the Sunday
 * Standard mock, S8 ruling) — headline and sub adopted from `sunday-standard.html` verbatim.
 * The closing phrase and the money line render in `text-positive` (the mock's `.go`/`.free`,
 * money green): the page's energy comes from what is LIVE and REAL, never from decoration.
 * "No account is needed to look." survives as one quiet detail line (S8 — it answered a
 * persona concern and costs one line); the old "Browse the open leagues below." sentence dies
 * with the longer sub it belonged to.
 *
 * E6: the display size takes the responsive step — `text-display-md` at a phone width,
 * `sm:text-display-xl` (58, S3) from the first breakpoint up — so 360px never wears 58px type.
 *
 * Headline rises first, the sub block second (`Rise` 1/2, the mock's `d1`/`d2`); the steps and
 * scoreboard below carry slots 3 and 4 in their own modules.
 *
 * Every word here is static marketing copy but one: the money line, which is DERIVED from
 * `moneyIsLive()` (Phase 4, Task 13) rather than a fixed string — the free-season promise gives
 * way to the live sentence the day a state is enabled, never a stale claim quoting data this
 * task could get wrong. The numbers that can be checked live in `ProofStrip`, right below this.
 */
export function FrontDoorHero({ live = moneyIsLive(), signedIn, featuredLeague = null }: FrontDoorHeroProps) {
  return (
    <div className="flex flex-col items-start gap-4">
      <Rise step={1}>
        <h1 className="max-w-3xl text-balance font-display text-display-md font-semibold leading-display text-text-primary sm:text-display-xl">
          Real leagues. Real seats. <span className="text-positive">Drafting this week.</span>
        </h1>
      </Rise>
      <Rise step={2} className="flex flex-col items-start gap-2">
        {/* B1: leads with the plain-language definition, verbatim from `/app`'s own opening
            sentence — the whole reason Maya quit was never reaching it. "See how it works" keeps
            the fuller explainer (the format detail, the season summary — B4) one quiet click
            away at `/league-rules` rather than duplicating a second explainer here. */}
        <p className="max-w-2xl text-lg text-text-primary">{GAME_DEFINITION}</p>
        <Link href="/league-rules" className="text-sm font-medium text-accent underline">
          See how it works
        </Link>
        <p className="max-w-2xl text-lg text-text-muted">
          Season-long fantasy football with a live draft room, real-time scoring, and a platform
          that runs the league so no brother-in-law has to.
        </p>
        <p className="text-md font-medium text-positive">{live ? LIVE_MONEY_SENTENCE : FREE_SEASON_SENTENCE}</p>
        {/* E2 (storefront review): the hero band earns the page's one ink action — the fullest
            filling room, the SAME league `NextDraftModule` (xl+) and the shelf's own featured
            row/card point at (`featuredInHero`, `src/app/page.tsx`) — rather than the mock draft
            being the only thing in the band a visitor can press. Rule 6: real or absent, never
            dressed up — `featuredLeague` is `null` (nothing on the shelf is genuinely filling)
            means this block renders nothing at all, the same as before this prop existed. */}
        {featuredLeague === null ? null : (
          <div className="flex flex-col items-start gap-1.5">
            <p className="text-sm text-text-muted">
              Filling now: <span className="font-medium text-text-primary">{featuredLeague.name}</span>
            </p>
            <OpenLeagueCta league={featuredLeague} signedIn={signedIn} emphasis="ink" />
          </div>
        )}
        <p className="text-sm text-text-muted">No account is needed to look.</p>
        {/* Task 9, repositioned by E2/R5: the practice invitation now reads as the answer to a
            hesitation, beneath the page's real seat action, never competing with it. Task 9:
            the practice invitation lives in the hero's own left column, never the right column
            `NextDraftModule` occupies at xl+ (`src/app/page.tsx`) — the two can never fight for
            the same space because this one is never in it. Quiet on purpose (rule 5): the hero's
            one ink action is the seat CTA above (or the nav's, when nothing is filling), never
            this. */}
        <PracticeEntryLink signedIn={signedIn} className="mt-1" />
      </Rise>
    </div>
  );
}
