import type { ReactElement, ReactNode } from "react";
import { MICRO_LABEL } from "./config";
import { LiveChip } from "./live-chip";

export interface LowerThirdCell {
  readonly label: string;
  readonly value: ReactNode;
  /** The clock, drawn at the hero size in the live channel. At most one per strip. */
  readonly clock?: boolean;
}

export interface LowerThirdProps {
  /**
   * THE BORROWED SENTENCE, SUNDAY ONLY. *"You need 11.4 from Cook"* is the whole screen at 4:25,
   * and it is the second of the two things Sideline takes from Under the Lights (section 5 of
   * `docs/design/2026-09-10-first-principles.md`). It leads the strip at display size, in the
   * room's own voice, and it is the only element here allowed above body size besides a `clock`.
   * Omitted off Sunday: the borrowing is bounded, and a lower third that has no sentence is a
   * plain strip of facts plus one verb, which is what every other screen gets.
   */
  readonly say?: ReactNode;
  /** Left to right, the facts the decision rests on. The verb is not one of these. */
  readonly cells: readonly LowerThirdCell[];
  /** The single act this screen is waiting on. Rendered last, in the one Court blue pill. */
  readonly action?: ReactNode;
  /** Live tops the strip in the live channel rather than the verb's own blue, and puts the
   *  breathing chip in front of the sentence. */
  readonly live?: boolean;
}

/**
 * EVERY SCREEN ENDS IN A LOWER THIRD.
 *
 * The broadcast convention: a strip across the foot carrying the clock, the subject, and one verb.
 * On a draft board that is the pick clock, who is queued, and Draft. On a matchup it is the game
 * state and the act the week is waiting on. On Sunday it is also the one sentence the afternoon has
 * come down to (`say`).
 *
 * WHY THIS SETTLES THE OLD ARGUMENT. P3 caps a viewport at one solid button, which would mean a
 * board whose whole purpose is one repeated verb had to render that verb quietly. The lower third
 * replaces the cap with a PLACE: this is where the verb lives, so the rest of the screen is free to
 * repeat the same act down a column without competing with it. The audit counts distinct verbs, not
 * instances, for exactly that reason.
 *
 * SIDELINE'S MATERIALS (2026-09-10). The strip was v5 furniture: a hard 3px rule over a flat
 * elevated panel with square corners and hairline-divided cells. It keeps the channel rule at the
 * top, because that is the strip's semantic colour and not decoration, and takes Sideline's
 * everything else — the 20px corners on the leading edge, the soft card shadow, and the display
 * face on the sentence. Nothing here animates: the strip is furniture, and P4 gives motion to
 * events only.
 *
 * If a screen has no lower third, either it needs no decision, or the decision is hidden. That is
 * the diagnostic this component exists to make obvious.
 */
export function LowerThird({ say, cells, action, live = false }: LowerThirdProps): ReactElement {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-t-xl border-t-[3px] bg-surface-elevated px-4 py-3 shadow-card ${
        live ? "border-live" : "border-accent"
      }`}
      data-live={live ? "true" : undefined}
    >
      {say === undefined ? null : (
        <p data-testid="lower-third-say" className="flex min-w-0 items-center gap-2.5 font-display text-xl font-bold leading-tight text-text-primary">
          {live ? <LiveChip>Live</LiveChip> : null}
          <span className="min-w-0">{say}</span>
        </p>
      )}
      <div className="flex flex-wrap items-stretch">
        {cells.map((cell) => (
          <div key={cell.label} className="flex flex-col justify-center border-r border-line px-4 first:pl-0 last:border-r-0">
            {/* The one sanctioned all-caps register (caps charter, S6) — imported, never
                hand-rolled, so the caps sweep keeps its single point of control. */}
            <span className={`${MICRO_LABEL} text-text-faint`}>{cell.label}</span>
            <span
              className={
                cell.clock === true
                  ? "font-display text-display-lg leading-display font-extrabold tabular-nums text-live"
                  : "font-display text-lg font-bold tabular-nums"
              }
            >
              {cell.value}
            </span>
          </div>
        ))}
      </div>
      {action === undefined ? null : <div className="ml-auto flex items-center">{action}</div>}
    </div>
  );
}
