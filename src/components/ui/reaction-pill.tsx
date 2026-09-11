"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

export interface ReactionPillProps {
  readonly emoji: string;
  /** How many people have landed this reaction. Zero renders the offer, quietly. */
  readonly count: number;
  /** The viewer is one of them. */
  readonly mine: boolean;
  readonly onToggle: () => void;
  readonly disabled?: boolean;
  /** Extra classes for the zero-count reveal the caller owns (hover intent on a row). */
  readonly className?: string;
}

/**
 * THE REACTION PILL (Sideline: "reactions attach to all of them" and "reactions pop from the
 * finger"). A chalk pill with the emoji and its count; yours wears the Court blue ring. When the
 * count rises the pill springs (240ms), and only then: the pop is the event, so nothing moves
 * on mount, on a re-render with the same count, or when the reader asked for less motion.
 * `aria-pressed` makes the toggle a toggle; the count is plain text inside the same button so
 * the accessible name stays "React with 🔥" while the number changes.
 */
export function ReactionPill({ emoji, count, mine, onToggle, disabled = false, className = "" }: ReactionPillProps) {
  const reduced = usePrefersReducedMotion();
  const previous = useRef(count);
  const [pops, setPops] = useState(0);
  useEffect(() => {
    if (count > previous.current) setPops((n) => n + 1);
    previous.current = count;
  }, [count]);
  const pop = !reduced && pops > 0;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={mine}
      aria-label={`React with ${emoji}`}
      onClick={onToggle}
      data-testid="reaction-pill"
      className={`inline-flex min-h-6 items-center gap-1 rounded-pill px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        mine ? "bg-surface text-text-primary ring-1 ring-accent" : "bg-surface text-text-muted hover:text-text-primary"
      } ${className}`.trimEnd()}
    >
      <span key={pops} aria-hidden="true" className={pop ? "inline-block animate-spring-in" : "inline-block"}>
        {emoji}
      </span>
      {count === 0 ? null : <span className="tabular-nums">{count}</span>}
    </button>
  );
}
