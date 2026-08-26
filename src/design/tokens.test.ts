import { describe, it, expect } from "vitest";
import { TOKENS, COLOR_ROLES, type ColorRole, type PositionColorRole, type ThemeName } from "./tokens";
import { contrastRatio, hueDegrees, hueDistance, blendOver } from "./test-support";

const THEMES: readonly ThemeName[] = ["light", "dark"];
const AA_TEXT = 4.5;
const AA_LARGE_AND_UI = 3;

// Two colors used for distinct semantic/interactive meanings must not be visually
// interchangeable, even when both individually clear AA text contrast on a surface.
// `accent`/`positive` are excluded on purpose: v2 makes them the SAME green in both themes,
// deliberately (docs/design-system.md, "One pigment, two jobs") — the rule that keeps the
// doubling safe is context, not hue, so this pair is not checked for distinguishability.
const MIN_DISTINGUISHABLE_CONTRAST = 1.5;
const MIN_DISTINGUISHABLE_HUE_DEG = 30;
const DISTINGUISHABLE_PAIRS: readonly (readonly [ColorRole, ColorRole])[] = [
  ["accent", "negative"],
  ["accent", "warning"],
  ["positive", "negative"],
  ["positive", "warning"],
  ["negative", "warning"],
];

// Every text/foreground role that sits directly on a surface must clear AA text contrast.
// `scrim` is deliberately absent: it is a translucent modal backdrop overlay, never text or a
// UI foreground. `accentText`/`negativeText` are checked separately, against the FILL they
// label, not against a surface.
const TEXT_ON_SURFACE: readonly ColorRole[] = ["textPrimary", "textMuted", "textFaint", "accent", "positive", "negative", "warning", "info"];
const SURFACES: readonly ColorRole[] = ["surface", "surfaceElevated"];

describe("TOKENS.color", () => {
  it("carries the same nineteen roles in both palettes, so no surface can exist in a theme nobody designed", () => {
    // REVISED (founder both-themes ruling, 2026-08-23): two palettes, one role set, and every
    // contrast assertion in this file runs against EACH palette. A role present in one palette
    // and missing from the other is a color that silently stops responding to the theme.
    for (const theme of THEMES) {
      expect(Object.keys(TOKENS.color[theme]).sort()).toEqual([...COLOR_ROLES].sort());
    }
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const c = TOKENS.color[theme];

      it("keeps every text role readable on every surface it is used on", () => {
        // The mock's --faint (#6B7488) is used at 12px for card meta, step captions and table
        // subs. Against --panel2 (#161920) it measures 3.75:1, below the 4.5:1 WCAG 1.4.3 floor
        // for normal text. The token moves; the threshold does not. (join-flow-panel.md,
        // "Accessibility smells".) Both themes carry the same floor.
        for (const role of ["textPrimary", "textMuted", "textFaint"] as const) {
          for (const surface of ["surface", "surfaceElevated", "surfaceRaised", "surfaceInset"] as const) {
            expect(contrastRatio(c[role], c[surface])).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      for (const role of TEXT_ON_SURFACE) {
        for (const surface of SURFACES) {
          it(`${role} on ${surface} ≥ ${AA_TEXT}:1`, () => {
            expect(contrastRatio(c[role], c[surface])).toBeGreaterThanOrEqual(AA_TEXT);
          });
        }
      }

      it("prints a readable label on every fill that carries one", () => {
        expect(contrastRatio(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.negativeText, c.negative)).toBeGreaterThanOrEqual(4.5);
      });

      it("gives an interactive boundary its own role, because the hairline cannot carry one", () => {
        // --line (#20242E) measures 1.26:1 against --bg. That is correct for a DECORATIVE
        // separator between two panels and is nowhere near WCAG 1.4.11's 3:1 for the boundary
        // of a control a user must find. v2 therefore ships BOTH: `line` separates, `edge`
        // bounds — in both themes.
        //
        // D1 (mock lobby review, 2026-08-26): the field primitives (`Select`, `Input`,
        // `Textarea`) drew their own boundary in `line` — 1.17:1 dark / 1.22:1 light, a control
        // border missing WCAG 1.4.11's 3:1 floor by roughly 2.6x — and never had a test that
        // would have caught it, because this gate only ever checked THREE of the product's four
        // surfaces. All four now: a control can sit on the page ground, a panel, a raised row,
        // or an inset well, and `edge` must clear 3:1 on every one it is asked to bound.
        expect(contrastRatio(c.line, c.surface)).toBeLessThan(3);
        for (const surface of ["surface", "surfaceElevated", "surfaceRaised", "surfaceInset"] as const) {
          expect(contrastRatio(c.edge, c[surface])).toBeGreaterThanOrEqual(3);
        }
      });

      it("border against surface is now edge's job, not line's — line stays a decorative hairline", () => {
        expect(contrastRatio(c.line, c.surfaceElevated)).toBeLessThan(AA_LARGE_AND_UI);
      });

      for (const [roleA, roleB] of DISTINGUISHABLE_PAIRS) {
        it(`${roleA} and ${roleB} are distinguishable (contrast ≥ ${MIN_DISTINGUISHABLE_CONTRAST} or hue distance ≥ ${MIN_DISTINGUISHABLE_HUE_DEG}°)`, () => {
          const contrast = contrastRatio(c[roleA], c[roleB]);
          const hueDelta = hueDistance(hueDegrees(c[roleA]), hueDegrees(c[roleB]));
          expect(contrast >= MIN_DISTINGUISHABLE_CONTRAST || hueDelta >= MIN_DISTINGUISHABLE_HUE_DEG).toBe(true);
        });
      }

      it("accent and positive are the same green, deliberately — not a drift bug", () => {
        expect(c.accent).toBe(c.positive);
      });
    });
  }
});

// A `ColorRole` text sitting directly on a plain `SURFACES` entry is not the only ground it can
// be painted on: this product tints a plain surface with a translucent 10%-opacity wash of a
// semantic role in two places — `bg-negative/10` (the draft room's "hot" rail, `room-rail.tsx`'s
// `MODE_SKIN.hot`, live while a team is on the clock) and `bg-accent/10` (`celebration.tsx`'s
// "self" emphasis and `budget-table.tsx`'s own-row highlight). The pair matrix above cannot see
// this: a role can clear 4.5:1 against `surface` itself and still miss the floor once 10% of a
// saturated hue is mixed into that same ground — exactly what happened to `light.textMuted`,
// `light.negative` and `light.warning` against `light.negative`'s own 10% tint. Axe-core caught
// it on the draft room's real, built CSS (`e2e/design-v2.spec.ts`'s color-contrast scan); this
// block makes the same class of gap a `tokens.test.ts` numbers failure from now on. `blendOver`
// reproduces the flat sRGB composite a Tailwind `bg-<role>/10` utility paints and the one axe's
// own color-contrast check measures against.
const BAND_ALPHA = 0.1;

interface ColorBand {
  /** The semantic role whose hue tints the ground (`bg-<role>/10`). */
  readonly tint: ColorRole;
  /** The plain surface the tint is painted on top of. */
  readonly ground: ColorRole;
  /** Every role this product renders as text directly on this composite today. */
  readonly textRoles: readonly ColorRole[];
}

const COLOR_BANDS: readonly ColorBand[] = [
  // room-rail.tsx's MODE_SKIN.hot: the whole rail is `border-negative bg-negative/10` while a
  // team is on the clock, and its own text sits directly on that composite — the format badge
  // and InfoTip captions (`textMuted`), the turn label (`textMuted`), the "you're on the clock"
  // eyebrow (`negative`, swapped in when `turn.mine`), and the "Connecting…" chip (`warning`;
  // `Badge` carries no fill of its own, so it paints straight onto whatever is behind it).
  { tint: "negative", ground: "surface", textRoles: ["textMuted", "negative", "warning"] },
  // celebration.tsx's "self" emphasis (`border-accent bg-accent/10`) and budget-table.tsx's
  // own-row highlight (`bg-accent/10`) both put `textMuted`/`textPrimary` prose directly on the
  // tint, and both can land on either the page ground or a card.
  { tint: "accent", ground: "surface", textRoles: ["textMuted", "textPrimary"] },
  { tint: "accent", ground: "surfaceElevated", textRoles: ["textMuted", "textPrimary"] },
];

describe("TOKENS.color bands", () => {
  for (const theme of THEMES) {
    describe(theme, () => {
      const c = TOKENS.color[theme];

      for (const { tint, ground, textRoles } of COLOR_BANDS) {
        const composite = blendOver(c[tint], BAND_ALPHA, c[ground]);
        for (const role of textRoles) {
          it(`${role} on ${tint}/10 over ${ground} ≥ ${AA_TEXT}:1`, () => {
            expect(contrastRatio(c[role], composite)).toBeGreaterThanOrEqual(AA_TEXT);
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
      // would defeat that, so the same threshold that keeps the semantic roles apart applies
      // to all fifteen sticker pairs.
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
  it("body scale is strictly increasing", () => {
    const vals = Object.values(TOKENS.font.size);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
  });
  it("dense scale is strictly increasing and carries the same keys as the body scale", () => {
    const vals = Object.values(TOKENS.font.sizeDense);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
    expect(Object.keys(TOKENS.font.sizeDense).sort()).toEqual(Object.keys(TOKENS.font.size).sort());
  });
  it("dense scale is never larger than the body scale it densifies", () => {
    for (const key of Object.keys(TOKENS.font.size) as (keyof typeof TOKENS.font.size)[]) {
      expect(TOKENS.font.sizeDense[key]).toBeLessThanOrEqual(TOKENS.font.size[key]);
    }
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
