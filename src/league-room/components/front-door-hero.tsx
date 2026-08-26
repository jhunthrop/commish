import { Rise } from "@/components/ui";
import { moneyIsLive } from "@/money/states";
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

export interface FrontDoorHeroProps {
  /** Defaults to the real `moneyIsLive()` — injectable so a test can exercise the live sentence
   *  without editing shipped state, the identical `renderWalletContent`/`leagueTerms` idiom. No
   *  production caller, and no test in this task beyond the live-branch one, ever passes anything
   *  but the default: `MONEY_STATES.enabled` ships empty, so every real render reaches the dark
   *  branch. */
  readonly live?: boolean;
  /**
   * Task 9: whether the visitor is signed in — required, not defaulted, so every caller (`/`,
   * and any future one) states it explicitly rather than this component guessing. Decides only
   * where `PracticeEntryLink` points; every other word on this hero is unconditional marketing
   * copy, said the same way to everyone.
   */
  readonly signedIn: boolean;
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
export function FrontDoorHero({ live = moneyIsLive(), signedIn }: FrontDoorHeroProps) {
  return (
    <div className="flex flex-col items-start gap-4">
      <Rise step={1}>
        <h1 className="max-w-3xl text-balance font-display text-display-md font-semibold leading-display text-text-primary sm:text-display-xl">
          Real leagues. Real seats. <span className="text-positive">Drafting this week.</span>
        </h1>
      </Rise>
      <Rise step={2} className="flex flex-col items-start gap-2">
        <p className="max-w-2xl text-lg text-text-muted">
          Season-long fantasy football with a live draft room, real-time scoring, and a platform
          that runs the league so no brother-in-law has to.
        </p>
        <p className="text-md font-medium text-positive">{live ? LIVE_MONEY_SENTENCE : FREE_SEASON_SENTENCE}</p>
        <p className="text-sm text-text-muted">No account is needed to look.</p>
        {/* Task 9: the practice invitation lives in the hero's own left column, never the right
            column `NextDraftModule` occupies at xl+ (`src/app/page.tsx`) — the two can never
            fight for the same space because this one is never in it. Quiet on purpose (rule 5):
            the front door's one ink pill is "Take a seat", not this. */}
        <PracticeEntryLink signedIn={signedIn} className="mt-1" />
      </Rise>
    </div>
  );
}
