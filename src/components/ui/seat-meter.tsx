import { UI_CONFIG } from "./config";

export interface SeatMeterProps {
  readonly filled: number;
  readonly total: number;
  /**
   * A seat mid-claim — held for someone finishing sign-up, not yet a real member (Task 6's
   * join-hold). Omit or pass `0` where the fact is not yet known; the held clause renders only
   * once this is positive, and it says exactly what it knows, nothing more.
   */
  readonly heldSeats?: number;
  /**
   * Phase 3.7, Task 13: the desktop `LeagueRow` prints "{n} of {t} open" as its Seats column's
   * visible value, so the sentence here goes `sr-only` — the one product seat sentence (F17)
   * still speaks to assistive tech, held seats included, without a second visible phrasing
   * stacked beside the caller's own count. Default false: everywhere else the sentence IS the
   * visible value.
   */
  readonly srOnlySentence?: boolean;
  readonly className?: string;
}

/**
 * "9 of 12 seated" when there is nothing more to say, "11 of 12 seated. 1 seat left." once the
 * remaining count is small enough to matter, "9 of 12 seated. 1 seat is being claimed right
 * now." once a hold exists. Base and clauses compose into one sentence rather than several,
 * because a period is a pause a screen reader takes seriously.
 */
export function seatSentence(filled: number, total: number, heldSeats: number): string {
  const remaining = total - filled;
  const clauses: string[] = [];
  if (remaining > 0 && remaining < UI_CONFIG.seatMeter.lowSeatsThreshold) {
    clauses.push(`${remaining} seat${remaining === 1 ? "" : "s"} left.`);
  }
  if (heldSeats > 0) {
    clauses.push(`${heldSeats} seat${heldSeats === 1 ? "" : "s"} ${heldSeats === 1 ? "is" : "are"} being claimed right now.`);
  }
  const base = `${filled} of ${total} seated`;
  return clauses.length === 0 ? base : `${base}. ${clauses.join(" ")}`;
}

/**
 * ONE SEGMENT'S SKIN, and the one place a seat's three states are drawn (SIDELINE, 2026-09-10).
 * A taken seat is INK, a seat mid-claim is STREAK AMBER (`self` — a held seat is the literal
 * example the token's own docblock gives), and an open seat is the well behind a `border-edge`
 * boundary. Court blue is spent here no longer: `accent` is the ONE VERB (P3), and a meter that
 * filled itself blue put the page's loudest pigment on a row's furniture, twelve segments at a
 * time. Shared by the horizontal meter and the vertical stack so the two can never disagree
 * about which seat is which.
 */
function segmentClass(index: number, filled: number, heldSeats: number): string {
  if (index < filled) return "bg-text-primary";
  if (index < filled + heldSeats) return "bg-self";
  return "border border-edge bg-surface-inset";
}

/**
 * THE seat sentence for the whole product (F17, Phase 3.6 UX coherence review). One seat count
 * used to be spoken several different ways by several different callers — this is the one place
 * that composes it, so no caller writes a seat sentence of its own again.
 *
 * The bar beside it is the mock's SEGMENTED seat meter: `total` equal flex segments in the three
 * skins `segmentClass` names. It is decoration for a sentence that is already on screen, not a
 * second control, so it stays `aria-hidden` and encodes nothing a screen reader needs that the
 * sentence does not already say — held seats included, which is why the held segments render
 * here rather than only in the words.
 */
export function SeatMeter({ filled, total, heldSeats = 0, srOnlySentence = false, className = "" }: SeatMeterProps) {
  const sentence = seatSentence(filled, total, heldSeats);
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className={srOnlySentence ? "sr-only" : "text-sm text-text-muted"}>{sentence}</span>
      {/* `min-w-24 flex-1`: the bar takes the row's remaining width so its segments stay equal
          and legible, and drops to its own full-width line (the wrapper wraps) when the sentence
          leaves it less than a readable minimum. */}
      <span data-testid="seat-segments" aria-hidden="true" className="flex h-1.5 min-w-24 flex-1 gap-0.5">
        {Array.from({ length: total }, (_, index) => (
          // Unfilled segments carry a REAL boundary (joining review, 2026-08-27: the inset
          // fill measured 1.03:1 against `surface` in dark — the product's signature seat
          // element rendered as one dash with no visible extent). `border-edge` is the
          // control-boundary token the primitives already hold to 3:1 on every surface.
          <span key={index} className={`flex-1 rounded-pill ${segmentClass(index, filled, heldSeats)}`} />
        ))}
      </span>
    </div>
  );
}

export interface SeatStackProps {
  readonly filled: number;
  readonly total: number;
  readonly heldSeats?: number;
  readonly className?: string;
}

/**
 * THE SEAT STACK — the open-league row's who-column, stood on end (SIDELINE, 2026-09-10).
 *
 * WHY THIS AND NOT FACES. The mock draws faces here, and its own header marks the manager names
 * on it as stand-ins. `PublicLeagueSummary` (`@/matchmaking/contract`) is the product's written
 * privacy boundary — *"a stranger gets what they need to CHOOSE a league and nothing about the
 * people already in it"* — and the reduction of `compositionCategory` to a coarse bucket exists
 * precisely because a per-member fact at `filledTeams: 1` names a person. Initials on a public
 * row would be worse than the fact that boundary already refuses, and invented initials would be
 * a placeholder dressed as data, which the refusal list forbids outright. So the row leads with
 * what is TRUE and public: the seats themselves, taken, held and open. Faces arrive the moment
 * the product honestly has people to show — the waiting room, the room roster, the invite
 * landing — where `Manager` renders them beside their names.
 *
 * `aria-hidden` always: the row's own seat sentence (`SeatMeter`, `srOnlySentence`) is the one
 * spoken statement, and a second one here would say the same count twice.
 */
export function SeatStack({ filled, total, heldSeats = 0, className = "" }: SeatStackProps) {
  return (
    <span data-testid="seat-stack" aria-hidden="true" className={`flex shrink-0 gap-0.5 ${className}`.trimEnd()}>
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={`h-6 w-[5px] rounded-sm ${segmentClass(index, filled, heldSeats)}`} />
      ))}
    </span>
  );
}
