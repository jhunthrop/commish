import { ButtonLink } from "@/components/ui";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { moneyIsLive } from "@/money/states";
import { OpenLeagueCta } from "./open-league-shared";
import { PracticeEntryLink } from "./practice-entry-link";

/**
 * The two money sentences the hero's one money line can render — the SAME `moneyIsLive()` switch
 * every other money-real surface reads, so the sentence and the config can never disagree.
 * `LIVE_MONEY_SENTENCE` gives way only once a state is enabled (`MONEY_STATES.enabled`, founder
 * decision 7), which no build ships with today.
 */
const FREE_SEASON_SENTENCE = "Every league is free this season.";
const LIVE_MONEY_SENTENCE = "Play free everywhere, or play for real money where your state allows.";

export interface FrontDoorHeroProps {
  /** Defaults to the real `moneyIsLive()` — injectable so a test can exercise the live sentence
   *  without editing shipped state. */
  readonly live?: boolean;
  /** Required, not defaulted, so every caller states it. Decides where `PracticeEntryLink`
   *  points and which control `OpenLeagueCta` renders for `featuredLeague`. */
  readonly signedIn: boolean;
  /** The fullest genuinely-filling league, derived once in `page.tsx` and threaded here and to
   *  the page's lower third — `null` when nothing qualifies (law 7: real or absent). */
  readonly featuredLeague?: PublicLeagueSummary | null;
}

/**
 * The front door's hero, SUNDAY v5 (2026-08-28): the board is the hero, so this is not one.
 *
 * Direction A's whole argument, founder-approved from the mockups: the previous hero asserted the
 * product in six stacked text blocks — a definition of fantasy football, a link under it, a
 * second paragraph, a money line, a "Filling now" line, a reassurance line — before a visitor
 * reached anything real. The promise is ON SCREEN, moving, one band below: eight real rooms with
 * live seat meters. So the hero's job shrinks to naming the one thing an operator can say that a
 * tool site cannot, in the broadcast register, and getting out of the way.
 *
 * WHAT LEFT, AND WHERE IT WENT, because five findings pinned copy here and none of them is
 * repealed by deletion:
 * - The what-is-fantasy definition (B1, Maya the first-timer) lives at `/league-rules`, one
 *   press away behind the storefront nav's "How it works" — the same place B4 already kept the
 *   fuller explainer. The definition survives; its position as a hero paragraph does not.
 * - "Filling now: {league}" became the page's lower third, which is law 6's place for the
 *   subject and the verb.
 * - "No account is needed to look." is retired outright: the page being fully visible with no
 *   wall IS that sentence, said structurally.
 * - The money line SURVIVES. Money copy is load-bearing on a real-money product, and one derived
 *   sentence is the honest price of that; it still reads `moneyIsLive()`, never a fixed claim.
 *
 * The headline takes the display face at 800 — law 3's register, the weight the face earned and
 * the body face is still denied.
 */
export function FrontDoorHero({ live = moneyIsLive(), signedIn, featuredLeague = null }: FrontDoorHeroProps) {
  return (
    <div className="flex flex-col items-start gap-5">
      <h1 className="max-w-3xl text-balance font-display text-display-md font-extrabold leading-display text-text-primary sm:text-display-xl">
        There is always a seat.
      </h1>
      <p className="max-w-2xl text-lg text-text-muted">
        Season-long leagues that draft this week. We run the draft, the schedule and the scoring,
        so no brother-in-law has to.
      </p>
      <p className="text-md font-medium text-text-primary">{live ? LIVE_MONEY_SENTENCE : FREE_SEASON_SENTENCE}</p>
      <div className="flex flex-wrap items-center gap-3">
        {/* The page's verb, in the amber the verb owns (law 4). When a room is genuinely
            filling the verb IS that room's seat; otherwise it opens the full lobby. */}
        {featuredLeague === null ? (
          <ButtonLink href="/browse" variant="verb">
            Take a seat
          </ButtonLink>
        ) : (
          <OpenLeagueCta league={featuredLeague} signedIn={signedIn} emphasis="ink" />
        )}
        <PracticeEntryLink signedIn={signedIn} />
      </div>
    </div>
  );
}
