import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderTokensCss } from "./generate-css";
import { TOKENS } from "./tokens";

describe("renderTokensCss", () => {
  const css = renderTokensCss();

  it("emits every light color role on :root as --commish-color-<kebab>", () => {
    // Values come from TOKENS itself — hardcoding hexes here made every deliberate palette
    // tune a false drift failure (see the position-sticker test below, which learned this
    // lesson first).
    const light = TOKENS.color.light;
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-color-text-primary:\s*${light.textPrimary}`, "i"));
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-color-surface-elevated:\s*${light.surfaceElevated}`, "i"));
  });

  it("emits dark values under [data-theme=\"dark\"] and under prefers-color-scheme guarded by :not([data-theme=\"light\"])", () => {
    const dark = TOKENS.color.dark;
    expect(css).toMatch(new RegExp(String.raw`:root\[data-theme="dark"\]\s*\{[^}]*--commish-color-surface:\s*${dark.surface}`, "i"));
    expect(css).toMatch(
      new RegExp(
        String.raw`@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[^}]*--commish-color-surface:\s*${dark.surface}`,
        "i",
      ),
    );
  });

  it("emits all three position-sticker variables per role, in both themes", () => {
    // Values come from TOKENS itself — this test pins EMISSION shape, not palette choices
    // (tokens.test.ts owns contrast/distinguishability; hardcoding hexes here made every
    // deliberate palette tune a false drift failure).
    const light = TOKENS.position.light.qb;
    const darkDef = TOKENS.position.dark.def;
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-pos-qb-sticker:\s*${light.sticker}`, "i"));
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-pos-qb-sticker-text:\s*${light.stickerText}`, "i"));
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-pos-def-text:\s*${TOKENS.position.light.def.text}`, "i"));
    expect(css).toMatch(new RegExp(String.raw`:root\[data-theme="dark"\]\s*\{[^}]*--commish-pos-def-text:\s*${darkDef.text}`, "i"));
  });

  it("emits radius, font-size, display-size, shadow and motion vars, namespaced with the token var prefix", () => {
    expect(css).toContain("--commish-radius-md: 8px;");
    expect(css).toContain("--commish-font-size-md: 16px;");
    expect(css).toContain("--commish-display-size-xl: 64px;");
    expect(css).toContain("--commish-line-height-display: 1.05;");
    expect(css).toContain("--commish-shadow-card: 0 1px 2px rgb(22 24 29 / 0.06), 0 1px 3px rgb(22 24 29 / 0.05);");
    expect(css).toContain("--commish-motion-duration-base: 200ms;");
  });

  it("matches the committed src/design/tokens.css byte-for-byte (run `npm run tokens:build` after changing tokens.ts)", () => {
    const committed = readFileSync(resolve(process.cwd(), "src/design/tokens.css"), "utf8");
    expect(committed).toBe(css);
  });
});
