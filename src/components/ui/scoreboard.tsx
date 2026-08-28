import type { ReactNode } from "react";
import { MICRO_LABEL } from "./config";
import { Stat, type StatComparison } from "./stat";

export interface SideProps {
  /** The team name, as its manager wrote it. */
  readonly name: string;
  /** "7-3", "2-1-1" — already formatted; a scoreboard does not decide how a league counts ties. */
  readonly record: string;
  /** The live score, already formatted. Precision belongs to the surface that owns the fact:
   *  a half-PPR league's 118.4 and a standard league's 118 are both correct here. */
  readonly score: string;
  /** The projected final for this side, already formatted. */
  readonly projected: string;
  /** The team's crest — a slot, so `Crest`, an `Avatar` or a league's own mark all fit without
   *  this component learning what a crest is. */
  readonly crest: ReactNode;
  /** Whether this side is ahead RIGHT NOW. A presentational fact the caller already knows from
   *  comparing two numbers it is holding; recomputing it here from two formatted strings would
   *  mean parsing display text back into numbers, which is how a scoreboard starts disagreeing
   *  with itself. */
  readonly winning: boolean;
  /**
   * THE HONEST-COMPARISON SEAM, and the reason this prop is optional with no default.
   *
   * A `Stat` tints only against a named population (`StatComparison`), and the population a
   * matchup hero has to hand is "the two teams in this matchup" — which is not a population, it
   * is a pair. A percentile inside a set of two is fully determined by `winning`: the leader is
   * 1.0 and the trailer is 0.0, always, whether the margin is 0.2 points or 60. Feeding that to
   * `Stat` would paint a one-point lead in the same "top of the population" ink as a blowout and
   * announce "Top 1% of the two teams in this matchup" to a screen reader, which is not a
   * sentence anybody means. The percentile ramp's floors (`UI_CONFIG.stat.percentileFloors`) were
   * tuned against real distributions of many players; a coin flip dressed in them is a lie with a
   * legend attached, which is worse than a plain number.
   *
   * So `Scoreboard` NEVER synthesizes one. Omitted — the default — both scores render as ordinary
   * ink (`Stat` with no comparison is exactly a plain number), and the lead is carried by the
   * channels that are actually true: the larger figure, the "Leading" micro-label, and
   * `data-winning`. A caller that genuinely holds a wider population — "all twelve teams this
   * week", "every score in the league's history at this hour" — passes it, and the tint means
   * something. Honesty beats matching the mock; the mock's coloured hero score is the one thing
   * on it this primitive declines to reproduce until a real population exists to reproduce it
   * from.
   */
  readonly comparison?: StatComparison;
}

export interface ScoreboardProps {
  readonly home: SideProps;
  readonly away: SideProps;
  /** What sits between the two scores: the points-share bar, the yet-to-play pills, a live chip.
   *  A slot rather than props, because the middle is where a matchup's own story goes and every
   *  week's is different. */
  readonly middle: ReactNode;
  readonly className?: string;
}

/**
 * Which way a side leans. Literal class strings, never built from a variable — Tailwind's scanner
 * reads source text, and a template-built `sm:items-${side}` ships no rule at all. The sides only
 * diverge at `sm` and up, because the layout below stacks on a phone (see the root's docblock).
 */
const SIDE_ALIGN = {
  home: "sm:items-start sm:text-left",
  away: "sm:items-end sm:text-right",
} as const;

type SideName = keyof typeof SIDE_ALIGN;

/**
 * The matchup hero — the largest thing on the Sunday screen, by law.
 *
 * **LAW 2, THE NUMBER IS THE HERO.** *"A score is 84px; its label is 11px. If the largest thing
 * on a screen is not a number or a name, the screen is wrong."* The score renders at
 * `text-display-2xl` (84px) over an 11px mono eyebrow — the ~7.6x pairing the display scale was
 * widened to carry, spent here rather than admired in a token file. Nothing else in this
 * component is allowed to grow: the team name is `text-lg`, the record and the projected final
 * are micro-labels, and the crest is whatever size the caller's crest already is.
 *
 * **WHY IT STACKS ON A PHONE.** Two 84px scores cannot sit side by side at 360px — the pair alone
 * is wider than the viewport, and the honest options are a smaller score or a different layout.
 * Law 2 settles it: the score does not shrink, the layout changes. One column on a phone, three
 * (`side / middle / side`) from `sm` up. `Stat`'s size is a class and cannot be varied
 * responsively from outside the component, which is the second reason the layout moves instead of
 * the type.
 *
 * **THE LEAD IS NOT A COLOUR.** See `SideProps.comparison` for the full argument: a matchup of two
 * is not a population, so the winning side is marked by the figure itself, a "Leading"
 * micro-label and `data-winning` — every one of which survives a monochrome screen.
 */
export function Scoreboard({ home, away, middle, className = "" }: ScoreboardProps) {
  return (
    <div className={`grid items-center gap-5 sm:grid-cols-[1fr_auto_1fr] ${className}`}>
      <Side side="home" {...home} />
      <div className="min-w-0">{middle}</div>
      <Side side="away" {...away} />
    </div>
  );
}

/** One team's half of the hero: identity above, the score, the projected final below. */
function Side({ side, name, record, score, projected, crest, winning, comparison }: SideProps & { readonly side: SideName }) {
  return (
    <div data-winning={winning} className={`flex min-w-0 flex-col items-start gap-2 ${SIDE_ALIGN[side]}`}>
      <div className="flex min-w-0 items-center gap-2">
        {crest}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-lg leading-tight">{name}</span>
          <span className="flex items-baseline gap-2">
            <span className={`${MICRO_LABEL} text-text-faint`}>{record}</span>
            {/* The lead, stated in words. Law 1 spends no pigment on it (see
                `SideProps.comparison`), so this micro-label IS the channel rather than a
                decoration beside a coloured number. */}
            {winning ? <span className={`${MICRO_LABEL} text-text-primary`}>Leading</span> : null}
          </span>
        </div>
      </div>
      {/* The label stays visible. `Stat`'s `srOnlyLabel` exists for one situation — a cell under
          a table's own `<th>` — and this is not one: an 84px figure with no name on screen is
          precisely what that primitive was built to stop shipping, and "Score" at 11px over 84px
          is the pairing law 2 describes in so many words. */}
      <Stat label="Score" value={score} size="2xl" comparison={comparison} />
      <span className="flex items-baseline gap-1.5">
        <span className={`${MICRO_LABEL} text-text-faint`}>Proj</span>
        <span className="font-mono text-sm tabular-nums text-text-muted">{projected}</span>
      </span>
    </div>
  );
}
