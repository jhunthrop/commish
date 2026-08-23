import { Badge, type BadgeTone } from "./badge";

export interface StatPillProps {
  /** The pill's own case is preserved in the DOM — capitals are CSS, not the text itself, so a
   *  screen reader announces "Final", not "F I N A L". */
  readonly label: string;
  readonly tone?: BadgeTone;
  /** The live pill's tinted ring — forwarded to `Badge`. */
  readonly glow?: boolean;
  readonly className?: string;
}

/**
 * The tone-carrying state chip: LIVE / FINAL / FIX LINEUP. `Badge` plus a forced uppercase
 * treatment — the pill's capitals are CSS, so the underlying string a caller passes (and a
 * screen reader announces) stays in whatever case reads naturally as a sentence.
 */
export function StatPill({ label, tone = "neutral", glow = false, className = "" }: StatPillProps) {
  return (
    <Badge tone={tone} glow={glow} className={`uppercase tracking-wide ${className}`}>
      {label}
    </Badge>
  );
}
