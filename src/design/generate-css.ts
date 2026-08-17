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
