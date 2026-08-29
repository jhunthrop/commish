"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MICRO_LABEL } from "@/components/ui/config";
import { useTheme, type ThemePreference } from "@/design/theme-provider";

const THEME_OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function wrap(index: number): number {
  return (index + THEME_OPTIONS.length) % THEME_OPTIONS.length;
}

/** The same media query `tokens.css`'s own dark block answers to — kept as a literal here rather
 *  than imported, since `src/design/tokens.ts` is the CSS generator's own input, not a runtime
 *  vocabulary this component has any business reaching into. */
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Whether the DEVICE currently resolves to dark, independent of what this account has chosen.
 * Starts `false` and reads `matchMedia` after mount — the same "read the media query after mount,
 * never during render" idiom `usePrefersReducedMotion` (`@/design/use-reduced-motion`) already
 * uses, so the server-rendered markup and the client's first render agree. Kept local to this
 * component rather than added to `ThemeProvider`: nothing else needs it, and `ThemeProvider`'s own
 * job stops at applying and persisting a PREFERENCE, never at explaining what "system" resolves to
 * in words.
 */
function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(SYSTEM_DARK_QUERY);
    setPrefersDark(query.matches);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return prefersDark;
}

/**
 * States the RESOLUTION, never just the choice — "system" is a fact about the screen it renders
 * on, not a mystery third option next to two real ones.
 *
 * SUNDAY v5 turned this from a sentence into a VALUE. It sits in a lower third's fact cell now,
 * beside the control that sets it, and a lower third cell carries a reading rather than a
 * paragraph: the display face is a lettering face and this product never sets it on prose. The
 * two facts a reader wants are the same two either way — what you chose, and what that resolves
 * to on this screen right now.
 */
function resolutionValue(theme: ThemePreference, systemPrefersDark: boolean): string {
  if (theme === "system") return `System · ${systemPrefersDark ? "dark" : "light"} right now`;
  return theme === "dark" ? "Always dark" : "Always light";
}

/**
 * The founder's both-themes ruling (2026-08-23), made real: a three-way choice over the existing
 * `useTheme`, not a toggle that pretends "system" does not exist. `ThemeProvider` already persists
 * the choice (`localStorage`, key `commish.theme`) and stamps `data-theme` on `<html>`; this
 * control only ever calls `setTheme`, the exact seam `ThemeProvider`'s own test drives through
 * `useTheme` directly — no new persistence, no new source of truth.
 *
 * SUNDAY v5, LAW 6 — THIS IS THE ACCOUNT ROOM'S LOWER THIRD, and choosing it was the live
 * question on this route. Law 6 says every screen ends in a strip carrying the subject and one
 * verb, and if it has none, either it needs no decision or the decision is hidden. The self room
 * has no clock and no single act it is waiting on: every control on it is a setting that saves
 * itself where it sits, so the honest reading is the first branch. What it DOES have is one
 * decision that governs the whole product rather than this page — which theme this account reads
 * every screen in, the founder's both-themes ruling of 2026-08-23 made operable — and that is
 * what earns the foot.
 *
 * It is NOT the `LowerThird` primitive, deliberately. That component's `action` slot is "the
 * single act this screen is waiting on, rendered in the amber verb", and a three-way preference
 * is a control, not a verb; dropping a radio group into the verb slot would be the same category
 * error as putting a magnitude tint on a button. What this band borrows is the GEOMETRY — the
 * 3px amber rule across the foot, the micro-label over its reading — which is the part that makes
 * a screen look finished.
 *
 * A radio group, exactly like `AvatarPicker`'s tone tiles (fix round 1, F1): three mutually
 * exclusive choices, one of which is always selected, so a screen reader announces "System, 1 of
 * 3" rather than three unrelated buttons. ROVING TABINDEX (WAI-ARIA APG "Radio Group"), the same
 * pattern `AvatarPicker` already uses — only the checked option is in the Tab order, and arrow
 * keys move focus AND selection together, matching how a native `<input type="radio">` group
 * behaves. `theme` is never `null` (unlike `AvatarPicker`'s `value`), so `selectedIndex` needs no
 * "nothing chosen yet" fallback — one of the three is always current.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const systemPrefersDark = useSystemPrefersDark();
  const labelId = useId();
  const options = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = THEME_OPTIONS.findIndex((option) => option.value === theme);

  const moveTo = (index: number): void => {
    const option = THEME_OPTIONS[index];
    if (option === undefined) return;
    setTheme(option.value);
    options.current[index]?.focus();
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
        moveTo(THEME_OPTIONS.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t-[3px] border-accent bg-surface-elevated px-5 py-3">
      <div className="flex min-w-0 flex-col justify-center">
        <span className={`${MICRO_LABEL} text-text-faint`}>Theme</span>
        <span className="font-display text-xl font-bold text-text-primary">{resolutionValue(theme, systemPrefersDark)}</span>
      </div>
      <div className="ml-auto flex items-center">
        <div role="radiogroup" aria-labelledby={labelId} className="inline-flex w-fit rounded-md border border-line p-0.5">
          <span id={labelId} className="sr-only">
            Theme
          </span>
          {THEME_OPTIONS.map((option, index) => {
            const checked = theme === option.value;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  options.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-posinset={index + 1}
                aria-setsize={THEME_OPTIONS.length}
                tabIndex={index === selectedIndex ? 0 : -1}
                onClick={() => setTheme(option.value)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={
                  "rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                  // The chosen chip carries a boundary the surface cannot swallow (self review
                  // D3, 2026-08-27: elevated-on-elevated measured 1.00:1 in BOTH themes — the
                  // control that makes the both-themes ruling real could not show its state).
                  (checked ? "bg-surface-inset text-text-primary ring-1 ring-edge" : "text-text-muted hover:text-text-primary")
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
