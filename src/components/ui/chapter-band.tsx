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
  /**
   * The SUBTITLE beside the name, in the same caps register — a short key, five words at most:
   * "a real drop after this", "both sides said yes", "claimed seats". Never a restatement of the
   * name, and never a sentence: capitals are for keys, and a sentence set in them shouts.
   */
  readonly consequence: string;
  /**
   * THE CONSEQUENCE AS A SENTENCE (fix round 2), on its own quiet row beneath the plate: body
   * size, faint ink, sentence case. Law 5's whole point is that the letter is only its name and
   * the consequence is what a band is for — but a consequence is prose, and the shelf proved
   * what happens when prose is pushed through the caps slot: a 108-character line became the
   * loudest thing on the front door, above the board it was introducing. One line at desktop,
   * wrapping at a phone. Omit it and no element renders at all.
   */
  readonly caption?: string;
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
export function ChapterBand({ name, consequence, caption, tone = "quiet", className = "" }: ChapterBandProps): ReactElement {
  return (
    <div
      data-chapter={tone}
      className={`flex flex-col gap-1 border-t border-line bg-gradient-to-r from-surface-raised to-transparent px-2 py-1.5 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {/* The one sanctioned all-caps register (caps charter) — imported, never hand-rolled. */}
        <span className={`${MICRO_LABEL} rounded-sm px-2 py-0.5 font-semibold ${PLATE_CLASS[tone]}`}>{name}</span>
        <span className={`${MICRO_LABEL} min-w-0 text-text-muted`}>{consequence}</span>
      </div>
      {caption === undefined ? null : (
        <p data-chapter-caption="" className="min-w-0 text-sm text-text-faint">
          {caption}
        </p>
      )}
    </div>
  );
}
