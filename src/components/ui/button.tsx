import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-accent text-accent-text hover:brightness-110",
  secondary: "border border-border bg-surface-elevated text-text-primary hover:bg-surface",
  destructive: "bg-negative text-negative-text hover:brightness-110",
  ghost: "text-text-primary hover:bg-surface-elevated",
};

const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-md",
  lg: "h-12 px-6 text-lg",
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
