import type { ReactNode } from "react";
import { Card } from "./card";
import { EYEBROW } from "./config";

export interface PanelProps {
  readonly title: string;
  /** The right-aligned note in the header: "Closest first", "10 managers, 2 open seats". */
  readonly meta?: ReactNode;
  /** Renders as an `h2` by default; a page with its own heading order may pass `h3`. */
  readonly headingLevel?: 2 | 3;
  readonly children: ReactNode;
}

/**
 * The "quiet label, hairline, content" block the mocks repeat. Built on `Card` plus
 * `EYEBROW`, so the depth token and the eyebrow class each still have one home rather than a
 * third copy of either.
 */
export function Panel({ title, meta, headingLevel = 2, children }: PanelProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <Card as="section" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
        <Heading className={EYEBROW}>{title}</Heading>
        {meta === undefined ? null : <span className="text-sm text-text-muted">{meta}</span>}
      </div>
      {children}
    </Card>
  );
}
