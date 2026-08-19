"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui";
import { AVATAR_PRESETS, avatarRefValue, type AvatarPresetKey } from "@/identity";

export interface AvatarPickerProps {
  /** The source of the initials fallback each tile's `Avatar` would show if it weren't a preset. */
  readonly displayName: string;
  readonly value: AvatarPresetKey | null;
  readonly onChange: (key: AvatarPresetKey) => void;
}

function wrap(index: number): number {
  return (index + AVATAR_PRESETS.length) % AVATAR_PRESETS.length;
}

/**
 * Eight mutually exclusive choices, so this is a RADIO GROUP, not eight unrelated buttons: a
 * screen reader announces "Shield, 1 of 8" rather than a run of identically-named buttons, and
 * arrow-key navigation works without any bespoke keyboard handling for the tab order itself —
 * only the WAI-ARIA "select on move" behavior below is this component's own.
 *
 * Roving tabindex (WAI-ARIA APG "Radio Group"): only the checked tile — or the first, when
 * nothing is chosen yet — is in the Tab order; arrow keys move focus AND selection together,
 * matching how a native `<input type="radio">` group behaves.
 */
export function AvatarPicker({ displayName, value, onChange }: AvatarPickerProps) {
  const labelId = useId();
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = value === null ? 0 : Math.max(0, AVATAR_PRESETS.findIndex((preset) => preset.key === value));

  const moveTo = (index: number): void => {
    const preset = AVATAR_PRESETS[index];
    if (preset === undefined) return;
    onChange(preset.key);
    tiles.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveTo(wrap(index + 1));
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveTo(wrap(index - 1));
        break;
      case "Home":
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        event.preventDefault();
        moveTo(AVATAR_PRESETS.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium text-text-primary">
        Avatar
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-3">
        {AVATAR_PRESETS.map((preset, index) => {
          const checked = value === preset.key;
          return (
            <button
              key={preset.key}
              ref={(el) => {
                tiles.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-posinset={index + 1}
              aria-setsize={AVATAR_PRESETS.length}
              tabIndex={index === selectedIndex ? 0 : -1}
              onClick={() => onChange(preset.key)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={
                "flex flex-col items-center gap-1 rounded-md border p-2 text-xs font-medium text-text-primary " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                (checked ? "border-accent bg-surface-elevated" : "border-border")
              }
            >
              <Avatar name={displayName} avatar={avatarRefValue(preset.key)} size="lg" />
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
