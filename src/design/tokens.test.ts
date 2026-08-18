import { describe, it, expect } from "vitest";
import { TOKENS, type ThemeName, type ColorRole, type PositionColorRole } from "./tokens";
import { contrastRatio, hueDegrees, hueDistance } from "./test-support";

const THEMES: readonly ThemeName[] = ["light", "dark"];
const AA_TEXT = 4.5;
const AA_LARGE_AND_UI = 3;

// Two colors used for distinct semantic/interactive meanings must not be visually
// interchangeable, even when both individually clear AA text contrast on a surface.
const MIN_DISTINGUISHABLE_CONTRAST = 1.5;
const MIN_DISTINGUISHABLE_HUE_DEG = 30;
const DISTINGUISHABLE_ROLES: readonly ColorRole[] = ["accent", "positive", "negative", "warning"];

// Every text/foreground role that sits directly on a surface must clear AA text contrast.
// `scrim` is deliberately absent from every list below: it is a translucent modal backdrop
// overlay, never text or a UI foreground, so text-contrast and distinguishability checks do
// not apply to it.
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
      it("negativeText on negative (destructive button label) ≥ 4.5:1", () => {
        expect(contrastRatio(c.negativeText, c.negative)).toBeGreaterThanOrEqual(AA_TEXT);
      });
      it("border against surface ≥ 3:1 (non-text UI)", () => {
        expect(contrastRatio(c.border, c.surface)).toBeGreaterThanOrEqual(AA_LARGE_AND_UI);
      });

      for (let i = 0; i < DISTINGUISHABLE_ROLES.length; i++) {
        for (let j = i + 1; j < DISTINGUISHABLE_ROLES.length; j++) {
          const roleA = DISTINGUISHABLE_ROLES[i]!;
          const roleB = DISTINGUISHABLE_ROLES[j]!;
          it(`${roleA} and ${roleB} are distinguishable (contrast ≥ ${MIN_DISTINGUISHABLE_CONTRAST} or hue distance ≥ ${MIN_DISTINGUISHABLE_HUE_DEG}°)`, () => {
            const contrast = contrastRatio(c[roleA], c[roleB]);
            const hueDelta = hueDistance(hueDegrees(c[roleA]), hueDegrees(c[roleB]));
            expect(contrast >= MIN_DISTINGUISHABLE_CONTRAST || hueDelta >= MIN_DISTINGUISHABLE_HUE_DEG).toBe(true);
          });
        }
      }
    });
  }
});

// The six position stickers. `def` is the quiet one by design (no hue of its own to speak
// of), which is exactly why it has to be checked against the five that do have one.
const POSITION_ROLES: readonly PositionColorRole[] = ["qb", "rb", "wr", "te", "k", "def"];

describe("TOKENS.position", () => {
  it("defines the same position roles in both themes", () => {
    expect(Object.keys(TOKENS.position.light).sort()).toEqual(Object.keys(TOKENS.position.dark).sort());
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const c = TOKENS.color[theme];
      const p = TOKENS.position[theme];

      for (const role of POSITION_ROLES) {
        it(`${role} text on surface ≥ ${AA_TEXT}:1`, () => {
          expect(contrastRatio(p[role].text, c.surface)).toBeGreaterThanOrEqual(AA_TEXT);
        });
        it(`${role} text on surfaceElevated ≥ ${AA_TEXT}:1`, () => {
          expect(contrastRatio(p[role].text, c.surfaceElevated)).toBeGreaterThanOrEqual(AA_TEXT);
        });
        it(`${role} stickerText on its own sticker ≥ ${AA_TEXT}:1`, () => {
          expect(contrastRatio(p[role].stickerText, p[role].sticker)).toBeGreaterThanOrEqual(AA_TEXT);
        });
      }

      // The whole point of a position sticker is that you read the POSITION off the color
      // before you read the letters. Two stickers a viewer could mistake for each other
      // would defeat that, so the same threshold that keeps accent/positive/negative/warning
      // apart applies to all fifteen sticker pairs.
      for (let i = 0; i < POSITION_ROLES.length; i++) {
        for (let j = i + 1; j < POSITION_ROLES.length; j++) {
          const roleA = POSITION_ROLES[i]!;
          const roleB = POSITION_ROLES[j]!;
          it(`${roleA} and ${roleB} stickers are distinguishable (contrast ≥ ${MIN_DISTINGUISHABLE_CONTRAST} or hue distance ≥ ${MIN_DISTINGUISHABLE_HUE_DEG}°)`, () => {
            const contrast = contrastRatio(p[roleA].sticker, p[roleB].sticker);
            const hueDelta = hueDistance(hueDegrees(p[roleA].sticker), hueDegrees(p[roleB].sticker));
            expect(contrast >= MIN_DISTINGUISHABLE_CONTRAST || hueDelta >= MIN_DISTINGUISHABLE_HUE_DEG).toBe(true);
          });
        }
      }
    });
  }
});

describe("TOKENS scales", () => {
  it("type scale is strictly increasing", () => {
    const vals = Object.values(TOKENS.font.size);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
  });
  it("display scale is strictly increasing and starts above the body scale's midpoint", () => {
    const vals = Object.values(TOKENS.font.display);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
    expect(vals[0]).toBeGreaterThan(TOKENS.font.size.md);
  });
  it("display line height is tighter than the tight body line height", () => {
    expect(TOKENS.font.lineHeight.display).toBeLessThan(TOKENS.font.lineHeight.tight);
  });
  it("motion durations are strictly increasing", () => {
    const { fast, base, slow } = TOKENS.motion.duration;
    expect(fast).toBeLessThan(base);
    expect(base).toBeLessThan(slow);
  });
});
