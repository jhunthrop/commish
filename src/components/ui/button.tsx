import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
}

// `min-w-0` + `overflow-wrap: anywhere`: a button's label is often USER CONTENT — "Join <league
// name>" — and a single unbroken name otherwise widens the button past its container and scrolls
// the whole page sideways at 360px.
//
// `anywhere`, NOT Tailwind's `break-words` (`overflow-wrap: break-word`), and the difference is
// the entire fix: `break-word` wraps text visually but is explicitly ignored when computing
// min-content width, so the button's anonymous flex item — which has no class to put `min-w-0`
// on — kept sizing itself to the unbroken word and overflowed anyway. `anywhere` is the one
// value that both wraps and shrinks min-content. It still only breaks a word that would not
// otherwise fit, so ordinary short labels are untouched.
//
// In the primitive, so every button that renders a name is safe by construction rather than one
// call site at a time.
const BASE =
  "inline-flex min-w-0 items-center justify-center gap-2 [overflow-wrap:anywhere] font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

// v3 "Sunday Standard" rule 5 (Task 4): one ink action per view, everything else quiet.
//
// - `primary` is the INK PILL — `bg-text-primary text-surface`, ink on ground: the mock's pill
//   IS the text color inverted, which is why no new role exists for it (self-ruling S2, and the
//   accent-budget sweep bans the spelling outside this file and `button-link.tsx`). Hover is
//   `brightness-90`: on the night theme the near-white ink visibly dims, on daylight the
//   near-black ink deepens — `110` would clip against white and read as no feedback at all.
// - `secondary` is the QUIET PILL — outlined, transparent. `border-edge`, not `border-line`:
//   a control boundary must clear 3:1 (`edge`'s asserted floor), a decorative separator does not.
// - `destructive` keeps its negative fill (red is live and clocks and danger — rule 1) and
//   joins the pill radius: shape belongs to the primitive family, only the fill differs.
// - `ghost` is unchanged — the radius moved from `BASE` into each variant so ghost could keep
//   its `rounded-md` while the real actions became pills.
//
// Accent survives here only as the focus ring, which was never a fill.
const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: "rounded-pill bg-text-primary text-surface hover:brightness-90",
  secondary: "rounded-pill border border-edge bg-transparent text-text-primary hover:bg-surface-elevated",
  destructive: "rounded-pill bg-negative text-negative-text hover:brightness-110",
  ghost: "rounded-md text-text-primary hover:bg-surface-elevated",
};

const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: "min-h-8 px-3 text-sm",
  md: "min-h-10 px-4 text-md",
  lg: "min-h-12 px-6 text-lg",
};

/**
 * THE ONE spelling of what a button looks like — `Button` (the element form) and `ButtonLink`
 * (the anchor form, `./button-link.tsx`) both render exactly this string, and the rare call
 * site that must dress a different element as a button (`SignInLink`, whose intent-carrying
 * href logic already owns its anchor) imports this rather than hand-rolling the classes the
 * accent-budget sweep bans (E8 was eleven hand-rolled copies of this string drifting apart).
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
