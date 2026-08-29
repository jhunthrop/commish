import type { ReactElement } from "react";
import { MICRO_LABEL } from "./config";

export type ChapterBandTone = "live" | "act" | "warn" | "quiet";

/**
 * What a band MEANS, spent as ink. Four tones and no fifth — the union of the two tracks that
 * independently built this component on the same day, each with the tones its own surfaces
 * needed, reconciled at merge:
 *
 * - `live` — this chapter is happening NOW. The only solid red fill; law 4 gives red one job.
 *   A room filling as you watch is the canonical case. "Overdue" is not this.
 * - `act` — this chapter is waiting on the READER. Amber is furniture, you, and the verb, and a
 *   band of things you owe an answer to is the "you" case exactly.
 * - `warn` — a clock that has run long. An OUTLINE, and that is a token fact rather than a taste
 *   one: `warning` ships no `-text` role, so it may never be a fill (the semantic-on-fill rule);
 *   the hue is spent as ink and boundary, the way `Badge` draws every semantic label.
 * - `quiet` — a chapter that is only a chapter: settled, historical, or merely next.
 *
 * Literal class pairs, never composed from the tone string: Tailwind's scanner reads source
 * text, so a template-built `bg-${tone}` ships no rule at all and the plate renders unfilled in
 * production while passing every test in development.
 */
const PLATE_CLASS: Readonly<Record<ChapterBandTone, string>> = {
  live: "bg-live text-live-text",
  act: "bg-accent text-accent-text",
  warn: "border border-warning text-warning",
  quiet: "bg-surface-raised text-text-muted",
};

export interface ChapterBandProps {
  /** The chapter's name, on the plate. Two or three words at most. */
  readonly name: string;
  /** What the chapter MEANS, in plain language — "a real drop after this", "both sides said
   *  yes · these are done" — never a restatement of the name. Law 5's whole point: the letter
   *  is only its name; the consequence is what a band is for. */
  readonly consequence: string;
  readonly tone?: ChapterBandTone;
  readonly className?: string;
}

/**
 * SUNDAY v5, LAW 5 — bands are chapter markers, not hairlines.
 *
 * A hairline divider at sixty rows becomes the loudest thing on the screen while saying the
 * least. A chapter band is a filled plate carrying its name and its consequence in plain
 * language, so a reader arriving mid-column learns what the rows beneath it have in common
 * without counting anything.
 *
 * `TierDivider` is the sibling and is deliberately NOT generalised into this: a tier is a GRADE,
 * one of four closed literals, its plate colour the grade itself. A chapter is a division of a
 * list by state or by day, its names open-ended, its tone saying how urgent rather than how
 * good. Two different claims; one shape.
 *
 * NOT `aria-hidden`: the band is a real heading for the rows beneath it — a reader running a
 * screen reader down a trade inbox needs "Needs your answer" before the three offers that do.
 *
 * THE PLATE IS NEVER THE ONLY CHANNEL. The name is text on the plate and the consequence is
 * text beside it, so the band survives with the hue channel switched off entirely.
 */
export function ChapterBand({ name, consequence, tone = "quiet", className = "" }: ChapterBandProps): ReactElement {
  return (
    <div
      data-chapter={tone}
      className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line bg-gradient-to-r from-surface-raised to-transparent px-2 py-1.5 ${className}`}
    >
      {/* The one sanctioned all-caps register (caps charter) — imported, never hand-rolled. */}
      <span className={`${MICRO_LABEL} rounded-sm px-2 py-0.5 font-semibold ${PLATE_CLASS[tone]}`}>{name}</span>
      <span className={`${MICRO_LABEL} min-w-0 text-text-muted`}>{consequence}</span>
    </div>
  );
}
