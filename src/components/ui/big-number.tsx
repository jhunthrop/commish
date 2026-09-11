import type { HTMLAttributes, ReactNode } from "react";

/** `sm` is a row's figure (20), `md` a card's (28), `lg` a hero's (44), `xl` a player page's (58). */
export type BigNumberSize = "sm" | "md" | "lg" | "xl";

export interface BigNumberProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The figure, already formatted by the caller. `null` renders a dash, never a zero. */
  readonly value: string | null;
  /**
   * WHAT THE NUMBER IS (P2, P11): the rules, the span, the population. "PPR a game, 2024 weeks 1
   * to 3", "of 12 seats", "projected, this week". For a `null` value the caption says why there
   * is no number ("no kicking line in this archive").
   *
   * A `ReactNode` and not a `string`, so a caption that is itself a live fact can wear the live
   * channel (the lineup row spends this slot on the opponent and kickoff, which turns green while
   * that game is running). It stays the caption either way: small, faint by default, never a
   * second number.
   */
  readonly basis: ReactNode;
  /** @default "md" */
  readonly size?: BigNumberSize;
  /** @default "end" */
  readonly align?: "start" | "end";
  /** A changed value slides up under the row's highlight wash: the caller passes the class it
   *  got from `useValueChangeHighlight`, and nothing animates on mount. */
  readonly changed?: boolean;
}

/** The caption's width is capped per step so it wraps under its figure instead of pushing the
 *  name beside it off a 360px row: the name is the largest thing on the row (P1), the caption the
 *  smallest. A row figure gets about seven rems, a card figure ten, a hero as much as it likes. */
const SIZE: Readonly<Record<BigNumberSize, { readonly value: string; readonly basis: string }>> = {
  sm: { value: "text-display-sm", basis: "max-w-[6.5rem] text-xs" },
  md: { value: "text-display-md", basis: "max-w-[10rem] text-xs" },
  lg: { value: "text-display-lg", basis: "text-sm" },
  xl: { value: "text-display-xl", basis: "text-sm" },
};

/**
 * THE ONE BIG NUMBER AND ITS BASIS (P2: every object shows one number larger than body text, and
 * that number carries a caption naming its basis in the same glance). The value is the display
 * face at 800 with tabular figures; the caption is small and faint and never omitted. A dash is
 * never a zero: `null` prints one, in the muted ink, and the caption says why.
 */
export function BigNumber({ value, basis, size = "md", align = "end", changed = false, className = "", ...rest }: BigNumberProps) {
  const step = SIZE[size];
  const absent = value === null;
  return (
    <span data-testid="big-number" className={`flex flex-col ${align === "end" ? "items-end text-right" : "items-start text-left"} ${className}`.trimEnd()} {...rest}>
      <span
        key={value ?? "dash"}
        data-absent={absent ? "true" : undefined}
        className={`font-display leading-display font-extrabold tabular-nums ${step.value} ${absent ? "text-text-muted" : "text-text-primary"} ${changed ? "animate-score-slide" : ""}`.trimEnd()}
      >
        {absent ? "–" : value}
      </span>
      {/* The caption wraps inside its own width rather than pushing the name beside it off a
          360px row: the name is the largest thing on the row (P1) and the caption is the smallest. */}
      <span className={`mt-0.5 leading-tight ${step.basis} text-text-faint`}>{basis}</span>
    </span>
  );
}
