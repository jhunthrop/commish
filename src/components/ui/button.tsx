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
  "inline-flex min-w-0 items-center justify-center gap-2 [overflow-wrap:anywhere] rounded-md font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-accent text-accent-text hover:brightness-110",
  secondary: "border border-line bg-surface-elevated text-text-primary hover:bg-surface",
  destructive: "bg-negative text-negative-text hover:brightness-110",
  ghost: "text-text-primary hover:bg-surface-elevated",
};

const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: "min-h-8 px-3 text-sm",
  md: "min-h-10 px-4 text-md",
  lg: "min-h-12 px-6 text-lg",
};

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
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
});
