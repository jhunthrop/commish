import { Badge, type BadgeTone } from "./badge";

export interface StatPillProps {
  /** Rendered exactly as written — "Live", "Final", "Fix lineup" — sentence case per the caps
   *  charter, so the chip reads the same to the eye and to a screen reader. */
  readonly label: string;
  readonly tone?: BadgeTone;
  /** The live pill's tinted ring — forwarded to `Badge`. */
  readonly glow?: boolean;
  readonly className?: string;
}

/**
 * The tone-carrying state chip: Live / Final / Fix lineup. `Badge` plus a widened tracking —
 * the caps charter (v3, the `src/design` caps sweep) retired the old forced-caps treatment,
 * so the chip now shows the caller's string as-is.
 */
export function StatPill({ label, tone = "neutral", glow = false, className = "" }: StatPillProps) {
  return (
    <Badge tone={tone} glow={glow} className={`tracking-wide ${className}`}>
      {label}
    </Badge>
  );
}
