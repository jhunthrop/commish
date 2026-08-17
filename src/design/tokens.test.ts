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
