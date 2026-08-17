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
