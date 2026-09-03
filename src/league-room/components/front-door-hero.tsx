import { moneyIsLive, stateEligibilityLine, MONEY_STATES, type MoneyStatesConfig } from "@/money/states";
import { moneySentence } from "./open-league-shared";

export interface FrontDoorHeroProps {
  /** Defaults to the real `moneyIsLive()` — injectable so a test can exercise the live sentence
   *  without editing shipped state. */
  readonly live?: boolean;
  /** The eligibility line's own config — injectable for the same reason `live` is; production
   *  renders the shipped `MONEY_STATES`. Read only when `live`. */
  readonly states?: MoneyStatesConfig;
}

/**
 * The front door's hero, compressed to the blueprint's register (front door blueprint,
 * 2026-09-02): the headline, the sub, and the derived money fact — and NOTHING that acts. The
 * board one band below is the landing, and the blueprint's own law gives the page's one solid
 * amber verb to the fullest genuinely-filling ROW, so the hero carrying a second rendering of
 * that verb died here (superseding the 2026-08-25 hero-module ruling's last form — the module
 * had already moved once, into the lower third; the row itself is now the featured room's one
 * loud rendering). The practice invitation moved to the "Never played?" trust card, which is
 * the blueprint's own place for it. When nothing on the shelf genuinely fills, the nav pill
 * stays loud (E2, unchanged, decided in `page.tsx`).
 *
 * WHAT SURVIVES, and the findings each piece still honors:
 * - The headline and sub, verbatim — founder-approved, the blueprint keeps both.
 * - The money line is DERIVED (`moneySentence`, the same `moneyIsLive()` switch every
 *   money-real surface reads) — the absolutism sweep's rule, never a fixed claim.
 * - LIVE ONLY, the state-eligibility line: `stateEligibilityLine` derives it from the real
 *   `MONEY_STATES` config (count, real minimum ages, the pointer at the state list). Null while
 *   dark — an absent line, never filler (law 7).
 * - The what-is-fantasy definition (B1) stays at `/league-rules`; "No account is needed to
 *   look." stays said structurally — both retirements pinned by the earlier v5 pass, unchanged.
 */
export function FrontDoorHero({ live = moneyIsLive(), states = MONEY_STATES }: FrontDoorHeroProps) {
  const eligibility = live ? stateEligibilityLine(states) : null;
  return (
    <div className="flex flex-col items-start gap-5">
      <h1 className="max-w-3xl text-balance font-display text-display-md font-extrabold leading-display text-text-primary sm:text-display-xl">
        There is always a seat.
      </h1>
      <p className="max-w-2xl text-lg text-text-muted">
        Season-long leagues that draft this week. We run the draft, the schedule and the scoring,
        so no brother-in-law has to.
      </p>
      <div className="flex flex-col gap-1">
        <p className="text-md font-medium text-text-primary">{moneySentence(live)}</p>
        {eligibility === null ? null : <p className="text-sm tabular-nums text-text-muted">{eligibility}</p>}
      </div>
    </div>
  );
}
