import { BigNumber, Card } from "@/components/ui";
import { HOUSE_SHELF_SENTENCE } from "@/matchmaking/shelf-order";
import { moneySentence } from "@/money/copy";
import { moneyIsLive, stateEligibilityLine, MONEY_STATES, type MoneyStatesConfig } from "@/money/states";

export interface FrontDoorHeroProps {
  /** Defaults to the real `moneyIsLive()` — injectable so a test can exercise the live sentence
   *  without editing shipped state. */
  readonly live?: boolean;
  /** The eligibility line's own config — injectable for the same reason `live` is; production
   *  renders the shipped `MONEY_STATES`. Read only when `live`. */
  readonly states?: MoneyStatesConfig;
  /**
   * THE PEOPLE ALREADY INSIDE (SIDELINE, 2026-09-10): seats taken across the open rooms on the
   * board below, and how many rooms that is. Summed by the page from the SAME merged list the
   * shelf renders — no second query, no second cap, and no new disclosure: each room's
   * `filledTeams` is already public on `PublicLeagueSummary`, and a sum over the shelf names
   * nobody. Omit (or pass zero rooms) and the card renders the house sentence alone: a lobby
   * with nothing in it says so rather than inventing an occupancy figure.
   */
  readonly inside?: { readonly seatsTaken: number; readonly openRooms: number };
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
export function FrontDoorHero({ live = moneyIsLive(), states = MONEY_STATES, inside }: FrontDoorHeroProps) {
  const eligibility = live ? stateEligibilityLine(states) : null;
  const rooms = inside === undefined ? 0 : inside.openRooms;
  return (
    // SIDELINE: the mock's two-column hero — the promise on the left, the card that says the
    // lobby is occupied on the right, and nothing that acts in either (the featured ROW below
    // carries the page's one solid verb).
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
      <div className="flex min-w-0 flex-col items-start gap-5">
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
      {/* P2: one number with its basis. The basis names the population it was summed over, so
          the figure is checkable against the board directly beneath it. */}
      {/* `as="section"` (fix round 1, L4): the label only reaches the accessibility tree on an
          element with a role that takes a name. On a bare `div` the `aria-label` was inert. */}
      <Card as="section" className="flex w-full shrink-0 flex-col gap-3 lg:max-w-sm" aria-label="Who is already inside">
        {rooms === 0 ? null : (
          <BigNumber
            value={String(inside!.seatsTaken)}
            basis={`seats taken across the ${rooms} open ${rooms === 1 ? "room" : "rooms"} below`}
            size="lg"
            align="start"
          />
        )}
        <p className="text-sm text-text-muted">{HOUSE_SHELF_SENTENCE}</p>
      </Card>
    </div>
  );
}
