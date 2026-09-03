import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "verb" | "secondary" | "destructive" | "live" | "ghost";
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
//   `opacity-90`, not a brightness shift: blending the fill toward the ground reads at the same
//   perceptual strength in BOTH themes, where brightness math is asymmetric — dimming near-white
//   ink is visible but deepening near-black ink moves ~3 RGB units and reads as no feedback
//   (Task 4 review LOW, controller-ruled fix).
// - `secondary` is the QUIET PILL — outlined, transparent. `border-edge`, not `border-line`:
//   a control boundary must clear 3:1 (`edge`'s asserted floor), a decorative separator does not.
// - `destructive` keeps its negative fill (red is live and clocks and danger — rule 1) and
//   joins the pill radius: shape belongs to the primitive family, only the fill differs.
// - `ghost` is unchanged — the radius moved from `BASE` into each variant so ghost could keep
//   its `rounded-md` while the real actions became pills.
//
// GAMEDAY ADDS `verb` (law 5, "the verb is obvious"). v3's rule 5 — one ink action per view —
// is the rule Gameday replaces outright, because it hid the primary action on exactly the
// screens built to repeat it: *"A draft board has a Draft on every row."* A board of forty rows
// cannot spend its one ink pill on row one and leave thirty-nine quiet outlines behind it.
//
// The fill is MONEY, and that is law 1 rather than a free choice: *"Money — entry, prizes,
// wallet. Also the fill of the verb, because pressing it is how money moves."* Green already
// meant "seats filling, value accruing"; the verb is the moment a manager causes that.
//
// Shape separates it from `primary` so the two never read as the same weight of act:
// - `primary` is the CEREMONIAL pill — one per view, the thing a page exists to do once
//   (create the league, confirm the trade). Ink on ground, `rounded-pill`.
// - `verb` is the REPEATED action — `rounded-md`, compact, the mock's own `0.4rem` radius. It is
//   allowed forty times on a screen, and looks like a control you press rather than a
//   destination you arrive at.
//
// This is why `button.tsx` is on `accent-budget.source.test.ts`'s fill allowlist: green as a
// control fill is now sanctioned in exactly one primitive, and still banned everywhere a call
// site might hand-roll it.
// THE RAIL REDESIGN ADDS `live` (2026-09-03, the founder-approved blueprint's WATCH LIVE):
// an OUTLINE in the red channel — red is the live family (law 1: a clock tightening, the live
// dot, `WeekStatusBadge`'s in_progress tone), and an outline rather than a fill because
// watching is not the page's one act, it is a doorway into a game already running. `verb`'s
// amber fill stays reserved for the single most-urgent act on the page (the amber budget:
// one solid), and `destructive` keeps the red FILL for the destructive family alone — the
// two red variants can never read as the same weight of act.
const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: "rounded-pill bg-text-primary text-surface hover:opacity-90",
  verb: "rounded-md bg-accent text-accent-text hover:opacity-90",
  secondary: "rounded-pill border border-edge bg-transparent text-text-primary hover:bg-surface-elevated",
  destructive: "rounded-pill bg-negative text-negative-text hover:brightness-110",
  live: "rounded-md border border-negative bg-transparent text-negative hover:bg-surface-elevated",
  ghost: "rounded-md text-text-primary hover:bg-surface-elevated",
};

// One step up across the scale (the big-feel pass, founder 2026-08-30): controls read as
// things you press from a sofa, not chrome you squint at.
const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: "min-h-9 px-3.5 text-sm",
  md: "min-h-11 px-5 text-md",
  lg: "min-h-13 px-7 text-lg",
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
