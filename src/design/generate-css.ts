import { TOKENS, type ColorRole, type PositionColorRole, type ThemeName } from "./tokens";
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

/** Everything that changes with the theme, in the order every theme block emits it. */
function themeVars(theme: ThemeName, indent: string): string {
  return [colorVars(theme, indent), positionVars(theme, indent)].join("\n");
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
    scaleVars("shadow", TOKENS.shadow, "", i),
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
