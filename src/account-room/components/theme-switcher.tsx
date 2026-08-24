"use client";

import { useEffect, useId, useState } from "react";
import { Panel } from "@/components/ui";
import { useTheme, type ThemePreference } from "@/design/theme-provider";

const THEME_OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

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
 * A radio group, like `AvatarPicker`'s tone tiles: three mutually exclusive choices, one of which
 * is always selected, so a screen reader announces "System, 1 of 3" rather than three unrelated
 * buttons.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const systemPrefersDark = useSystemPrefersDark();
  const labelId = useId();

  return (
    <Panel title="Theme">
      <div className="flex flex-col gap-2">
        <div role="radiogroup" aria-labelledby={labelId} className="inline-flex w-fit rounded-md border border-line p-0.5">
          <span id={labelId} className="sr-only">
            Theme
          </span>
          {THEME_OPTIONS.map((option) => {
            const checked = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setTheme(option.value)}
                className={
                  "rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                  (checked ? "bg-surface-elevated text-text-primary" : "text-text-muted hover:text-text-primary")
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
