"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "commish.theme";

interface ThemeContextValue {
  readonly theme: ThemePreference;
  readonly setTheme: (t: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function apply(t: ThemePreference): void {
  const el = document.documentElement;
  if (t === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  // Initialize to "system" unconditionally so the server-rendered markup and the
  // client's first render match. Reading localStorage happens in an effect below,
  // after mount, to avoid a hydration mismatch (the initializer form of useState
  // runs during render, including hydration, where `window` already exists client
  // side but not server side).
  const [theme, setThemeState] = useState<ThemePreference>("system");

  useEffect(() => {
    setThemeState(readStored());
  }, []);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((t: ThemePreference) => {
    setThemeState(t);
    if (t === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, t);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error("useTheme must be used inside <ThemeProvider>.");
  return ctx;
}
