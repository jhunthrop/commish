import { TOKENS, MAGNITUDE_STEPS, TIER_GRADES, type ColorRole, type PositionColorRole, type ThemeName } from "./tokens";
import { UI_CONFIG } from "@/components/ui/config";

/** Namespace for every generated CSS custom property, so `@theme inline` aliases in
 * globals.css can reference a distinct source variable instead of aliasing a name to itself. */
export const TOKEN_VAR_PREFIX = "commish";

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function tokenVar(name: string): string {
  return `--${TOKEN_VAR_PREFIX}-${name}`;
}

function colorVars(theme: ThemeName, indent: string): string {
  return (Object.keys(TOKENS.color[theme]) as ColorRole[])
    .map((role) => `${indent}${tokenVar(`color-${kebab(role)}`)}: ${TOKENS.color[theme][role]};`)
    .join("\n");
}

/** The position sticker family: three variables per role, emitted per theme beside the colors. */
function positionVars(theme: ThemeName, indent: string): string {
  const palette = TOKENS.position[theme];
  return (Object.keys(palette) as PositionColorRole[])
    .flatMap((role) => [
      `${indent}${tokenVar(`pos-${role}-sticker`)}: ${palette[role].sticker};`,
      `${indent}${tokenVar(`pos-${role}-sticker-text`)}: ${palette[role].stickerText};`,
      `${indent}${tokenVar(`pos-${role}-text`)}: ${palette[role].text};`,
    ])
    .join("\n");
}

/** The heat map's five steps, emitted per theme beside the colors. One variable per step: a
 *  magnitude value is only ever a number's own ink, never a fill or a boundary, so unlike a
 *  position sticker it needs no on-fill or on-surface companion. */
function magnitudeVars(theme: ThemeName, indent: string): string {
  return MAGNITUDE_STEPS.map((step) => `${indent}${tokenVar(`mag-${step}`)}: ${TOKENS.magnitude[theme][step]};`).join("\n");
}

/**
 * The tier ladder's four grades, two variables each (the badge fill and the letter printed on
 * it), emitted per theme beside the colors — the same shape a position sticker takes, for the
 * same reason: a grade badge is a FILL carrying its own on-fill label, so the pair travels
 * together or the label ends up chosen at a call site.
 *
 * WHY THIS PALETTE IS A CSS VARIABLE WHEN `TOKENS.team` IS NOT. `tokens.ts` groups the two under
 * one heading ("not a CSS variable, keyed by data") and they are not actually alike. A team colour
 * is keyed by a value that ARRIVES AT RUNTIME — a `teamAbv` off the stats feed, unbounded from the
 * static scanner's point of view — so it can only ever reach the DOM as an inline style. A tier
 * grade is keyed by a CLOSED union of four literals (`TIER_GRADES`), so a component can write the
 * four class names out and Tailwind can see all four. That difference is the whole argument: with
 * variables the badge is theme-REACTIVE, repainting itself when the theme switches under it, where
 * an inline style would have to read the theme in React — which no component here can do — and
 * would therefore have shipped dark's bright pigments onto the light theme's near-white ground,
 * the exact 3:1 failure `TOKENS.tier`'s own docblock says two designed palettes exist to prevent.
 *
 * Grades are lower-cased in the variable name (`--commish-tier-s-fill`) because a CSS custom
 * property is case-sensitive and every other generated name here is kebab-lower; the component's
 * class map keys stay the union's own capitals.
 */
function tierVars(theme: ThemeName, indent: string): string {
  const palette = TOKENS.tier[theme];
  return TIER_GRADES.flatMap((grade) => [
    `${indent}${tokenVar(`tier-${grade.toLowerCase()}-fill`)}: ${palette[grade].fill};`,
    `${indent}${tokenVar(`tier-${grade.toLowerCase()}-label`)}: ${palette[grade].label};`,
  ]).join("\n");
}

/**
 * V6's material depth, per theme (the warmth pass, 2026-09-03): dark's card shadow carries an
 * inset top-light that would vanish on daylight paper, and the verb's glow is a tint of each
 * theme's own accent — so shadows moved from the theme-independent block into the theme blocks,
 * the same emission shape every other theme-varying palette here takes.
 */
function shadowVars(theme: ThemeName, indent: string): string {
  return Object.entries(TOKENS.shadow[theme])
    .map(([key, value]) => `${indent}${tokenVar(`shadow-${kebab(key)}`)}: ${value};`)
    .join("\n");
}

/** Everything that changes with the theme, in the order every theme block emits it. */
function themeVars(theme: ThemeName, indent: string): string {
  return [colorVars(theme, indent), magnitudeVars(theme, indent), positionVars(theme, indent), tierVars(theme, indent), shadowVars(theme, indent)].join(
    "\n",
  );
}

function scaleVars(prefix: string, obj: Readonly<Record<string, number | string>>, unit: string, indent: string): string {
  return Object.entries(obj)
    .map(([k, v]) => `${indent}${tokenVar(`${prefix}-${kebab(k)}`)}: ${typeof v === "number" ? `${v}${unit}` : v};`)
    .join("\n");
}

/**
 * Renders TOKENS as CSS custom properties. Deterministic: same TOKENS → identical text.
 *
 * Both themes are first-class (founder ruling, 2026-08-23 — revised ruling 1): light values on
 * `:root`, dark values under `:root[data-theme="dark"]` AND under `prefers-color-scheme: dark`
 * guarded by `:not([data-theme="light"])` — an explicit choice always wins, and with no choice
 * the OS preference does. The dense type scale is the one thing that varies by viewport rather
 * than by theme: it lands in its own `:root` block inside
 * `@media (min-width: UI_CONFIG.shell.denseFromPx)`, so a component never writes
 * `text-sm lg:text-xs` — density is a property of the viewport, expressed once, here.
 */
export function renderTokensCss(): string {
  const i = "  ";
  return [
    "/* GENERATED from src/design/tokens.ts by `npm run tokens:build` — do not edit by hand. */",
    ":root {",
    themeVars("light", i),
    scaleVars("radius", TOKENS.radius, "px", i),
    scaleVars("font-size", TOKENS.font.size, "px", i),
    scaleVars("display-size", TOKENS.font.display, "px", i),
    scaleVars("line-height", TOKENS.font.lineHeight, "", i),
    scaleVars("motion-duration", TOKENS.motion.duration, "ms", i),
    scaleVars("motion-easing", TOKENS.motion.easing, "", i),
    "}",
    "",
    ':root[data-theme="dark"] {',
    themeVars("dark", i),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    themeVars("dark", i + i),
    "  }",
    "}",
    "",
    `@media (min-width: ${UI_CONFIG.shell.denseFromPx}px) {`,
    "  :root {",
    scaleVars("font-size", TOKENS.font.sizeDense, "px", i + i),
    "  }",
    "}",
    "",
  ].join("\n");
}
