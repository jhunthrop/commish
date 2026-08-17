# Phase 1 Plan A — Foundation Completion & Scoring Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish everything the Phase 1 feature steps depend on — the design-system foundation (tokens, light+dark, primitives, a11y baseline), the shared LLM client, the stats-provider seam with a deterministic mock dataset loaded into Postgres, and the pure scoring engine at 100% coverage.

**Architecture:** Pure domain logic in `src/domain/` (no I/O, no ambient clock, `readonly` everywhere), Postgres via Drizzle as the system of record, a `StatsProvider` adapter interface (mock now, licensed feed later — a config change, not a rewrite), design tokens as a single TypeScript source of truth that generates the committed CSS, and every UI primitive tested for rendering in both themes plus an automated axe check.

**Tech Stack:** Next.js 15 (App Router) / React 19 / TypeScript strict; Tailwind v4 (CSS-first `@theme`); Drizzle + Postgres 17; Vitest + happy-dom + @testing-library/react + vitest-axe; `@anthropic-ai/sdk`; `tsx` for scripts.

**Spec:** `plans/fantasy-mvp-prototype.md` (Phase 1 blueprint, v6 — read its "Real-time & event architecture", "Design-system foundation" bullets under Step 1, and Step 2), with `docs/conventions.md` as the binding engineering conventions and `docs/research/2026-08-16-beating-apex-strategy.md` §4 as the product intent. Where the blueprint still says "prototype/stub", `docs/conventions.md` "Directive: no MVP" wins.

## Global Constraints

Copied from the spec/conventions — every task's requirements implicitly include these:

- **No MVP.** Nothing built in a form a later phase plans to throw away.
- **Immutability:** every domain type is `readonly`; arrays are `readonly T[]`; no mutation of inputs — return new objects.
- **No ambient clock** in `src/domain/**` or any reducer: no `Date.now()`, no `new Date()` without an injected `Clock`.
- **Config over magic numbers:** tunables live in a `config.ts`/`tokens.ts` next to the module; no inline literals.
- **Test-first.** Tests live beside code as `src/<feature>/**/*.test.ts(x)`; run with `npm test -- src/<dir>`. Integration tests use the real test Postgres via `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (already configured).
- **Coverage:** `src/scoring/**` must be 100% branches/functions/lines/statements (already configured as a threshold in `vitest.config.mts`).
- **Every user-visible surface:** designed for light **and** dark; passes `axe`; keyboard-operable; loading/empty/error/success states exist; renders at 360px width; copy is plain language, never raw error text.
- **WCAG 2.2 AA:** text on its surface ≥ 4.5:1 contrast; large text and non-text ≥ 3:1 — in both themes.
- **Motion respects `prefers-reduced-motion`.**
- **API envelope:** `{ ok: true, data }` / `{ ok: false, error }` via `src/lib/api/respond.ts`.
- **Verification for every task:** `npm run typecheck && npm run lint && npm test -- <dir>`; final task also `npm run build`.
- **Commits:** conventional commits; commit body says *why*.
- Do not modify `eslint.config.mjs` (hook-protected this session; pending rules live in `eslint.config.pending.mjs`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/design/tokens.ts` | **Single source of truth** for design tokens: color roles for light & dark, spacing, radii, type scale, motion. Typed, `as const`. |
| `src/design/contrast.ts` | Pure WCAG relative-luminance + contrast-ratio math. |
| `src/design/generate-css.ts` | Renders `tokens.ts` → CSS custom properties text (light on `:root`, dark under `[data-theme="dark"]` and `prefers-color-scheme` guarded by `:not([data-theme="light"])`). |
| `src/design/tokens.css` | **Generated, committed** output of the above. Imported by `globals.css`. A test asserts it matches regeneration. |
| `scripts/gen-tokens-css.ts` | CLI wrapper: writes `src/design/tokens.css`. `npm run tokens:build`. |
| `src/design/theme-provider.tsx` | Client component: `system \| light \| dark`, persisted in `localStorage`, stamps `data-theme` on `<html>`. |
| `src/components/ui/button.tsx`, `input.tsx`, `card.tsx`, `badge.tsx` | Core primitives. Each has built-in `loading`/`disabled` semantics where relevant. |
| `src/components/ui/skeleton.tsx`, `empty-state.tsx`, `error-state.tsx` | State primitives. `EmptyState`/`ErrorState` **require** an action — never a dead end. |
| `src/components/ui/icon.tsx` | The one icon wrapper (lucide-react). No ad-hoc inline SVG in feature code. |
| `src/components/ui/index.ts` | Barrel. |
| `docs/design-system.md` | The read-first visual doc for every UI step. |
| `src/lib/llm/config.ts`, `client.ts` | Shared Anthropic client. `isLLMEnabled()`, `generateCompletion()`; typed `LlmUnavailableError`. |
| `src/domain/player.ts` (modify) | Extend `StatLine` with kicker + defense stats. |
| `src/domain/scoring.ts` (modify) | Extend `ScoringSettings` for K/DEF; presets. |
| `src/stats/provider.ts` | `StatsProvider` interface — the seam a licensed feed plugs into later. |
| `src/stats/mock/generate-dataset.ts` | Deterministic (seeded PRNG) generator: 250 players, 17 weeks. |
| `src/stats/mock/dataset.json` | **Generated, committed** dataset. A test asserts byte-identical regeneration. |
| `src/stats/mock/mock-stats-provider.ts` | `StatsProvider` over the JSON. |
| `scripts/gen-mock-dataset.ts` | CLI wrapper. `npm run stats:generate`. |
| `src/db/schema.ts` (modify) | Add `players`, `player_stat_lines` tables. |
| `src/data/seed/index.ts`, `seed-players.ts` | The one seed entry point; loads the mock provider's data into Postgres. |
| `src/scoring/compute.ts` | `computeFantasyPoints(statLine, position, settings)`, `scoreRoster(...)`. |
| `src/scoring/presets.ts` | Re-exports presets from domain for the scoring module's public surface. |

Existing files this plan touches: `src/app/globals.css`, `src/app/layout.tsx`, `package.json` (scripts + deps), `src/db/schema.ts`, `src/db/test-db.ts`, `src/domain/player.ts`, `src/domain/scoring.ts`, `.env.example` (no change needed — `ANTHROPIC_API_KEY` already listed).

---

### Task 1: Design tokens — single source of truth, both themes, contrast-verified

**Files:**
- Create: `src/design/tokens.ts`
- Create: `src/design/contrast.ts`
- Test: `src/design/contrast.test.ts`, `src/design/tokens.test.ts`

**Interfaces:**
- Produces: `TOKENS` (`as const`) with `TOKENS.color.light` / `TOKENS.color.dark` keyed by semantic role; `contrastRatio(hexA, hexB): number`; `relativeLuminance(hex): number`. Later tasks import `TOKENS` and the role names below verbatim.

Color roles (identical keys in both themes): `surface`, `surfaceElevated`, `border`, `textPrimary`, `textMuted`, `accent`, `accentText` (text placed **on** an accent fill), `positive`, `negative`, `warning`.

- [ ] **Step 1: Write the failing contrast tests**

```ts
// src/design/contrast.test.ts
import { describe, it, expect } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
  it("accepts 3-digit hex", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and symmetric", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });
  it("is 1:1 for identical colors", () => {
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });
  it("throws a clear error for a non-hex input", () => {
    expect(() => contrastRatio("red", "#fff")).toThrow(/hex color/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/design`
Expected: FAIL — cannot find module `./contrast`.

- [ ] **Step 3: Implement contrast math (WCAG 2.x formula)**

```ts
// src/design/contrast.ts
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseHex(hex: string): readonly [number, number, number] {
  if (!HEX.test(hex)) throw new Error(`Expected a hex color like #1a2b3c, got "${hex}".`);
  const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c) : hex;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 .. 21. Order of arguments doesn't matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/design`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing token tests**

```ts
// src/design/tokens.test.ts
import { describe, it, expect } from "vitest";
import { TOKENS, type ThemeName, type ColorRole } from "./tokens";
import { contrastRatio } from "./contrast";

const THEMES: readonly ThemeName[] = ["light", "dark"];
const AA_TEXT = 4.5;
const AA_LARGE_AND_UI = 3;

// Every text/foreground role that sits directly on a surface must clear AA text contrast.
const TEXT_ON_SURFACE: readonly ColorRole[] = ["textPrimary", "textMuted", "accent", "positive", "negative", "warning"];

describe("TOKENS.color", () => {
  it("defines the same roles in both themes", () => {
    expect(Object.keys(TOKENS.color.light).sort()).toEqual(Object.keys(TOKENS.color.dark).sort());
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const c = TOKENS.color[theme];
      for (const role of TEXT_ON_SURFACE) {
        it(`${role} on surface ≥ ${AA_TEXT}:1`, () => {
          expect(contrastRatio(c[role], c.surface)).toBeGreaterThanOrEqual(AA_TEXT);
        });
        it(`${role} on surfaceElevated ≥ ${AA_TEXT}:1`, () => {
          expect(contrastRatio(c[role], c.surfaceElevated)).toBeGreaterThanOrEqual(AA_TEXT);
        });
      }
      it("accentText on accent (button label) ≥ 4.5:1", () => {
        expect(contrastRatio(c.accentText, c.accent)).toBeGreaterThanOrEqual(AA_TEXT);
      });
      it("border against surface ≥ 3:1 (non-text UI)", () => {
        expect(contrastRatio(c.border, c.surface)).toBeGreaterThanOrEqual(AA_LARGE_AND_UI);
      });
    });
  }
});

describe("TOKENS scales", () => {
  it("spacing is a strictly increasing 4px-based scale", () => {
    const vals = Object.values(TOKENS.space);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
    for (const v of vals) expect(v % 4).toBe(0);
  });
  it("type scale is strictly increasing", () => {
    const vals = Object.values(TOKENS.font.size);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
  });
  it("motion durations are strictly increasing", () => {
    const { fast, base, slow } = TOKENS.motion.duration;
    expect(fast).toBeLessThan(base);
    expect(base).toBeLessThan(slow);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npm test -- src/design`
Expected: FAIL — cannot find module `./tokens`.

- [ ] **Step 7: Implement the tokens**

The palette is deliberately not the AI-default cream/terracotta or near-black/acid-green. It's a cool, slightly green-biased neutral (a fantasy football product; green is the field, and it's the trust colour) with a turf-green accent. If any contrast test fails, **adjust the token value, never the threshold.**

```ts
// src/design/tokens.ts
export type ThemeName = "light" | "dark";

export type ColorRole =
  | "surface"
  | "surfaceElevated"
  | "border"
  | "textPrimary"
  | "textMuted"
  | "accent"
  | "accentText"
  | "positive"
  | "negative"
  | "warning";

type Palette = Readonly<Record<ColorRole, string>>;

const light: Palette = {
  surface: "#F4F6F5",
  surfaceElevated: "#FFFFFF",
  border: "#8F9A94",
  textPrimary: "#171B19",
  textMuted: "#586159",
  accent: "#0B6B47",
  accentText: "#FFFFFF",
  positive: "#136B49",
  negative: "#B0342A",
  warning: "#8A5A00",
};

const dark: Palette = {
  surface: "#0F1412",
  surfaceElevated: "#171D1A",
  border: "#5C6A62",
  textPrimary: "#ECEFEC",
  textMuted: "#A3AEA7",
  accent: "#4FC08D",
  accentText: "#0B1A12",
  positive: "#5CC995",
  negative: "#F07C70",
  warning: "#E5B054",
};

export const TOKENS = {
  color: { light, dark },
  /** 4px-based spacing scale, px. */
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 },
  radius: { sm: 4, md: 8, lg: 12, pill: 999 },
  font: {
    /** px */
    size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, "2xl": 28, "3xl": 36 },
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
    lineHeight: { tight: 1.2, base: 1.5 },
  },
  motion: {
    /** ms */
    duration: { fast: 120, base: 200, slow: 320 },
    easing: { standard: "cubic-bezier(0.2, 0, 0, 1)", emphasized: "cubic-bezier(0.3, 0, 0, 1)" },
  },
  /** Minimum supported viewport width, px (mobile-first baseline). */
  minViewport: 360,
} as const;
```

- [ ] **Step 8: Run to verify pass**

Run: `npm test -- src/design`
Expected: PASS. If a contrast assertion fails, darken/lighten that role's value until it passes and re-run.

- [ ] **Step 9: Commit**

```bash
git add src/design/contrast.ts src/design/contrast.test.ts src/design/tokens.ts src/design/tokens.test.ts
git commit -m "feat(design): design tokens as single source of truth, WCAG contrast-verified in both themes"
```

---

### Task 2: Generate `tokens.css` from `tokens.ts`, wire into globals, add ThemeProvider

**Files:**
- Create: `src/design/generate-css.ts`, `scripts/gen-tokens-css.ts`, `src/design/tokens.css` (generated), `src/design/theme-provider.tsx`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `package.json` (add script)
- Test: `src/design/generate-css.test.ts`, `src/design/theme-provider.test.tsx`

**Interfaces:**
- Consumes: `TOKENS` from Task 1.
- Produces: CSS custom properties `--color-<role-kebab>` (e.g. `--color-text-primary`), `--space-<n>`, `--radius-<k>`, `--font-size-<k>`, `--motion-duration-<k>`, `--motion-easing-<k>`; Tailwind theme aliases so classes like `bg-surface text-text-primary border-border` work; `<ThemeProvider>` client component; `useTheme(): { theme, setTheme }`.

- [ ] **Step 1: Write the failing generator test**

```ts
// src/design/generate-css.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderTokensCss } from "./generate-css";

describe("renderTokensCss", () => {
  const css = renderTokensCss();

  it("emits every light color role on :root as --color-<kebab>", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--color-text-primary:\s*#171B19/i);
    expect(css).toMatch(/:root\s*\{[^}]*--color-surface-elevated:\s*#FFFFFF/i);
  });

  it("emits dark values under [data-theme=\"dark\"] and under prefers-color-scheme guarded by :not([data-theme=\"light\"])", () => {
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{[^}]*--color-surface:\s*#0F1412/i);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*--color-surface:\s*#0F1412/i);
  });

  it("emits spacing, radius, font-size and motion vars", () => {
    expect(css).toContain("--space-4: 16px;");
    expect(css).toContain("--radius-md: 8px;");
    expect(css).toContain("--font-size-md: 16px;");
    expect(css).toContain("--motion-duration-base: 200ms;");
  });

  it("matches the committed src/design/tokens.css byte-for-byte (run `npm run tokens:build` after changing tokens.ts)", () => {
    const committed = readFileSync(resolve(process.cwd(), "src/design/tokens.css"), "utf8");
    expect(committed).toBe(css);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/design/generate-css`
Expected: FAIL — cannot find module `./generate-css`.

- [ ] **Step 3: Implement the generator**

```ts
// src/design/generate-css.ts
import { TOKENS, type ColorRole, type ThemeName } from "./tokens";

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/^(\d)/, "$1");
}

function colorVars(theme: ThemeName, indent: string): string {
  return (Object.keys(TOKENS.color[theme]) as ColorRole[])
    .map((role) => `${indent}--color-${kebab(role)}: ${TOKENS.color[theme][role]};`)
    .join("\n");
}

function scaleVars(prefix: string, obj: Readonly<Record<string, number | string>>, unit: string, indent: string): string {
  return Object.entries(obj)
    .map(([k, v]) => `${indent}--${prefix}-${kebab(k)}: ${typeof v === "number" ? `${v}${unit}` : v};`)
    .join("\n");
}

/** Renders TOKENS as CSS custom properties. Deterministic: same TOKENS → identical text. */
export function renderTokensCss(): string {
  const i = "  ";
  return [
    "/* GENERATED from src/design/tokens.ts by `npm run tokens:build` — do not edit by hand. */",
    ":root {",
    colorVars("light", i),
    scaleVars("space", TOKENS.space, "px", i),
    scaleVars("radius", TOKENS.radius, "px", i),
    scaleVars("font-size", TOKENS.font.size, "px", i),
    scaleVars("font-weight", TOKENS.font.weight, "", i),
    scaleVars("line-height", TOKENS.font.lineHeight, "", i),
    scaleVars("motion-duration", TOKENS.motion.duration, "ms", i),
    scaleVars("motion-easing", TOKENS.motion.easing, "", i),
    "}",
    "",
    ':root[data-theme="dark"] {',
    colorVars("dark", i),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    colorVars("dark", i + i),
    "  }",
    "}",
    "",
  ].join("\n");
}
```

```ts
// scripts/gen-tokens-css.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderTokensCss } from "../src/design/generate-css";

const out = resolve(process.cwd(), "src/design/tokens.css");
writeFileSync(out, renderTokensCss(), "utf8");
console.log(`wrote ${out}`);
```

Add to `package.json` scripts: `"tokens:build": "tsx scripts/gen-tokens-css.ts"`. Then run `npm run tokens:build` to create the committed file.

- [ ] **Step 4: Run to verify pass**

Run: `npm run tokens:build && npm test -- src/design/generate-css`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire tokens into Tailwind + globals**

Replace `src/app/globals.css` with:

```css
@import "tailwindcss";
@import "../design/tokens.css";

/* Tailwind v4 theme aliases → classes like bg-surface, text-text-primary, border-border, rounded-md */
@theme inline {
  --color-surface: var(--color-surface);
  --color-surface-elevated: var(--color-surface-elevated);
  --color-border: var(--color-border);
  --color-text-primary: var(--color-text-primary);
  --color-text-muted: var(--color-text-muted);
  --color-accent: var(--color-accent);
  --color-accent-text: var(--color-accent-text);
  --color-positive: var(--color-positive);
  --color-negative: var(--color-negative);
  --color-warning: var(--color-warning);
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
}

html { color-scheme: light dark; }
:root[data-theme="dark"] { color-scheme: dark; }
:root[data-theme="light"] { color-scheme: light; }

body {
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  line-height: var(--line-height-base);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 6: Write the failing ThemeProvider test**

```tsx
// src/design/theme-provider.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./theme-provider";

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={() => setTheme("system")}>system</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeProvider", () => {
  it("defaults to system and stamps nothing on <html>", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("setTheme('dark') stamps data-theme and persists", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => screen.getByText("dark").click());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("commish.theme")).toBe("dark");
  });

  it("restores a persisted choice on mount", () => {
    window.localStorage.setItem("commish.theme", "light");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("setTheme('system') removes the stamp", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => screen.getByText("dark").click());
    act(() => screen.getByText("system").click());
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `npm test -- src/design/theme-provider`
Expected: FAIL — cannot find module.

- [ ] **Step 8: Implement ThemeProvider**

```tsx
// src/design/theme-provider.tsx
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
  const [theme, setThemeState] = useState<ThemePreference>(readStored);

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
```

Wire it in `src/app/layout.tsx`: import `ThemeProvider` from `@/design/theme-provider`, wrap `{children}` with `<ThemeProvider>…</ThemeProvider>`, set `metadata` to `{ title: "Commish", description: "Season-long fantasy football, done right." }`, and add `suppressHydrationWarning` to `<html>` (the `data-theme` attribute is set client-side).

- [ ] **Step 9: Run to verify pass**

Run: `npm test -- src/design && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add src/design src/app/globals.css src/app/layout.tsx scripts/gen-tokens-css.ts package.json
git commit -m "feat(design): generated tokens.css, Tailwind theme aliases, ThemeProvider (system/light/dark)"
```

---

### Task 3: Core UI primitives — Button, Input, Card, Badge (both themes + axe)

**Files:**
- Create: `src/components/ui/button.tsx`, `input.tsx`, `card.tsx`, `badge.tsx`, `index.ts`
- Test: `src/components/ui/button.test.tsx`, `input.test.tsx`, `card.test.tsx`, `badge.test.tsx`
- Add dev dep: none. Add dep: `lucide-react` (used by Task 4; install here so `Button` can render a spinner icon).

**Interfaces:**
- Produces:
  - `Button` props: `variant?: "primary" | "secondary" | "destructive" | "ghost"`, `size?: "sm" | "md" | "lg"`, `loading?: boolean`, plus all native button props. When `loading`, it is `aria-busy`, disabled, and shows a spinner while keeping its label visible.
  - `Input` props: `label: string` (required — every input has a visible label), `error?: string`, `hint?: string`, plus native input props. `id` auto-generated with `useId` if not given; error text is linked via `aria-describedby` and sets `aria-invalid`.
  - `Card` props: `as?: "div" | "section" | "article"`, `padding?: keyof typeof TOKENS.space`, children.
  - `Badge` props: `tone?: "neutral" | "accent" | "positive" | "negative" | "warning"`.

Shared test helper for both themes — write it once here, reuse in Task 4:

```tsx
// src/components/ui/test-utils.tsx
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/** Renders in light, then dark, running the assertion in each. */
export function inBothThemes(ui: ReactElement, assert: (r: RenderResult, theme: "light" | "dark") => void | Promise<void>) {
  return (async () => {
    for (const theme of ["light", "dark"] as const) {
      document.documentElement.setAttribute("data-theme", theme);
      const r = render(ui);
      await assert(r, theme);
      r.unmount();
    }
    document.documentElement.removeAttribute("data-theme");
  })();
}
```

- [ ] **Step 1: Write the failing Button test**

```tsx
// src/components/ui/button.test.tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Button } from "./button";
import { inBothThemes } from "./test-utils";

describe("Button", () => {
  it("renders its label and calls onClick, in both themes, with no axe violations", async () => {
    await inBothThemes(<Button onClick={() => {}}>Draft player</Button>, async ({ container }) => {
      expect(screen.getByRole("button", { name: "Draft player" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("when loading: is disabled, aria-busy, keeps its label, and swallows clicks", () => {
    const onClick = vi.fn();
    const { getByRole } = require("@testing-library/react").render(<Button loading onClick={onClick}>Save</Button>);
    const btn = getByRole("button", { name: /Save/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies the variant class", () => {
    const { getByRole } = require("@testing-library/react").render(<Button variant="destructive">Delete</Button>);
    expect(getByRole("button").className).toMatch(/negative/);
  });
});
```

(Use a top-level `import { render } from "@testing-library/react"` instead of `require` — the snippet above shows intent; write it with imports.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/components/ui/button`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Install lucide-react and implement Button**

Run: `npm install lucide-react`

```tsx
// src/components/ui/button.tsx
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
  destructive: "bg-negative text-white hover:brightness-110",
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
```

- [ ] **Step 4: Run Button test to verify pass**

Run: `npm test -- src/components/ui/button`
Expected: PASS.

- [ ] **Step 5: Write failing tests for Input, Card, Badge**

```tsx
// src/components/ui/input.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Input } from "./input";
import { inBothThemes } from "./test-utils";

describe("Input", () => {
  it("has a visible label associated with the control, both themes, no axe violations", async () => {
    await inBothThemes(<Input label="League name" />, async ({ container }) => {
      expect(screen.getByLabelText("League name")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
  it("links error text via aria-describedby and sets aria-invalid", () => {
    render(<Input label="Email" error="Enter a valid email address." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Enter a valid email address.");
  });
  it("shows a hint when provided", () => {
    render(<Input label="Team name" hint="You can change this later." />);
    expect(screen.getByText("You can change this later.")).toBeInTheDocument();
  });
});
```

```tsx
// src/components/ui/card.test.tsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Card } from "./card";
import { inBothThemes } from "./test-utils";

describe("Card", () => {
  it("renders children as the requested element, both themes, no axe violations", async () => {
    await inBothThemes(<Card as="section" aria-label="Standings"><p>Row</p></Card>, async ({ container }) => {
      expect(screen.getByRole("region", { name: "Standings" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
```

```tsx
// src/components/ui/badge.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders text with a tone class", () => {
    render(<Badge tone="positive">Won</Badge>);
    expect(screen.getByText("Won").className).toMatch(/positive/);
  });
  it("defaults to neutral", () => {
    render(<Badge>Bench</Badge>);
    expect(screen.getByText("Bench").className).toMatch(/border/);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npm test -- src/components/ui`
Expected: FAIL for input/card/badge (Button passes).

- [ ] **Step 7: Implement Input, Card, Badge, and the barrel**

```tsx
// src/components/ui/input.tsx
import { forwardRef, useId, type InputHTMLAttributes } from "react";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly label: string;
  readonly error?: string;
  readonly hint?: string;
  readonly id?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id: givenId, className = "", ...rest },
  ref,
) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={
          "h-10 rounded-md border bg-surface-elevated px-3 text-md text-text-primary " +
          "placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          (error ? "border-negative " : "border-border ") +
          className
        }
        {...rest}
      />
      {hint ? <p id={hintId} className="text-sm text-text-muted">{hint}</p> : null}
      {error ? <p id={errorId} role="alert" className="text-sm text-negative">{error}</p> : null}
    </div>
  );
});
```

```tsx
// src/components/ui/card.tsx
import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "section" | "article";
}

export function Card({ as: Tag = "div", className = "", children, ...rest }: CardProps) {
  return (
    <Tag className={`rounded-lg border border-border bg-surface-elevated p-4 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
```

```tsx
// src/components/ui/badge.tsx
import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "accent" | "positive" | "negative" | "warning";

const TONE: Readonly<Record<BadgeTone, string>> = {
  neutral: "border border-border text-text-muted",
  accent: "bg-accent text-accent-text",
  positive: "text-positive border border-positive",
  negative: "text-negative border border-negative",
  warning: "text-warning border border-warning",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className = "", children, ...rest }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`} {...rest}>
      {children}
    </span>
  );
}
```

```ts
// src/components/ui/index.ts
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./button";
export { Input, type InputProps } from "./input";
export { Card, type CardProps } from "./card";
export { Badge, type BadgeProps, type BadgeTone } from "./badge";
```

- [ ] **Step 8: Run to verify pass**

Run: `npm test -- src/components/ui && npm run typecheck && npm run lint`
Expected: all PASS/clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui package.json package-lock.json
git commit -m "feat(ui): Button, Input, Card, Badge primitives — both themes, axe-clean, labeled/aria-wired"
```

---

### Task 4: State primitives (Skeleton, EmptyState, ErrorState), Icon wrapper, and `docs/design-system.md`

**Files:**
- Create: `src/components/ui/skeleton.tsx`, `empty-state.tsx`, `error-state.tsx`, `icon.tsx`
- Modify: `src/components/ui/index.ts`
- Create: `docs/design-system.md`
- Test: `src/components/ui/states.test.tsx`, `src/components/ui/icon.test.tsx`

**Interfaces:**
- Produces:
  - `Skeleton` props: `lines?: number` (default 3), `className?`. Renders `aria-busy="true"` `aria-live="polite"` container with a visually-hidden "Loading…" text.
  - `EmptyState` props: `title: string`, `description?: string`, `action: ReactNode` (**required** — never a dead end), `icon?: IconName`.
  - `ErrorState` props: `title: string`, `description?: string`, `action: ReactNode` (**required**), `role` defaults to `alert`.
  - `Icon` props: `name: IconName` (a curated union: `"trophy" | "users" | "clock" | "alert-triangle" | "inbox" | "refresh-cw" | "check" | "x" | "chevron-right" | "search"`), `size?: number` (default 20), `label?: string` (if given, `role="img"` + `aria-label`; else `aria-hidden`).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/ui/states.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { Button } from "./button";
import { inBothThemes } from "./test-utils";

describe("Skeleton", () => {
  it("is aria-busy and announces loading to screen readers", () => {
    render(<Skeleton lines={2} />);
    const el = screen.getByText("Loading…").parentElement!;
    expect(el).toHaveAttribute("aria-busy", "true");
  });
});

describe("EmptyState", () => {
  it("renders title, description and the required action, both themes, no axe violations", async () => {
    await inBothThemes(
      <EmptyState title="No leagues yet" description="Create one or join a public league." action={<Button>Create a league</Button>} icon="inbox" />,
      async ({ container }) => {
        expect(screen.getByRole("heading", { name: "No leagues yet" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Create a league" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});

describe("ErrorState", () => {
  it("is an alert with a recovery action", async () => {
    render(<ErrorState title="Couldn't load standings" description="Check your connection and try again." action={<Button>Retry</Button>} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load standings");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
```

```tsx
// src/components/ui/icon.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "./icon";

describe("Icon", () => {
  it("is decorative (aria-hidden) by default", () => {
    const { container } = render(<Icon name="trophy" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
  it("is an accessible image when given a label", () => {
    const { getByRole } = render(<Icon name="trophy" label="Champion" />);
    expect(getByRole("img", { name: "Champion" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/components/ui`
Expected: FAIL for the four new modules.

- [ ] **Step 3: Implement**

```tsx
// src/components/ui/icon.tsx
import { AlertTriangle, Check, ChevronRight, Clock, Inbox, RefreshCw, Search, Trophy, Users, X, type LucideIcon } from "lucide-react";

const ICONS = {
  trophy: Trophy,
  users: Users,
  clock: Clock,
  "alert-triangle": AlertTriangle,
  inbox: Inbox,
  "refresh-cw": RefreshCw,
  check: Check,
  x: X,
  "chevron-right": ChevronRight,
  search: Search,
} as const satisfies Readonly<Record<string, LucideIcon>>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  /** When provided the icon is announced as an image; otherwise it is decorative. */
  readonly label?: string;
  readonly className?: string;
}

/** The one icon entry point. Feature code never imports lucide-react directly. */
export function Icon({ name, size = 20, label, className }: IconProps) {
  const Cmp = ICONS[name];
  return label !== undefined ? (
    <Cmp role="img" aria-label={label} width={size} height={size} className={className} />
  ) : (
    <Cmp aria-hidden="true" width={size} height={size} className={className} />
  );
}
```

```tsx
// src/components/ui/skeleton.tsx
export interface SkeletonProps {
  readonly lines?: number;
  readonly className?: string;
}

export function Skeleton({ lines = 3, className = "" }: SkeletonProps) {
  return (
    <div aria-busy="true" aria-live="polite" className={`flex flex-col gap-2 ${className}`}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-4 animate-pulse rounded-sm bg-border/40" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}
```

```tsx
// src/components/ui/empty-state.tsx
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  /** Required: an empty state always offers a next step. */
  readonly action: ReactNode;
  readonly icon?: IconName;
}

export function EmptyState({ title, description, action, icon = "inbox" }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Icon name={icon} size={28} className="text-text-muted" />
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      {description ? <p className="max-w-prose text-sm text-text-muted">{description}</p> : null}
      <div>{action}</div>
    </div>
  );
}
```

```tsx
// src/components/ui/error-state.tsx
import type { ReactNode } from "react";
import { Icon } from "./icon";

export interface ErrorStateProps {
  readonly title: string;
  readonly description?: string;
  /** Required: an error state always offers a way forward (retry, go back, contact support). */
  readonly action: ReactNode;
}

export function ErrorState({ title, description, action }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-negative/40 bg-surface-elevated p-8 text-center">
      <Icon name="alert-triangle" size={28} className="text-negative" />
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      {description ? <p className="max-w-prose text-sm text-text-muted">{description}</p> : null}
      <div>{action}</div>
    </div>
  );
}
```

Add to `src/components/ui/index.ts`:

```ts
export { Skeleton, type SkeletonProps } from "./skeleton";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { ErrorState, type ErrorStateProps } from "./error-state";
export { Icon, type IconName, type IconProps } from "./icon";
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/components/ui && npm run typecheck && npm run lint`
Expected: PASS/clean.

- [ ] **Step 5: Write `docs/design-system.md`**

```markdown
# Commish — Design System

**Read this before building any user-visible surface**, alongside `docs/conventions.md`. Everything here is enforced by tests where it can be, and by review where it can't.

## Principles
- **Delightful, not merely functional.** The product thesis (strategy doc §4) is that this category feels flat and we won't. Optimistic UI, celebration moments, motion with intent.
- **Both themes are first-class.** Every surface is designed and tested in light and dark. No color exists only in one theme.
- **Accessible by default.** WCAG 2.2 AA. Every input has a visible label. Every icon is decorative or labeled. Keyboard-operable primary flows. `prefers-reduced-motion` honored globally.
- **Never a dead end.** Empty and error states always offer an action.
- **Mobile-first.** Minimum viewport 360px.

## Tokens
Single source of truth: `src/design/tokens.ts` → generated `src/design/tokens.css` (`npm run tokens:build`; a test fails if they drift). Use tokens via Tailwind aliases:
- Surfaces: `bg-surface`, `bg-surface-elevated`, `border-border`
- Text: `text-text-primary`, `text-text-muted`
- Accent: `bg-accent text-accent-text` (buttons/links), `text-accent`
- Semantic: `text-positive` / `text-negative` / `text-warning` (semantic color is *not* the accent)
- Radii: `rounded-sm|md|lg`; spacing via Tailwind's default 4px scale (matches `TOKENS.space`)
- **No raw hex, no raw px in feature code.**

## Theming
`<ThemeProvider>` (in `layout.tsx`) manages `system | light | dark`, persisted, stamping `data-theme` on `<html>`. Default is system.

## Primitives (`src/components/ui`)
`Button` (variants primary/secondary/destructive/ghost; `loading` = aria-busy + disabled + spinner, label stays), `Input` (label required; error → `aria-invalid` + `aria-describedby`), `Card`, `Badge`, `Skeleton` (aria-busy, announces "Loading…"), `EmptyState` / `ErrorState` (action required), `Icon` (curated `IconName` union; feature code never imports lucide directly).

## Motion
`TOKENS.motion` — fast 120ms / base 200ms / slow 320ms. Use motion for state changes and moments that matter (a pick landing, a win). Never decorative loops. Reduced-motion is globally respected in `globals.css`.

## Copy
Plain language, active voice, specific. Errors say what happened and what to do next. No raw exception/DB text ever reaches a user.

## Checklist for every UI step (from `docs/conventions.md`)
Design review against this doc · light + dark verified · loading/empty/error/success states exist · `axe` clean + keyboard walkthrough · copy review · works at 360px.
```

- [ ] **Step 6: Commit**

```bash
git add src/components/ui docs/design-system.md
git commit -m "feat(ui): Skeleton/EmptyState/ErrorState/Icon primitives; docs/design-system.md"
```

---

### Task 5: Shared LLM client — degrades gracefully with no key

**Files:**
- Create: `src/lib/llm/config.ts`, `src/lib/llm/client.ts`
- Test: `src/lib/llm/client.test.ts`

**Interfaces:**
- Produces:
  - `isLLMEnabled(env?: NodeJS.ProcessEnv): boolean` — true iff `ANTHROPIC_API_KEY` is a non-empty string.
  - `class LlmUnavailableError extends Error` (name `"LlmUnavailableError"`).
  - `createLlmClient(deps?: { env?: NodeJS.ProcessEnv; sdk?: AnthropicLike }): LlmClient` where `LlmClient = { generateCompletion(input: { system: string; user: string; maxTokens?: number }): Promise<{ text: string; inputTokens: number; outputTokens: number }> }`. When disabled, `generateCompletion` **rejects with `LlmUnavailableError` synchronously-predictably** (no network call).
  - `getLlmClient(): LlmClient` process singleton.
  - `LLM_CONFIG = { model: "claude-sonnet-4-5", defaultMaxTokens: 1024 }`.
  - `AnthropicLike` = the narrow slice of the SDK the client uses, so tests inject a fake: `{ messages: { create(params): Promise<{ content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } }> } }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/llm/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { createLlmClient, isLLMEnabled, LlmUnavailableError, type AnthropicLike } from "./client";

describe("isLLMEnabled", () => {
  it("is false when the key is missing or empty", () => {
    expect(isLLMEnabled({})).toBe(false);
    expect(isLLMEnabled({ ANTHROPIC_API_KEY: "" })).toBe(false);
  });
  it("is true when the key is set", () => {
    expect(isLLMEnabled({ ANTHROPIC_API_KEY: "sk-ant-test" })).toBe(true);
  });
});

describe("createLlmClient", () => {
  it("rejects with LlmUnavailableError and never calls the SDK when disabled", async () => {
    const create = vi.fn();
    const client = createLlmClient({ env: {}, sdk: { messages: { create } } });
    await expect(client.generateCompletion({ system: "s", user: "u" })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns text and token usage from the SDK when enabled", async () => {
    const sdk: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Start Mahomes." }],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
      },
    };
    const client = createLlmClient({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, sdk });
    const out = await client.generateCompletion({ system: "You are a fantasy advisor.", user: "Who do I start?" });
    expect(out).toEqual({ text: "Start Mahomes.", inputTokens: 12, outputTokens: 4 });
    expect(sdk.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ system: "You are a fantasy advisor.", messages: [{ role: "user", content: "Who do I start?" }] }),
    );
  });

  it("concatenates multiple text blocks and ignores non-text blocks", async () => {
    const sdk: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "A" }, { type: "tool_use" }, { type: "text", text: "B" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };
    const client = createLlmClient({ env: { ANTHROPIC_API_KEY: "k" }, sdk });
    expect((await client.generateCompletion({ system: "s", user: "u" })).text).toBe("AB");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/llm`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/lib/llm/config.ts
export const LLM_CONFIG = {
  model: "claude-sonnet-4-5",
  defaultMaxTokens: 1024,
} as const;
```

```ts
// src/lib/llm/client.ts
import Anthropic from "@anthropic-ai/sdk";
import { LLM_CONFIG } from "./config";

export class LlmUnavailableError extends Error {
  constructor(message = "AI features are unavailable: ANTHROPIC_API_KEY is not configured.") {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export function isLLMEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.length > 0;
}

/** The narrow slice of the Anthropic SDK this module uses — injectable in tests. */
export interface AnthropicLike {
  readonly messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: readonly { role: "user"; content: string }[];
    }): Promise<{
      content: readonly { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export interface CompletionInput {
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
}

export interface CompletionResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmClient {
  generateCompletion(input: CompletionInput): Promise<CompletionResult>;
}

interface Deps {
  readonly env?: NodeJS.ProcessEnv;
  readonly sdk?: AnthropicLike;
}

export function createLlmClient({ env = process.env, sdk }: Deps = {}): LlmClient {
  const enabled = isLLMEnabled(env);
  const client: AnthropicLike | null = enabled ? (sdk ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })) : null;

  return {
    async generateCompletion(input) {
      if (client === null) throw new LlmUnavailableError();
      const res = await client.messages.create({
        model: LLM_CONFIG.model,
        max_tokens: input.maxTokens ?? LLM_CONFIG.defaultMaxTokens,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      });
      const text = res.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    },
  };
}

let singleton: LlmClient | undefined;

/** Process-wide client bound to process.env. Features call this; tests call createLlmClient with fakes. */
export function getLlmClient(): LlmClient {
  if (singleton === undefined) singleton = createLlmClient();
  return singleton;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/lib/llm && npm run typecheck`
Expected: PASS (5 tests); typecheck clean. If the SDK's `messages.create` type doesn't structurally match `AnthropicLike`, cast at the single construction site: `new Anthropic({ apiKey }) as unknown as AnthropicLike` — and add a one-line comment saying why.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm
git commit -m "feat(llm): shared Anthropic client with isLLMEnabled() and LlmUnavailableError degrade path"
```

---

### Task 6: Extend domain stat lines & scoring settings for K/DEF; `StatsProvider` seam; deterministic mock dataset

**Files:**
- Modify: `src/domain/player.ts`, `src/domain/scoring.ts`
- Create: `src/stats/provider.ts`, `src/stats/mock/generate-dataset.ts`, `src/stats/mock/mock-stats-provider.ts`, `scripts/gen-mock-dataset.ts`, `src/stats/mock/dataset.json` (generated)
- Modify: `package.json` (script `stats:generate`)
- Test: `src/stats/mock/generate-dataset.test.ts`, `src/stats/mock/mock-stats-provider.test.ts`

**Interfaces:**
- Modifies `StatLine` (in `src/domain/player.ts`) to add: `fieldGoalsMade`, `extraPointsMade`, `sacks`, `defensiveInterceptions`, `defensiveTouchdowns` (all `number`, 0 for non-applicable positions).
- Modifies `ScoringSettings` (in `src/domain/scoring.ts`) to add: `pointsPerFieldGoal`, `pointsPerExtraPoint`, `pointsPerSack`, `pointsPerDefensiveInterception`, `pointsPerDefensiveTouchdown`. All presets set: FG 3, XP 1, sack 1, DEF INT 2, DEF TD 6.
- Produces:
  - `interface StatsProvider { listPlayers(): Promise<readonly Player[]>; getWeeklyStatLines(week: number): Promise<readonly StatLine[]>; }` in `src/stats/provider.ts`.
  - `generateDataset(seed: number): Dataset` where `Dataset = { readonly players: readonly Player[]; readonly statLines: readonly StatLine[] }` — 250 players, weeks 1..17, deterministic for a given seed. `DATASET_SEED = 20260817`, `PLAYER_COUNT = 250`, `SEASON_WEEKS = 17` in the same file (`as const`).
  - `createMockStatsProvider(dataset?: Dataset): StatsProvider` reading `dataset.json` by default.

- [ ] **Step 1: Extend the domain types (no test needed — types; existing tests must still pass)**

In `src/domain/player.ts`, extend `StatLine`:

```ts
export interface StatLine {
  readonly playerId: string;
  readonly week: number;
  readonly passingYards: number;
  readonly passingTouchdowns: number;
  readonly interceptions: number;
  readonly rushingYards: number;
  readonly rushingTouchdowns: number;
  readonly receivingYards: number;
  readonly receivingTouchdowns: number;
  readonly receptions: number;
  readonly fumblesLost: number;
  readonly fieldGoalsMade: number;
  readonly extraPointsMade: number;
  readonly sacks: number;
  readonly defensiveInterceptions: number;
  readonly defensiveTouchdowns: number;
}
```

In `src/domain/scoring.ts`, extend `ScoringSettings` with the five new fields listed above and add to `STANDARD_SCORING`: `pointsPerFieldGoal: 3, pointsPerExtraPoint: 1, pointsPerSack: 1, pointsPerDefensiveInterception: 2, pointsPerDefensiveTouchdown: 6` (the PPR/HALF/TE presets spread from STANDARD so they inherit these). Also add to `src/db/schema.ts` `scoringSettings` table the matching five `real()` columns (`points_per_field_goal` etc., `.notNull()`) — and regenerate/apply the migration in Task 7 (do not run drizzle here).

Run: `npm run typecheck && npm test -- src/db src/domain`
Expected: typecheck clean; existing tests still pass (the DB test inserts a preset that now includes the new keys — the schema columns are added in Task 7, so if the DB test fails on unknown columns here, that is expected until Task 7 applies the migration; note it and proceed).

- [ ] **Step 2: Write the failing dataset generator test**

```ts
// src/stats/mock/generate-dataset.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDataset, DATASET_SEED, PLAYER_COUNT, SEASON_WEEKS } from "./generate-dataset";

describe("generateDataset", () => {
  const ds = generateDataset(DATASET_SEED);

  it("produces exactly PLAYER_COUNT players with unique ids and valid positions", () => {
    expect(ds.players).toHaveLength(PLAYER_COUNT);
    expect(new Set(ds.players.map((p) => p.id)).size).toBe(PLAYER_COUNT);
    for (const p of ds.players) expect(["QB", "RB", "WR", "TE", "K", "DEF"]).toContain(p.position);
  });

  it("produces one stat line per player per week for SEASON_WEEKS weeks", () => {
    expect(ds.statLines).toHaveLength(PLAYER_COUNT * SEASON_WEEKS);
    const weeks = new Set(ds.statLines.map((s) => s.week));
    expect([...weeks].sort((a, b) => a - b)).toEqual(Array.from({ length: SEASON_WEEKS }, (_, i) => i + 1));
  });

  it("is deterministic: same seed → deep-equal output; different seed → different output", () => {
    expect(generateDataset(DATASET_SEED)).toEqual(ds);
    expect(generateDataset(DATASET_SEED + 1)).not.toEqual(ds);
  });

  it("gives position-appropriate stats (a K never has passing yards; a QB never kicks)", () => {
    const byId = new Map(ds.players.map((p) => [p.id, p]));
    for (const s of ds.statLines) {
      const pos = byId.get(s.playerId)!.position;
      if (pos === "K") { expect(s.passingYards).toBe(0); expect(s.receptions).toBe(0); }
      if (pos === "QB") { expect(s.fieldGoalsMade).toBe(0); expect(s.sacks).toBe(0); }
      if (pos !== "DEF") { expect(s.sacks).toBe(0); expect(s.defensiveInterceptions).toBe(0); }
    }
  });

  it("matches the committed dataset.json byte-for-byte (run `npm run stats:generate` after changing the generator)", () => {
    const committed = readFileSync(resolve(process.cwd(), "src/stats/mock/dataset.json"), "utf8");
    expect(committed).toBe(JSON.stringify(ds, null, 2) + "\n");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/stats`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement the generator + script**

```ts
// src/stats/mock/generate-dataset.ts
import type { Player, Position, StatLine } from "@/domain/player";

export const DATASET_SEED = 20260817;
export const PLAYER_COUNT = 250;
export const SEASON_WEEKS = 17;

export interface Dataset {
  readonly players: readonly Player[];
  readonly statLines: readonly StatLine[];
}

/** mulberry32 — small, fast, deterministic PRNG. Returns floats in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NFL_TEAMS = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS"] as const;

const FIRST = ["Jalen","Marcus","DeShawn","Tyler","Malik","Jordan","Caleb","Xavier","Elijah","Kenny","Trey","Rashad","Bryce","Devon","Isaiah","Cam","Zach","Jaylen","Andre","Kyle","Drake","Chris","Josh","Justin","Amari"] as const;
const LAST = ["Harris","Walker","Johnson","Brooks","Reed","Carter","Mitchell","Bell","Hill","Watson","Robinson","Sanders","Cook","Green","Adams","Jenkins","Coleman","Price","Ward","Powell","Barnes","Fisher","Hayes","Perry","Long"] as const;

/** Position mix for 250 players: 30 QB, 70 RB, 80 WR, 30 TE, 20 K, 20 DEF. */
const POSITION_PLAN: readonly { readonly position: Position; readonly count: number }[] = [
  { position: "QB", count: 30 },
  { position: "RB", count: 70 },
  { position: "WR", count: 80 },
  { position: "TE", count: 30 },
  { position: "K", count: 20 },
  { position: "DEF", count: 20 },
];

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}
function int(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
/** Chance-weighted small counts (TDs, INTs). */
function count(rand: () => number, p: number, max: number): number {
  let n = 0;
  for (let i = 0; i < max; i++) if (rand() < p) n++;
  return n;
}

function statLineFor(rand: () => number, player: Player, week: number): StatLine {
  const zero: StatLine = {
    playerId: player.id, week,
    passingYards: 0, passingTouchdowns: 0, interceptions: 0,
    rushingYards: 0, rushingTouchdowns: 0,
    receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
    fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
  };
  // ~6% chance of a zero line (bye/injury), except DEF which always plays.
  if (player.position !== "DEF" && rand() < 0.06) return zero;
  switch (player.position) {
    case "QB": return { ...zero, passingYards: int(rand, 150, 380), passingTouchdowns: count(rand, 0.45, 4), interceptions: count(rand, 0.3, 2), rushingYards: int(rand, 0, 45), rushingTouchdowns: count(rand, 0.12, 1), fumblesLost: count(rand, 0.06, 1) };
    case "RB": return { ...zero, rushingYards: int(rand, 20, 140), rushingTouchdowns: count(rand, 0.3, 2), receptions: int(rand, 0, 6), receivingYards: int(rand, 0, 55), receivingTouchdowns: count(rand, 0.08, 1), fumblesLost: count(rand, 0.05, 1) };
    case "WR": return { ...zero, receptions: int(rand, 1, 10), receivingYards: int(rand, 10, 140), receivingTouchdowns: count(rand, 0.28, 2), rushingYards: int(rand, 0, 12), fumblesLost: count(rand, 0.03, 1) };
    case "TE": return { ...zero, receptions: int(rand, 0, 8), receivingYards: int(rand, 0, 95), receivingTouchdowns: count(rand, 0.22, 2), fumblesLost: count(rand, 0.03, 1) };
    case "K":  return { ...zero, fieldGoalsMade: int(rand, 0, 4), extraPointsMade: int(rand, 0, 5) };
    case "DEF": return { ...zero, sacks: int(rand, 0, 5), defensiveInterceptions: count(rand, 0.35, 3), defensiveTouchdowns: count(rand, 0.1, 1) };
  }
}

export function generateDataset(seed: number): Dataset {
  const rand = mulberry32(seed);
  const players: Player[] = [];
  let n = 0;
  for (const { position, count: c } of POSITION_PLAN) {
    for (let i = 0; i < c; i++) {
      n++;
      const id = `player_${String(n).padStart(3, "0")}`;
      const nflTeam = pick(rand, NFL_TEAMS);
      const name = position === "DEF" ? `${nflTeam} Defense` : `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
      players.push({ id, name, position, nflTeam });
    }
  }
  const statLines: StatLine[] = [];
  for (let week = 1; week <= SEASON_WEEKS; week++) {
    for (const p of players) statLines.push(statLineFor(rand, p, week));
  }
  return { players, statLines };
}
```

```ts
// scripts/gen-mock-dataset.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDataset, DATASET_SEED } from "../src/stats/mock/generate-dataset";

const out = resolve(process.cwd(), "src/stats/mock/dataset.json");
writeFileSync(out, JSON.stringify(generateDataset(DATASET_SEED), null, 2) + "\n", "utf8");
console.log(`wrote ${out}`);
```

Add to `package.json` scripts: `"stats:generate": "tsx scripts/gen-mock-dataset.ts"`. Run `npm run stats:generate`.

- [ ] **Step 5: Run to verify pass**

Run: `npm run stats:generate && npm test -- src/stats/mock/generate-dataset`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing provider test, then implement the seam**

```ts
// src/stats/mock/mock-stats-provider.test.ts
import { describe, it, expect } from "vitest";
import { createMockStatsProvider } from "./mock-stats-provider";
import { PLAYER_COUNT } from "./generate-dataset";

describe("MockStatsProvider", () => {
  const provider = createMockStatsProvider();

  it("lists every player", async () => {
    expect(await provider.listPlayers()).toHaveLength(PLAYER_COUNT);
  });
  it("returns one stat line per player for a valid week", async () => {
    const lines = await provider.getWeeklyStatLines(3);
    expect(lines).toHaveLength(PLAYER_COUNT);
    expect(lines.every((l) => l.week === 3)).toBe(true);
  });
  it("returns an empty list for a week outside the season", async () => {
    expect(await provider.getWeeklyStatLines(18)).toEqual([]);
    expect(await provider.getWeeklyStatLines(0)).toEqual([]);
  });
});
```

```ts
// src/stats/provider.ts
import type { Player, StatLine } from "@/domain/player";

/**
 * The seam between the app and its stats source. Phase 1 uses the deterministic mock;
 * a licensed feed (SportsDataIO / SportRadar / Genius — a business decision, Phase 8)
 * plugs in as another implementation of this interface, not a rewrite.
 */
export interface StatsProvider {
  listPlayers(): Promise<readonly Player[]>;
  getWeeklyStatLines(week: number): Promise<readonly StatLine[]>;
}
```

```ts
// src/stats/mock/mock-stats-provider.ts
import type { StatsProvider } from "../provider";
import type { Dataset } from "./generate-dataset";
import committed from "./dataset.json" with { type: "json" };

export function createMockStatsProvider(dataset: Dataset = committed as Dataset): StatsProvider {
  return {
    async listPlayers() {
      return dataset.players;
    },
    async getWeeklyStatLines(week) {
      return dataset.statLines.filter((s) => s.week === week);
    },
  };
}
```

If `import … with { type: "json" }` fails under the current TS/Node config, use `import committed from "./dataset.json"` (with `resolveJsonModule` already on) and note it.

- [ ] **Step 7: Run to verify pass**

Run: `npm test -- src/stats && npm run typecheck && npm run lint`
Expected: PASS (8 tests); clean.

- [ ] **Step 8: Commit**

```bash
git add src/domain/player.ts src/domain/scoring.ts src/db/schema.ts src/stats scripts/gen-mock-dataset.ts package.json
git commit -m "feat(stats): StatsProvider seam + deterministic 250-player/17-week mock dataset; K/DEF stat & scoring fields"
```

---

### Task 7: `players` / `player_stat_lines` tables, migration, and the seed entry point

**Files:**
- Modify: `src/db/schema.ts` (add two tables), `src/db/test-db.ts` (truncate list)
- Create: `src/data/seed/index.ts`, `src/data/seed/seed-players.ts`, `drizzle/0001_*.sql` (generated)
- Test: `src/data/seed/seed-players.test.ts`

**Interfaces:**
- Produces:
  - Tables `players(id pk, name, position (enum player_position), nfl_team)` and `player_stat_lines(player_id fk, week, …all StatLine numeric fields…, pk (player_id, week), index (week))`.
  - `seedPlayers(db: Db, provider: StatsProvider): Promise<{ players: number; statLines: number }>` — idempotent (upsert on conflict).
  - `npm run seed` runs `src/data/seed/index.ts`, which calls `seedPlayers(getDb(), createMockStatsProvider())`. Later steps add more seeders to `index.ts`; nothing else seeds.

- [ ] **Step 1: Add the tables + regenerate the migration**

Add to `src/db/schema.ts` (after the enums):

```ts
export const playerPositionEnum = pgEnum("player_position", ["QB", "RB", "WR", "TE", "K", "DEF"]);

export const players = pgTable(
  "players",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    position: playerPositionEnum("position").notNull(),
    nflTeam: text("nfl_team").notNull(),
  },
  (t) => [index("players_position_idx").on(t.position)],
);

export const playerStatLines = pgTable(
  "player_stat_lines",
  {
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    passingYards: integer("passing_yards").notNull().default(0),
    passingTouchdowns: integer("passing_touchdowns").notNull().default(0),
    interceptions: integer("interceptions").notNull().default(0),
    rushingYards: integer("rushing_yards").notNull().default(0),
    rushingTouchdowns: integer("rushing_touchdowns").notNull().default(0),
    receivingYards: integer("receiving_yards").notNull().default(0),
    receivingTouchdowns: integer("receiving_touchdowns").notNull().default(0),
    receptions: integer("receptions").notNull().default(0),
    fumblesLost: integer("fumbles_lost").notNull().default(0),
    fieldGoalsMade: integer("field_goals_made").notNull().default(0),
    extraPointsMade: integer("extra_points_made").notNull().default(0),
    sacks: integer("sacks").notNull().default(0),
    defensiveInterceptions: integer("defensive_interceptions").notNull().default(0),
    defensiveTouchdowns: integer("defensive_touchdowns").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.week] }), index("player_stat_lines_week_idx").on(t.week)],
);
```

Also confirm the five new `scoring_settings` columns from Task 6 are present in the schema. Then:

Run: `npm run db:generate && npm run db:migrate && npm run db:migrate:test`
Expected: a new `drizzle/0001_*.sql`; both DBs migrate successfully.

Update `src/db/test-db.ts` `truncateAll` to also truncate `player_stat_lines, players` (put them first in the list).

- [ ] **Step 2: Write the failing seed test**

```ts
// src/data/seed/seed-players.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { PLAYER_COUNT, SEASON_WEEKS } from "@/stats/mock/generate-dataset";
import { seedPlayers } from "./seed-players";

const db = createTestDb();
const provider = createMockStatsProvider();

beforeEach(async () => { await truncateAll(db); });
afterAll(async () => { await truncateAll(db); });

async function countOf(table: string): Promise<number> {
  const rows = (await db.execute(sql.raw(`select count(*)::int as n from ${table}`))) as unknown as { n: number }[];
  return rows[0]!.n;
}

describe("seedPlayers", () => {
  it("loads every player and every stat line", async () => {
    const result = await seedPlayers(db, provider);
    expect(result).toEqual({ players: PLAYER_COUNT, statLines: PLAYER_COUNT * SEASON_WEEKS });
    expect(await countOf("players")).toBe(PLAYER_COUNT);
    expect(await countOf("player_stat_lines")).toBe(PLAYER_COUNT * SEASON_WEEKS);
  }, 30_000);

  it("is idempotent — running twice does not duplicate rows", async () => {
    await seedPlayers(db, provider);
    await seedPlayers(db, provider);
    expect(await countOf("players")).toBe(PLAYER_COUNT);
    expect(await countOf("player_stat_lines")).toBe(PLAYER_COUNT * SEASON_WEEKS);
  }, 30_000);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/data/seed`
Expected: FAIL — cannot find module `./seed-players`.

- [ ] **Step 4: Implement the seeder and entry point**

```ts
// src/data/seed/seed-players.ts
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players, playerStatLines } from "@/db/schema";
import type { StatsProvider } from "@/stats/provider";

const BATCH = 500;

function chunks<T>(arr: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Idempotent: upserts players and stat lines from the provider. Safe to run repeatedly. */
export async function seedPlayers(db: Db, provider: StatsProvider): Promise<{ players: number; statLines: number }> {
  const allPlayers = await provider.listPlayers();
  for (const batch of chunks(allPlayers, BATCH)) {
    await db
      .insert(players)
      .values(batch.map((p) => ({ id: p.id, name: p.name, position: p.position, nflTeam: p.nflTeam })))
      .onConflictDoUpdate({ target: players.id, set: { name: sql`excluded.name`, position: sql`excluded.position`, nflTeam: sql`excluded.nfl_team` } });
  }

  let statCount = 0;
  // Ask the provider week by week — the interface is week-scoped so a live feed can be polled the same way.
  for (let week = 1; ; week++) {
    const lines = await provider.getWeeklyStatLines(week);
    if (lines.length === 0) break;
    for (const batch of chunks(lines, BATCH)) {
      await db.insert(playerStatLines).values([...batch]).onConflictDoNothing({ target: [playerStatLines.playerId, playerStatLines.week] });
    }
    statCount += lines.length;
  }
  return { players: allPlayers.length, statLines: statCount };
}
```

```ts
// src/data/seed/index.ts
import { getDb } from "@/db/client";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { seedPlayers } from "./seed-players";

/**
 * The ONE seed entry point (`npm run seed`). Later steps add seeders here — a demo league,
 * public leagues at various fill levels — never as separate ad-hoc scripts.
 */
async function main(): Promise<void> {
  const db = getDb();
  const result = await seedPlayers(db, createMockStatsProvider());
  console.log(`seeded ${result.players} players and ${result.statLines} stat lines`);
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

`npm run seed` already exists in `package.json` as `dotenv -e .env.local -- tsx src/data/seed/index.ts` — leave it. Because the seed uses the `@/` alias under `tsx`, confirm `tsconfig.json` `paths` resolves (it does via `vite-tsconfig-paths` for tests; for `tsx` add `"tsx": { "tsconfig": "./tsconfig.json" }` only if aliases fail — otherwise nothing to do; `tsx` reads `tsconfig.json` paths by default).

- [ ] **Step 5: Run to verify pass, then run the real seed**

Run: `npm test -- src/data/seed && npm run seed`
Expected: PASS (2 tests); seed prints `seeded 250 players and 4250 stat lines`.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/test-db.ts drizzle src/data/seed
git commit -m "feat(db): players + player_stat_lines tables; idempotent seed entry point loading the mock provider"
```

---

### Task 8: Scoring engine — `computeFantasyPoints`, `scoreRoster`, 100% coverage

**Files:**
- Create: `src/scoring/compute.ts`, `src/scoring/presets.ts`, `src/scoring/index.ts`
- Test: `src/scoring/compute.test.ts`

**Interfaces:**
- Consumes: `StatLine`, `Position` (Task 6), `ScoringSettings` and presets from `src/domain/scoring.ts`.
- Produces:
  - `computeFantasyPoints(statLine: StatLine, position: Position, settings: Omit<ScoringSettings, "leagueId">): number` — pure; rounds to 2 decimals.
  - `scoreLineup(input: { starters: readonly { playerId: string; position: Position }[]; statLinesByPlayerId: ReadonlyMap<string, StatLine>; settings: Omit<ScoringSettings,"leagueId"> }): { total: number; byPlayer: ReadonlyMap<string, number> }` — a starter with no stat line scores 0 (bye/DNP), never throws.
  - `src/scoring/index.ts` re-exports these plus `STANDARD_SCORING, PPR_SCORING, HALF_PPR_SCORING, TE_PREMIUM_SCORING`.

- [ ] **Step 1: Write the failing tests (table-driven, hand-computed expectations)**

```ts
// src/scoring/compute.test.ts
import { describe, it, expect } from "vitest";
import type { StatLine } from "@/domain/player";
import { STANDARD_SCORING, PPR_SCORING, HALF_PPR_SCORING, TE_PREMIUM_SCORING } from "@/domain/scoring";
import { computeFantasyPoints, scoreLineup } from "./compute";

const zero: StatLine = {
  playerId: "p", week: 1,
  passingYards: 0, passingTouchdowns: 0, interceptions: 0,
  rushingYards: 0, rushingTouchdowns: 0,
  receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
  fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
};

describe("computeFantasyPoints", () => {
  // QB: 300 pass yds (12) + 3 pass TD (12) + 1 INT (-2) + 20 rush yds (2) = 24
  it("scores a QB line under standard scoring", () => {
    const line = { ...zero, passingYards: 300, passingTouchdowns: 3, interceptions: 1, rushingYards: 20 };
    expect(computeFantasyPoints(line, "QB", STANDARD_SCORING)).toBe(24);
  });

  // WR: 8 rec, 100 yds (10) + 1 TD (6) = 16 standard; 24 PPR; 20 half-PPR
  const wr = { ...zero, receptions: 8, receivingYards: 100, receivingTouchdowns: 1 };
  it.each([
    ["standard", STANDARD_SCORING, 16],
    ["PPR", PPR_SCORING, 24],
    ["half-PPR", HALF_PPR_SCORING, 20],
  ])("scores a WR line under %s", (_name, settings, expected) => {
    expect(computeFantasyPoints(wr, "WR", settings)).toBe(expected);
  });

  it("applies the TE reception bonus only to tight ends", () => {
    const line = { ...zero, receptions: 6, receivingYards: 60 };
    // TE premium = PPR (1/rec) + 0.5 TE bonus → 6*1.5 + 6 = 15 ; WR gets 6 + 6 = 12
    expect(computeFantasyPoints(line, "TE", TE_PREMIUM_SCORING)).toBe(15);
    expect(computeFantasyPoints(line, "WR", TE_PREMIUM_SCORING)).toBe(12);
  });

  it("scores negative stats (fumbles, INTs) as negatives and can go below zero", () => {
    const line = { ...zero, interceptions: 3, fumblesLost: 1 }; // -6 + -2
    expect(computeFantasyPoints(line, "QB", STANDARD_SCORING)).toBe(-8);
  });

  it("scores kickers and defenses from their own categories", () => {
    expect(computeFantasyPoints({ ...zero, fieldGoalsMade: 2, extraPointsMade: 3 }, "K", STANDARD_SCORING)).toBe(9);
    expect(computeFantasyPoints({ ...zero, sacks: 3, defensiveInterceptions: 1, defensiveTouchdowns: 1 }, "DEF", STANDARD_SCORING)).toBe(11);
  });

  it("returns 0 for an all-zero line and rounds to 2 decimals", () => {
    expect(computeFantasyPoints(zero, "RB", STANDARD_SCORING)).toBe(0);
    // 7 rushing yards * 0.1 = 0.7000000000000001 in float math → 0.7
    expect(computeFantasyPoints({ ...zero, rushingYards: 7 }, "RB", STANDARD_SCORING)).toBe(0.7);
  });
});

describe("scoreLineup", () => {
  const settings = PPR_SCORING;
  const lines = new Map<string, StatLine>([
    ["qb1", { ...zero, playerId: "qb1", passingYards: 250, passingTouchdowns: 2 }], // 10 + 8 = 18
    ["wr1", { ...zero, playerId: "wr1", receptions: 5, receivingYards: 50 }],        // 5 + 5 = 10
  ]);

  it("sums starters and reports per-player points", () => {
    const res = scoreLineup({
      starters: [{ playerId: "qb1", position: "QB" }, { playerId: "wr1", position: "WR" }],
      statLinesByPlayerId: lines,
      settings,
    });
    expect(res.total).toBe(28);
    expect(res.byPlayer.get("qb1")).toBe(18);
    expect(res.byPlayer.get("wr1")).toBe(10);
  });

  it("scores a starter with no stat line as 0 (bye/DNP) rather than throwing", () => {
    const res = scoreLineup({ starters: [{ playerId: "ghost", position: "RB" }], statLinesByPlayerId: lines, settings });
    expect(res.total).toBe(0);
    expect(res.byPlayer.get("ghost")).toBe(0);
  });

  it("returns 0 for an empty lineup", () => {
    expect(scoreLineup({ starters: [], statLinesByPlayerId: lines, settings }).total).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/scoring`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/scoring/compute.ts
import type { Position, StatLine } from "@/domain/player";
import type { ScoringSettings } from "@/domain/scoring";

export type ScoringRules = Omit<ScoringSettings, "leagueId">;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pure. Every stat category is weighted by the league's configurable settings — no magic numbers here. */
export function computeFantasyPoints(s: StatLine, position: Position, r: ScoringRules): number {
  const receptionPoints = s.receptions * (r.pointsPerReception + (position === "TE" ? r.teReceptionBonus : 0));
  const total =
    s.passingYards * r.pointsPerPassingYard +
    s.passingTouchdowns * r.pointsPerPassingTouchdown +
    s.interceptions * r.pointsPerInterception +
    s.rushingYards * r.pointsPerRushingYard +
    s.rushingTouchdowns * r.pointsPerRushingTouchdown +
    s.receivingYards * r.pointsPerReceivingYard +
    s.receivingTouchdowns * r.pointsPerReceivingTouchdown +
    receptionPoints +
    s.fumblesLost * r.pointsPerFumbleLost +
    s.fieldGoalsMade * r.pointsPerFieldGoal +
    s.extraPointsMade * r.pointsPerExtraPoint +
    s.sacks * r.pointsPerSack +
    s.defensiveInterceptions * r.pointsPerDefensiveInterception +
    s.defensiveTouchdowns * r.pointsPerDefensiveTouchdown;
  return round2(total);
}

export interface Starter {
  readonly playerId: string;
  readonly position: Position;
}

export interface ScoreLineupInput {
  readonly starters: readonly Starter[];
  readonly statLinesByPlayerId: ReadonlyMap<string, StatLine>;
  readonly settings: ScoringRules;
}

export interface LineupScore {
  readonly total: number;
  readonly byPlayer: ReadonlyMap<string, number>;
}

/** A starter with no stat line (bye week / did not play) scores 0 — never throws. */
export function scoreLineup({ starters, statLinesByPlayerId, settings }: ScoreLineupInput): LineupScore {
  const byPlayer = new Map<string, number>();
  let total = 0;
  for (const st of starters) {
    const line = statLinesByPlayerId.get(st.playerId);
    const pts = line === undefined ? 0 : computeFantasyPoints(line, st.position, settings);
    byPlayer.set(st.playerId, pts);
    total += pts;
  }
  return { total: round2(total), byPlayer };
}
```

```ts
// src/scoring/presets.ts
export { STANDARD_SCORING, PPR_SCORING, HALF_PPR_SCORING, TE_PREMIUM_SCORING } from "@/domain/scoring";
```

```ts
// src/scoring/index.ts
export { computeFantasyPoints, scoreLineup, type ScoringRules, type Starter, type ScoreLineupInput, type LineupScore } from "./compute";
export * from "./presets";
```

- [ ] **Step 4: Run tests with coverage to verify pass AND the 100% threshold**

Run: `npm run test:coverage -- src/scoring`
Expected: all tests PASS and coverage for `src/scoring/**` reports 100% on all four metrics (the threshold in `vitest.config.mts` fails the run otherwise). If a branch is uncovered, add a test that exercises it — do not lower the threshold.

- [ ] **Step 5: Full verification and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all clean; build succeeds.

```bash
git add src/scoring
git commit -m "feat(scoring): pure computeFantasyPoints/scoreLineup, all presets incl. K/DEF and TE-premium, 100% coverage"
```

---

## Self-Review

**Spec coverage** (Phase 1 blueprint Step 1 remaining items + Step 2, through the no-MVP lens):
- Design-system foundation: tokens (light+dark together), ThemeProvider, primitives with built-in loading/empty/error states, one icon system, mobile-first baseline, a11y (`jsx-a11y` is pending in `eslint.config.pending.mjs` — hook-blocked; `axe` is enforced in tests now), `docs/design-system.md`, standing UI-step checklist → Tasks 1–4. ✅
- Shared LLM client module with `isLLMEnabled()` → Task 5. ✅
- Mock dataset: ~250 players, deterministic 17-week season, committed static artifact with byte-identical regeneration test → Task 6. ✅ (Blueprint said "~250"; plan fixes 250 exactly.)
- `src/data/seed/` single seed entry point → Task 7. ✅ (Players/stat lines in Postgres is the end-state shape a licensed feed will populate; the `StatsProvider` seam is what swaps.)
- Step 2 scoring engine: presets standard/PPR/half/TE-premium verified against hand-computed values; missing categories, zero lines, negative stats; 100% coverage threshold scoped to `src/scoring` → Task 8. ✅ (K/DEF categories added — the blueprint's `Position` type already included them, so scoring them is correctness, not scope creep. Points-allowed tiers for DEF are deliberately out: they need a per-league tier table; recorded as a known follow-up.)
- Not in this plan (by design, separate plans): draft engine/rooms/moderator, league management/matchmaking, chat/advisor, e2e integration.

**Placeholder scan:** no TBD/TODO; every code step has code; test steps have real assertions with hand-computed expectations. The one intentional conditional ("if the SDK type doesn't structurally match, cast at the single construction site and comment why") gives the exact action.

**Type consistency:** `StatLine` fields added in Task 6 are the ones the Task 6 generator, Task 7 table, and Task 8 scorer use (`fieldGoalsMade`, `extraPointsMade`, `sacks`, `defensiveInterceptions`, `defensiveTouchdowns`); `ScoringSettings` additions (`pointsPerFieldGoal`, `pointsPerExtraPoint`, `pointsPerSack`, `pointsPerDefensiveInterception`, `pointsPerDefensiveTouchdown`) match between Task 6 domain and Task 8 compute; `StatsProvider` method names (`listPlayers`, `getWeeklyStatLines`) match between Task 6 interface, Task 6 mock, and Task 7 seeder; `ColorRole` names in Task 1 match the Tailwind aliases in Task 2 and the classes in Tasks 3–4 (`bg-surface`, `bg-surface-elevated`, `border-border`, `text-text-primary`, `text-text-muted`, `bg-accent`, `text-accent-text`, `text-positive|negative|warning`); `IconName` union in Task 4 matches the names used by `EmptyState`/`ErrorState`.
