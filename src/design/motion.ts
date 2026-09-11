import { TOKENS } from "./tokens";

/**
 * THE ROOM'S MOTIONS, NAMED — one module, no per-component milliseconds (founder report
 * 2026-09-10, the draft room "feels fidgety"). Every figure here is a `TOKENS.motion` value, so
 * law 6's ceiling (*"nothing eases longer than 250ms"*) is enforced once in `tokens.test.ts`
 * and every named motion below inherits it; `motion.test.ts` asserts each one stays under it.
 *
 * Law 6 also says motion REPORTS and never performs: each entry is tied to something that
 * happened — a pick landed, a row left, a number changed — and nothing here runs on mount, on
 * scroll or on hover. The CSS classes live in `globals.css` and read the same tokens through
 * their generated custom properties (`--commish-motion-duration-*`), so a class and its named
 * motion cannot drift apart.
 */
export interface NamedMotion {
  /** ms */
  readonly durationMs: number;
  readonly easing: string;
  /** The `globals.css` class that carries this motion. */
  readonly className: string;
}

export const MOTION = {
  /** A pick settling into its board cell: opacity plus a small rise, eased out. */
  settle: { durationMs: TOKENS.motion.duration.base, easing: TOKENS.motion.easing.standard, className: "animate-cell-settle" },
  /** The same settle for a reader who asked for less motion: opacity only, no movement. */
  settleStill: { durationMs: TOKENS.motion.duration.base, easing: TOKENS.motion.easing.standard, className: "animate-cell-fade" },
  /** A list row moving to a new place (the FLIP transform). */
  reorder: { durationMs: TOKENS.motion.duration.base, easing: TOKENS.motion.easing.standard, className: "motion-reorder" },
  /** A row entering a list: a fade in. */
  enter: { durationMs: TOKENS.motion.duration.base, easing: TOKENS.motion.easing.standard, className: "animate-row-enter" },
  /** A row leaving a list: a fade out, held in the DOM only this long. */
  leave: { durationMs: TOKENS.motion.duration.fast, easing: TOKENS.motion.easing.standard, className: "animate-row-leave" },
  /** A figure that just changed (odds, a projection): the new value fades in over the old. */
  swap: { durationMs: TOKENS.motion.duration.fast, easing: TOKENS.motion.easing.standard, className: "animate-swap" },
  /** A board row taking a new height as the active window moves on: the height eases. */
  resize: { durationMs: TOKENS.motion.duration.base, easing: TOKENS.motion.easing.standard, className: "motion-resize" },
} as const satisfies Readonly<Record<string, NamedMotion>>;

export type MotionName = keyof typeof MOTION;

/** The rise a settling cell makes, px. Small enough to read as settling, never as arriving. */
export const SETTLE_RISE_PX = 3;
