import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "verb" | "secondary" | "destructive" | "live" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
}

// `min-w-0` + `overflow-wrap: anywhere`: a button's label is often USER CONTENT ("Join <league
// name>") and a single unbroken name otherwise widens the button past its container and scrolls
// the whole page sideways at 360px. `anywhere`, not `break-words`: only `anywhere` both wraps
// and shrinks min-content. The press is the one motion a control makes, caused by the finger
// (120ms on the spring); the reduced-motion block in globals.css collapses it.
const BASE =
  "inline-flex min-w-0 items-center justify-center gap-2 [overflow-wrap:anywhere] font-semibold transition-[color,background-color,opacity,transform] active:scale-[0.97] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

/**
 * SIDELINE (P3, one action per moment): there is ONE solid button in the product, the Court blue
 * pill, and every other control is quiet.
 *
 * - `verb` and `primary` are the SAME pill: Court blue fill, its glow, pill radius. Two names
 *   survive because forty call sites spell one or the other; they never differ in weight of act
 *   again, and a viewport carries exactly one of them. `accent-budget.source.test.ts` keeps the
 *   fill inside this file.
 * - `secondary` is the QUIET pill: outlined in `edge` (a control boundary clears 3:1), no fill.
 * - `destructive` keeps its rose fill for the destructive family alone.
 * - `live` is an outline in the live green: a doorway into a game already running, not the
 *   page's one act.
 * - `ghost` is a text button on a 12px plate, for the controls that sit inside a row.
 *
 * The ink pill (`bg-text-primary`) is retired: Sideline has no black button.
 */
const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: "rounded-pill bg-accent text-accent-text shadow-verb-glow hover:opacity-90",
  verb: "rounded-pill bg-accent text-accent-text shadow-verb-glow hover:opacity-90",
  secondary: "rounded-pill border border-edge bg-transparent text-text-primary hover:bg-surface-raised",
  destructive: "rounded-pill bg-negative text-negative-text hover:opacity-90",
  live: "rounded-pill border border-live bg-transparent text-live hover:bg-surface-raised",
  ghost: "rounded-md text-text-primary hover:bg-surface-raised",
};

// The mock's heights: 32 for a control inside a row, 40 for the page's verb, 48 for a hero's.
const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: "min-h-8 px-3 text-sm",
  md: "min-h-10 px-4.5 text-md",
  lg: "min-h-12 px-6 text-lg",
};

/**
 * THE ONE spelling of what a button looks like: `Button` (the element form) and `ButtonLink`
 * (the anchor form) both render exactly this string, and the rare call site that must dress a
 * different element as a button imports this rather than hand-rolling the classes.
 */
export function buttonClassName(variant: ButtonVariant, size: ButtonSize, className = ""): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`.trimEnd();
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className = "", children, type = "button", ...rest },
  ref,
) {
  const isDisabled = disabled === true || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={buttonClassName(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
});
