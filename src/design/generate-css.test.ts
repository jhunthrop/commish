import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderTokensCss } from "./generate-css";
import { TOKENS, TIER_GRADES } from "./tokens";
import { UI_CONFIG } from "@/components/ui/config";

describe("renderTokensCss", () => {
  const css = renderTokensCss();

  it("emits every light color role on :root as --commish-color-<kebab>", () => {
    // Values come from TOKENS itself — hardcoding hexes here made every deliberate palette
    // tune a false drift failure (see the position-sticker test below, which learned this
    // lesson first).
    const light = TOKENS.color.light;
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-color-text-primary:\s*${light.textPrimary}`, "i"));
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-color-surface-elevated:\s*${light.surfaceElevated}`, "i"));
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-color-line:\s*${light.line}`, "i"));
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-color-edge:\s*${light.edge}`, "i"));
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

  it("emits both tier variables per grade, in both themes — the palette is theme-reactive or it is not findable", () => {
    // The whole reason the tier ladder became a variable rather than an inline style: dark's
    // bright mock pigments fail WCAG 1.4.11's 3:1 on the light theme's near-white ground, so a
    // badge that cannot repaint itself when the theme changes is a badge nobody can see in one of
    // the two themes. Emission shape only — `tokens.test.ts` owns the contrast gates.
    for (const grade of TIER_GRADES) {
      const key = grade.toLowerCase();
      expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-tier-${key}-fill:\s*${TOKENS.tier.light[grade].fill}`, "i"));
      expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-tier-${key}-label:\s*${TOKENS.tier.light[grade].label}`, "i"));
      expect(css).toMatch(
        new RegExp(String.raw`:root\[data-theme="dark"\]\s*\{[^}]*--commish-tier-${key}-fill:\s*${TOKENS.tier.dark[grade].fill}`, "i"),
      );
    }
  });

  it("emits radius, font-size, display-size, density and motion vars, namespaced with the token var prefix", () => {
    // Sideline pins: the card and sheet step (xl 20), the row plate and avatar ring (md 12),
    // the named durations and the two easings, and the density constants as lengths.
    expect(css).toContain("--commish-radius-md: 12px;");
    expect(css).toContain("--commish-radius-xl: 20px;");
    expect(css).toContain(`--commish-font-size-md: ${TOKENS.font.size.md}px;`);
    expect(css).toContain(`--commish-display-size-xl: ${TOKENS.font.display.xl}px;`);
    expect(css).toContain(`--commish-line-height-display: ${TOKENS.font.lineHeight.display};`);
    expect(css).toContain("--commish-motion-duration-in: 240ms;");
    expect(css).toContain("--commish-motion-duration-out: 180ms;");
    expect(css).toContain("--commish-motion-duration-highlight: 600ms;");
    expect(css).toContain("--commish-motion-duration-breathe: 2000ms;");
    expect(css).toContain(`--commish-motion-easing-spring: ${TOKENS.motion.easing.spring};`);
    expect(css).toContain(`--commish-density-row: ${TOKENS.density.rowPx}px;`);
    expect(css).toContain(`--commish-density-face: ${TOKENS.density.facePx}px;`);
    expect(css).not.toContain("--commish-density-max-columns");
    // The reading column, the one length a layout spends (founder ruling, 2026-09-11): named in
    // `tokens.ts`, emitted here, spent by `.reading-column` in `globals.css`.
    expect(css).toContain(`--commish-layout-reading-column: ${TOKENS.layout.readingColumnPx}px;`);
  });

  it("emits the Sideline amber roles per theme, so a self ring repaints with the theme", () => {
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-color-self:\s*${TOKENS.color.light.self}`, "i"));
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-color-self-ink:\s*${TOKENS.color.light.selfInk}`, "i"));
    expect(css).toMatch(new RegExp(String.raw`:root\[data-theme="dark"\]\s*\{[^}]*--commish-color-self:\s*${TOKENS.color.dark.self}`, "i"));
  });

  it("emits the shadow set PER THEME — light values on :root, dark values under the dark selectors — because the material deepens at night", () => {
    // Same emission contract the colors keep.
    expect(css).toMatch(new RegExp(String.raw`:root\s*\{[^}]*--commish-shadow-card:\s*${TOKENS.shadow.light.card.replace(/[().]/g, (m) => `\\${m}`)}`, "i"));
    expect(css).toMatch(
      new RegExp(String.raw`:root\[data-theme="dark"\]\s*\{[^}]*--commish-shadow-card:\s*${TOKENS.shadow.dark.card.replace(/[().]/g, (m) => `\\${m}`)}`, "i"),
    );
    for (const key of ["raised", "overlay", "verb-glow", "sticker"]) {
      expect(css).toContain(`--commish-shadow-${key}:`);
    }
  });

  it("emits the dense type scale inside a min-width media query at UI_CONFIG.shell.denseFromPx", () => {
    const mediaBlock = new RegExp(String.raw`@media \(min-width: ${UI_CONFIG.shell.denseFromPx}px\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}`, "i");
    const match = css.match(mediaBlock);
    expect(match).not.toBeNull();
    const body = match![1]!;
    for (const [key, value] of Object.entries(TOKENS.font.sizeDense)) {
      const kebabKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      expect(body).toMatch(new RegExp(String.raw`--commish-font-size-${kebabKey}:\s*${value}px;`));
    }
  });

  it("the dense block carries the same keys as the base font-size block — a key present in one and missing from the other is a size that silently stops responding", () => {
    expect(Object.keys(TOKENS.font.sizeDense).sort()).toEqual(Object.keys(TOKENS.font.size).sort());
  });

  it("matches the committed src/design/tokens.css byte-for-byte (run `npm run tokens:build` after changing tokens.ts)", () => {
    const committed = readFileSync(resolve(process.cwd(), "src/design/tokens.css"), "utf8");
    expect(committed).toBe(css);
  });
});
