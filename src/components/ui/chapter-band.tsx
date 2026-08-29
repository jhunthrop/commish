import { MICRO_LABEL } from "./config";

/**
 * What a band MEANS, spent as ink. Three tones and no fourth:
 *
 * - `live` — this chapter is happening now. Law 4's third channel, and the only fill that shouts.
 * - `act` — this chapter is waiting on the reader. Amber is furniture, you, and the verb, and a
 *   band of things you owe an answer to is the "you" case exactly.
 * - `quiet` — a chapter that is only a chapter: settled, historical, or merely next.
 *
 * Literal class pairs, never composed from the tone string: Tailwind's scanner reads source text,
 * so a template-built `bg-${tone}` ships no rule at all and the plate renders unfilled in
 * production while passing every test in development.
 */
const PLATE: Readonly<Record<ChapterBandTone, string>> = {
  live: "bg-live text-live-text",
  act: "bg-accent text-accent-text",
  quiet: "bg-surface-raised text-text-muted",
};

export type ChapterBandTone = "live" | "act" | "quiet";

export interface ChapterBandProps {
  /** The chapter's NAME — one or two words on the plate. "Needs your answer", "Today". */
  readonly marker: string;
  /**
   * The chapter's CONSEQUENCE, in plain language. Law 5's whole point: the letter is only its
   * name, and what a band means is what a reader came for. "Both sides said yes · these are done."
   */
  readonly consequence: string;
  readonly tone?: ChapterBandTone;
  readonly className?: string;
}

/**
 * SUNDAY v5, LAW 5 — bands are chapter markers, not hairlines.
 *
 * *"A hairline divider at sixty rows becomes the loudest thing on the screen while saying the
 * least."* So a chapter opens with a filled plate carrying its name and, beside it, what that
 * chapter means for the person reading — never a rule with a word floating over it.
 *
 * `TierDivider` is the sibling of this component and is deliberately NOT generalised into it: a
 * tier is a GRADE, one of four closed literals, and its plate colour is the grade itself (the
 * letter being the colourblind channel). A chapter is a division of a list by state or by day,
 * its names are open-ended strings, and its tone says how urgent the chapter is rather than how
 * good it is. Two different claims; one shape.
 *
 * `aria-hidden` is deliberately NOT set. The band is a real heading for the rows beneath it — a
 * reader running a screen reader down a trade inbox needs to hear "Needs your answer" before the
 * three offers that do, exactly as a sighted reader sees the plate before them.
 */
export function ChapterBand({ marker, consequence, tone = "quiet", className = "" }: ChapterBandProps) {
  return (
    <div
      data-chapter={tone}
      className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line bg-gradient-to-r from-surface-raised to-transparent px-2 py-1.5 ${className}`}
    >
      {/* The one sanctioned all-caps register (caps charter) — imported, never hand-rolled. */}
      <span className={`${MICRO_LABEL} rounded-sm px-2 py-0.5 font-semibold ${PLATE[tone]}`}>{marker}</span>
      <span className={`${MICRO_LABEL} min-w-0 text-text-muted`}>{consequence}</span>
    </div>
  );
}
