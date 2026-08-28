import { MICRO_LABEL } from "./config";
import { magnitudeStep, Stat, type StatComparison } from "./stat";

export interface SeasonWeek {
  readonly week: number;
  /**
   * What he actually scored, under this league's own scoring rules — or `null` for a week that
   * happened without him in it (a bye, an inactive, a player signed mid-season). `null` is not a
   * zero: "did not play" and "played and scored nothing" are different facts, the same
   * distinction `matchupWeek` already keeps for a lineup entry with no stat line.
   */
  readonly points: number | null;
  /** Where the week sits in a stated population. Omitted for a week with no population behind
   *  it, which renders the number as ordinary ink — `Stat`'s own "no comparison, no colour". */
  readonly comparison?: StatComparison;
}

export interface SeasonBarsProps {
  /** ONLY WEEKS THAT HAVE HAPPENED. The caller gates on `stat_weeks`, never on the presence of a
   *  stat line — see the component's docblock for why those are not the same question. */
  readonly weeks: readonly SeasonWeek[];
  /** Named for assistive tech only. The chart carries no visible heading and no caption. */
  readonly label: string;
  readonly className?: string;
}

/**
 * How loud a bar is drawn. THREE steps, not the ramp's five, because three is what a column of
 * rectangles can actually hold apart at 40px wide: a big week, an ordinary one, a bust. The full
 * five-step verdict is on the number above the bar, where `Stat` renders it in the ramp's own ink
 * with its own caret and weight.
 *
 * **WHY THESE ARE NEUTRAL ROLES AND NOT THE HEAT MAP'S PIGMENTS.** The heat map is a number's own
 * ink and nothing else: `magnitude-budget.source.test.ts` makes `Stat` the only file in the
 * product allowed to name a magnitude colour at all, and `globals.css` states the same boundary
 * at the palette — *"Only `Stat` may name one of these, and only as text."* A bar fill is a new
 * use of that budget and the gate's own bargain is that a new use earns its allowlist entry in
 * review, with a reason. So the bars take the neutral ladder instead, and they lose less than it
 * sounds: `text-primary` → `text-muted` → `edge` is strictly decreasing in contrast against the
 * ground in BOTH themes — brighter at night, darker in daylight, exactly the direction the
 * magnitude ramp itself is ordered in — so the season's shape survives with the hue channel
 * switched off entirely, which was the ordering's whole purpose. `edge` rather than `line` for the
 * quiet step: it is the role proven to clear 3:1 on every surface, so a bust week is still a mark
 * a reader can see rather than a smudge on the ground. The step below it, `line`, measures about
 * 1.15:1 on a daylight card and would draw a bust week as nothing at all.
 *
 * `bg-text-primary` is itself budgeted — it is the ink pill's fill — and this file carries an
 * allowlist entry in `accent-budget.source.test.ts` stating why a chart bar is not a pill.
 */
const BAR: Readonly<Record<"loud" | "ordinary" | "quiet", string>> = {
  loud: "bg-text-primary",
  ordinary: "bg-text-muted",
  quiet: "bg-edge",
};

/** The five-step verdict collapsed onto the three a bar can hold. */
function barWeight(comparison: StatComparison | undefined): keyof typeof BAR {
  const step = magnitudeStep(comparison);
  if (step === "strong" || step === "good") return "loud";
  if (step === "neutral") return "ordinary";
  return "quiet";
}

/** The tallest thing on the chart, and the denominator every bar is drawn against. Negative and
 *  zero weeks are excluded from it: a season whose best week is a fumble does not get a chart
 *  scaled to a negative number. */
function tallest(weeks: readonly SeasonWeek[]): number {
  return weeks.reduce((best, week) => Math.max(best, week.points ?? 0), 0);
}

/**
 * A SEASON AS ONE SHAPE — every week that has happened, drawn as a labelled bar.
 *
 * The point of the device is that you read a whole season in one glance instead of reconstructing
 * it from a table: the two-week hole in October, the three straight twenty-point weeks, the one
 * enormous outlier that is carrying his average. A per-week table has every one of those facts in
 * it and shows none of them.
 *
 * **ONLY WEEKS THAT ACTUALLY HAPPENED**, and the caller gates that on `stat_weeks`, never on
 * whether a stat line exists. Those are genuinely different questions here: this product's own
 * dataset carries stat lines for all seventeen weeks while only thirteen have been played, so a
 * chart built from "weeks with rows in `player_stat_lines`" would draw four weeks of the future
 * as though they were results. A bar is a claim that a game was played.
 *
 * **A WEEK HE DID NOT PLAY IS NOT A ZERO.** `points: null` draws no bar and prints no number: the
 * axis keeps its position so the season's shape stays honest about WHEN the hole was, and nothing
 * on the screen claims he scored nothing. Zero itself draws no bar either, because zero height IS
 * zero — but it prints its "0.0", which is the difference between the two states.
 *
 * **NO CAPTION, NO LEGEND, NO AXIS TITLE.** The bars are labelled and the weeks are numbered; a
 * chart that needs a sentence explaining what it shows has failed. `label` reaches assistive tech
 * and nowhere else, and every bar's own `Stat` announces its week, its number and the population
 * it was judged against.
 */
export function SeasonBars({ weeks, label, className = "" }: SeasonBarsProps) {
  // A season with nothing in it draws nothing at all rather than an empty frame with an
  // explanation inside it. The surface above decides what to say, if anything.
  //
  // "Nothing in it" is TWO states and both draw nothing, which the first rendered screenshot is
  // what caught: no week has been played yet, and every played week happened without him. The
  // second one used to draw thirteen empty columns under thirteen week numbers — an axis with no
  // chart on it, which a reader correctly reads as a rendering fault rather than as an absence.
  if (weeks.every((week) => week.points === null)) return null;
  const max = tallest(weeks);
  return (
    // Scrolls rather than compresses: seventeen columns squeezed into 360px is a barcode, and the
    // one thing this chart owes the reader is that two adjacent weeks are comparable by eye.
    <div role="group" aria-label={label} className={`flex items-end gap-1 overflow-x-auto pb-1 sm:gap-2 ${className}`}>
      {weeks.map((week) => {
        const points = week.points;
        // Height is a runtime number, so it reaches the DOM as a style — Tailwind's scanner
        // cannot see a class it never wrote down (`points-share-bar.tsx`'s own note).
        const height = points === null || points <= 0 || max <= 0 ? 0 : Math.max(2, Math.round((points / max) * 100));
        return (
          <div key={week.week} data-testid="season-week" data-week={week.week} className="flex min-w-12 flex-1 flex-col items-center gap-1">
            {points === null ? (
              // No number and no bar, but the column keeps its width — the hole is the fact.
              <span aria-hidden="true" className="text-text-faint">
                &nbsp;
              </span>
            ) : (
              <Stat srOnlyLabel size="sm" label={`Week ${week.week}`} value={points.toFixed(1)} comparison={week.comparison} />
            )}
            {/* The track is `aria-hidden` for the same reason `PointsShareBar`'s is: the number
                above it already says everything the geometry says, and a screen reader should
                hear the number. `items-end` grows every bar off the same baseline. */}
            <div aria-hidden="true" className="flex h-28 w-full items-end justify-center sm:h-40">
              {/* The bar is capped at 36px and centred rather than filling its column. The column
                  stretches so thirteen of them span the panel, and a bar that stretched with it
                  would be 100px wide and 130px tall on a desktop card — a row of tiles, not a
                  chart. A slim bar against a wide gap is what makes two adjacent weeks read as
                  two heights instead of two blocks. */}
              {height === 0 ? null : <div className={`w-full max-w-9 rounded-sm ${BAR[barWeight(week.comparison)]}`} style={{ height: `${height}%` }} />}
            </div>
            {/* The axis: the week number, in the one register this product shouts in. No axis
                title — a row of numbers under a row of bars in a fantasy product is a week
                count, and saying so in words would be the caption this chart refuses. */}
            <span aria-hidden="true" className={`${MICRO_LABEL} text-text-faint`}>{week.week}</span>
          </div>
        );
      })}
    </div>
  );
}
