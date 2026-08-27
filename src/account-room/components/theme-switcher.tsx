"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Panel } from "@/components/ui";
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

/** States the RESOLUTION in words, never just the choice — the addendum's own example
 *  ("Matching your device, which is dark right now") is exactly this: "system" is a fact about
 *  the screen it renders on, not a mystery third option next to two real ones. */
function resolutionSentence(theme: ThemePreference, systemPrefersDark: boolean): string {
  if (theme === "system") return `Matching your device, which is ${systemPrefersDark ? "dark" : "light"} right now.`;
  return theme === "dark" ? "Always dark, regardless of your device." : "Always light, regardless of your device.";
}

/**
 * The founder's both-themes ruling (2026-08-23), made real: a three-way choice over the existing
 * `useTheme`, not a toggle that pretends "system" does not exist. `ThemeProvider` already persists
 * the choice (`localStorage`, key `commish.theme`) and stamps `data-theme` on `<html>`; this
 * control only ever calls `setTheme`, the exact seam `ThemeProvider`'s own test drives through
 * `useTheme` directly — no new persistence, no new source of truth.
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
    <Panel title="Theme">
      <div className="flex flex-col gap-2">
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
        <p className="text-sm text-text-muted">{resolutionSentence(theme, systemPrefersDark)}</p>
      </div>
    </Panel>
  );
}
