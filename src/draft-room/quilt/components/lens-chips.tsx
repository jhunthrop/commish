"use client";

import { LENSES, LENS_LABEL, type Lens } from "../state/lens";

export interface LensChipsProps {
  readonly lens: Lens;
  readonly onChange: (lens: Lens) => void;
  /** BYES needs bye data to say anything; without it the chip does not render at all. */
  readonly hasByes: boolean;
}

/**
 * The lens switcher — four chips that recolor the quilt in place. `aria-pressed` toggles, the
 * same grammar the pool's position filters speak; the active chip wears the accent fill because
 * a lens is the network's own furniture (law 4 channel one), never a verdict.
 */
export function LensChips({ lens, onChange, hasByes }: LensChipsProps) {
  const lenses = LENSES.filter((candidate) => candidate !== "byes" || hasByes);
  return (
    <div role="group" aria-label="Board lens" className="flex items-center gap-1">
      {lenses.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={lens === candidate}
          onClick={() => onChange(candidate)}
          className={`rounded-sm px-2 py-0.5 font-display text-xs font-semibold tracking-wide focus-visible:outline-2 focus-visible:outline-accent ${
            lens === candidate ? "bg-accent text-accent-text" : "bg-surface-elevated text-text-muted"
          }`}
        >
          {LENS_LABEL[candidate]}
        </button>
      ))}
    </div>
  );
}
