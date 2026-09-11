import type { AvatarRing } from "./avatar";
import { BigNumber } from "./big-number";
import { LiveChip } from "./live-chip";
import { Manager } from "./manager";

export interface ScoreBugSide {
  /** The team this side is, as a `data-team-id` on its own half of the bug. A TEST CONTRACT: the
   *  Sunday spec pushes `score.update` frames keyed on real team ids and has no other way to
   *  learn them from the rendered page. Nothing on screen reads it. */
  readonly teamId?: string;
  /** The person. Never the team name alone (P1). */
  readonly managerName: string;
  readonly managerAvatar?: string | null;
  /** The team this manager runs, printed under their name. */
  readonly teamName: string;
  /** "9-4", "7-6". Already formatted: a bug does not decide how a league counts ties. */
  readonly record?: string;
  /** The live score, already formatted. `null` is "has not scored yet", never a zero. */
  readonly score: string | null;
  /** What the score is: "Yours", "Theirs". Printed under the figure at caption size. */
  readonly basis: string;
  /** From `useValueChangeHighlight`: the new figure slides up, and nothing else moves. */
  readonly changed?: boolean;
  /** Amber for you, rose for your rival. */
  readonly ring?: AvatarRing;
}

export interface ScoreBugProps {
  /** The reader's own side, drawn left. */
  readonly mine: ScoreBugSide;
  /** The rival, drawn right, mirrored so the two figures flank the middle. */
  readonly theirs: ScoreBugSide;
  /** The margin, already formatted and signed. `null` before either side has scored. */
  readonly margin: string | null;
  /** "Your lead", "Their lead", "Margin". */
  readonly marginLabel: string;
  /** One line under the margin: "9 of 15 games final". */
  readonly meta: string;
  /** True while any game in the week is running: the middle wears the live chip. */
  readonly live?: boolean;
  /** True once the margin is a different number than it was: the figure slides. */
  readonly marginChanged?: boolean;
  readonly className?: string;
}

/**
 * THE SCORE BUG — Under the Lights' broadcast bug, borrowed for Sunday only (section 5 of
 * `docs/design/2026-09-10-first-principles.md`: *"it borrows the score bug and the 'you need 11.4
 * from Cook' lower third from Under the Lights for Sunday only, because Sunday is a broadcast
 * whatever the rest of the week is"*). The borrowing is the SHAPE, not the package: no slab face,
 * no scarlet, no diagonal wipe. Sideline's materials carry it — a 20px card on the soft shadow,
 * faces in rings, the display face, the spring.
 *
 * **PEOPLE OUTSIDE, NUMBERS INSIDE.** The bug's whole geometry: each manager's face and name sit
 * at the outer edge and the two figures flank the middle, so the pair reads as one fixture rather
 * than as two scores 1,400px apart. `Manager` is what draws each side, which is P1 enforced by
 * construction: there is no prop here that renders a team name without the person above it.
 *
 * **ONLY THE LIVE EVENT MOVES (P4).** The two scores and the margin take `changed` from
 * `useValueChangeHighlight`; a changed figure slides its new value up (`BigNumber`'s own
 * `animate-score-slide`) and nothing else on the bug has an animation at all. The breathing dot
 * inside `LiveChip` is a clock, not a decoration.
 *
 * **THE LEAD IS NOT A COLOUR.** `Scoreboard`'s refusal, carried over verbatim: a matchup of two is
 * a pair and not a population, so nothing here is tinted by who is ahead. The margin prints its
 * sign, the label says whose lead it is, and both survive a monochrome screen. The one pigment the
 * middle spends is the live channel, which is a fact about the afternoon rather than a verdict
 * about the score.
 */
export function ScoreBug({ mine, theirs, margin, marginLabel, meta, live = false, marginChanged = false, className = "" }: ScoreBugProps) {
  return (
    <div
      data-testid="score-bug"
      data-live={live ? "true" : undefined}
      className={`grid items-center gap-x-6 gap-y-4 rounded-xl bg-surface-elevated p-5 shadow-card sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] ${className}`.trimEnd()}
    >
      <Side side={mine} align="start" />
      <div className="flex flex-col items-center gap-1.5 text-center">
        {live ? <LiveChip>Live</LiveChip> : null}
        <BigNumber value={margin} basis={meta} size="md" align="start" changed={marginChanged} className="items-center text-center" />
        <span className="text-xs text-text-faint">{marginLabel}</span>
      </div>
      <Side side={theirs} align="end" />
    </div>
  );
}

/**
 * One half of the bug. `flex-row-reverse` is what mirrors the away side without a second markup
 * branch, and it only engages from `sm` up: at 360px two display figures cannot flank anything, so
 * both sides stack in reading order and the middle falls between them.
 */
function Side({ side, align }: { readonly side: ScoreBugSide; readonly align: "start" | "end" }) {
  return (
    <div data-team-id={side.teamId} className={`flex min-w-0 items-center gap-4 ${align === "end" ? "sm:flex-row-reverse" : ""}`}>
      <Manager
        name={side.managerName}
        avatar={side.managerAvatar}
        size="lg"
        ring={side.ring}
        // A SEPARATOR NEEDS TWO SIDES (whole-branch review, LOW). A caller with no standings to
        // join falls back to an empty record, and the old `undefined` test let that through as
        // "Bay Bandits · " with nothing after it. Anything absent simply does not appear.
        meta={[side.teamName, side.record].filter((part) => part !== undefined && part !== "").join(" · ")}
        className="flex-1"
      />
      <BigNumber value={side.score} basis={side.basis} size="lg" align={align === "end" ? "start" : "end"} changed={side.changed} className="shrink-0" />
    </div>
  );
}
