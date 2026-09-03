/**
 * THE PRACTICE BOT — v6's one drawn friend (the warmth pass, founder-approved 2026-09-03;
 * the SVG is the Anatomy mock's own, verbatim geometry).
 *
 * The canvas ruling: *"the practice bot becomes a friendly drawn mascot who speaks in empty
 * states ('Your queue is empty. Tap a player and he'll wait right here.')."* He appears where
 * the product has NOTHING to show and something to suggest — an `EmptyState`'s optional visual —
 * and nowhere else: a mascot beside real data would be decoration, and law 5 (honest data) has
 * no seat for that.
 *
 * Deliberately STATIC — no idle loop, no blink. Law 6 (motion reports, never performs) already
 * forbids ambient animation, which is also what makes him reduced-motion safe by construction
 * rather than by a media-query branch. `aria-hidden` always: the empty state's own words carry
 * the meaning, and a screen reader has no use for a drawing of a robot.
 *
 * Colors ride the token vars (`info` for the face — the bot has always spoken in the info
 * channel — and `accent` for the antenna tip), so he dresses for both themes without a second
 * drawing. The head plate sits on `surfaceRaised`, one step above whatever panel he stands in.
 */
export interface MascotProps {
  /** Pixel size of the square viewBox. The mock draws him at 40. */
  readonly size?: number;
  readonly className?: string;
}

export function Mascot({ size = 40, className = "" }: MascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
      <circle cx="20" cy="22" r="13" className="fill-surface-raised" />
      <circle cx="15.5" cy="20" r="2.4" className="fill-info" />
      <circle cx="24.5" cy="20" r="2.4" className="fill-info" />
      <path d="M15 26 Q20 29.5 25 26" strokeWidth="1.8" strokeLinecap="round" fill="none" className="stroke-info" />
      <line x1="20" y1="9" x2="20" y2="5" strokeWidth="1.8" strokeLinecap="round" className="stroke-info" />
      <circle cx="20" cy="4" r="1.8" className="fill-accent" />
    </svg>
  );
}
