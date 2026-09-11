"use client";

import { CHIP_SIZE, chipClassName, type ChipSize } from "./chip";

export interface SegmentOption {
  readonly value: string;
  readonly label: string;
}

/** `md` is the rail the filters wear; `sm` is the same strip inside a card row, where the
 *  choice is a setting beside content rather than a heading over it. */
/** The chip scale, shared with every other chip surface (`./chip`). */
export type SegmentGroupSize = ChipSize;

export interface SegmentGroupProps {
  /** The group's accessible name, and its visible micro-label when `labelled`. */
  readonly label: string;
  readonly options: readonly SegmentOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Render the label above the strip. Off where a heading already names the group. */
  readonly labelled?: boolean;
  /** @default "md" */
  readonly size?: SegmentGroupSize;
  readonly className?: string;
}

/**
 * THE SEGMENTED RAIL — one strip of flat segments, the active one filled amber on `accentText`
 * ink, in the rail register. The broadcast answer to "pick one of a few": /browse's filters wore
 * it first, the free-agents board hand-rolled it second, and the mock setup form was about to be
 * the third copy, which is the extraction rule this repo holds (`LiveMarker`'s own history).
 *
 * Amber is law 4's furniture channel and a filter or a setting is furniture — this is the one
 * fill that never claims to be a verdict or a verb. Buttons with `aria-pressed`, one per option,
 * mutually exclusive by construction; the active segment is also the only one in `accentText`,
 * so the choice survives a monochrome screen by contrast alone.
 *
 * A NATIVE `<select>` IS THE FALLBACK, NOT THE DEFAULT (founder, 2026-08-28, three surfaces in a
 * row: the lineup manager, this form): a dropdown hides its options behind a click and renders
 * in browser chrome. A segment strip shows every option at once, which is what makes a config
 * row readable at a glance. Keep selects for genuinely long lists (a 12-slot draft position is
 * the boundary case and gets pills, not this).
 */
export function SegmentGroup({ label, options, value, onChange, labelled = true, size = "md", className = "" }: SegmentGroupProps) {
  const step = CHIP_SIZE[size];
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {labelled ? <span className="text-sm font-medium text-text-primary">{label}</span> : null}
      {/* A row of PILL CHIPS — the mock's tabs. Inactive chips rest on the elevated fill; the
          chosen one takes Court blue. Same options, same one-glance readability, no hairline.
          The class comes from `chipClassName` (`./chip`), the one place it is spelled. */}
      <div className={`flex w-fit flex-wrap gap-1.5 ${step.rail}`} role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={chipClassName(value === option.value, size)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
