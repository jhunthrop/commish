import { useId, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { EYEBROW } from "@/components/ui/config";

/** The one sentence an absent section carries under its heading. Spelled once for every section
 *  and its tests. */
export const NOT_HELD = "Not held for this club.";

export interface SectionProps {
  readonly title: string;
  /** Where the numbers come from, one line: "2025 season, nflverse play-by-play". */
  readonly basis: string;
  /** `false` renders the heading and `NOT_HELD` only, never the children. */
  readonly held: boolean;
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * ONE SECTION OF THE TEAM PAGE (coordinator's ruling): a heading, a one-line basis under it, and
 * the measured data as tables, strips and figures. No prose beyond those two lines, and an absence
 * is the heading plus one sentence, never a zero and never a placeholder shaped like data.
 *
 * The basis is the eyebrow register (`EYEBROW`, sentence case, mono, quiet), because it is a fact
 * about the section's provenance rather than a label shouted beside data.
 */
export function Section({ title, basis, held, children, className = "" }: SectionProps) {
  const headingId = useId();
  return (
    <Card as="section" aria-labelledby={headingId} className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-lg font-semibold text-text-primary">
          {title}
        </h2>
        <p className={`${EYEBROW} text-text-faint`}>{held ? basis : NOT_HELD}</p>
      </div>
      {held ? children : null}
    </Card>
  );
}
