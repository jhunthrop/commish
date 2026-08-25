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
 * THE seat sentence for the whole product (F17, Phase 3.6 UX coherence review). One seat count
 * used to be spoken several different ways by several different callers — this is the one place
 * that composes it, so no caller writes a seat sentence of its own again.
 *
 * The bar beside it is the v3 mock's segment bar (Phase 3.7, Task 5): `total` EQUAL flex
 * segments, the first `filled` of them in money green (`accent` — seats filling is one of the
 * two things green is allowed to mean, rule 1), the rest `surface-inset`. It is decoration for
 * a sentence that is already on screen, not a second control, so it stays `aria-hidden` and
 * encodes nothing a screen reader needs that the sentence does not already say.
 */
export function SeatMeter({ filled, total, heldSeats = 0, className = "" }: SeatMeterProps) {
  const sentence = seatSentence(filled, total, heldSeats);
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-sm text-text-muted">{sentence}</span>
      {/* `min-w-24 flex-1`: the bar takes the row's remaining width so its segments stay equal
          and legible, and drops to its own full-width line (the wrapper wraps) when the sentence
          leaves it less than a readable minimum. */}
      <span data-testid="seat-segments" aria-hidden="true" className="flex h-1.5 min-w-24 flex-1 gap-0.5">
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={`flex-1 rounded-pill ${index < filled ? "bg-accent" : "bg-surface-inset"}`} />
        ))}
      </span>
    </div>
  );
}
