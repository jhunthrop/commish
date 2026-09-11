import { describe, it, expect } from "vitest";
import { TOKENS, COLOR_ROLES, MAGNITUDE_STEPS, TIER_GRADES, type ColorRole, type MagnitudeStep, type PositionColorRole, type ThemeName } from "./tokens";
import { contrastRatio, hueDegrees, hueDistance, blendOver } from "./test-support";

const THEMES: readonly ThemeName[] = ["light", "dark"];
const AA_TEXT = 4.5;
const AA_LARGE_AND_UI = 3;

/**
 * Two colors used for distinct meanings must not be visually interchangeable, even when both
 * clear AA text contrast on a surface. SIDELINE spends six pigments and four of them are chroma
 * that can land beside each other on one row: Court blue (the verb), Streak amber (you), Live
 * green (live, a good outcome) and Rival rose (your opponent, the swing against you). Every
 * pair of those four is held apart. Pairs that are the SAME pigment by design (`positive`/`live`,
 * `negative`/`warning`, `accent`/`info`) are pinned equal below instead, so a palette tune can
 * neither drift them apart into a seventh pigment nor quietly merge two that must differ.
 */
const MIN_DISTINGUISHABLE_CONTRAST = 1.5;
const MIN_DISTINGUISHABLE_HUE_DEG = 30;
const DISTINGUISHABLE_PAIRS: readonly (readonly [ColorRole, ColorRole])[] = [
  ["accent", "negative"],
  ["accent", "live"],
  ["accent", "self"],
  ["positive", "negative"],
  ["live", "self"],
  ["negative", "self"],
];

// Every text/foreground role that sits directly on a surface must clear AA text contrast.
// `scrim` is absent (a translucent backdrop, never text). The `*Text` roles are checked against
// the FILL they label, not against a surface. `self` is a fill and a ring, never text: its text
// form is `selfInk`, which is the role checked here.
const TEXT_ON_SURFACE: readonly ColorRole[] = ["textPrimary", "textMuted", "textFaint", "accent", "positive", "negative", "live", "warning", "info", "selfInk"];
const SURFACES: readonly ColorRole[] = ["surface", "surfaceElevated"];
const ALL_SURFACES = ["surface", "surfaceElevated", "surfaceRaised", "surfaceInset"] as const;

describe("TOKENS.color", () => {
  it("carries the same role set in both palettes, so no surface can exist in a theme nobody designed", () => {
    for (const theme of THEMES) {
      expect(Object.keys(TOKENS.color[theme]).sort()).toEqual([...COLOR_ROLES].sort());
    }
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const c = TOKENS.color[theme];

      it("keeps every ink role readable on every surface it is used on", () => {
        // 4.5:1 on all four surfaces, the floor this palette has never relaxed: a faint caption
        // lands in a well and on a raised row as readily as on the page ground.
        for (const role of ["textPrimary", "textMuted", "textFaint"] as const) {
          for (const surface of ALL_SURFACES) {
            expect(contrastRatio(c[role], c[surface])).toBeGreaterThanOrEqual(AA_TEXT);
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
        expect(contrastRatio(c.accentText, c.accent)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrastRatio(c.negativeText, c.negative)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrastRatio(c.liveText, c.live)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrastRatio(c.selfText, c.self)).toBeGreaterThanOrEqual(AA_TEXT);
      });

      it("gives an interactive boundary its own role, because the hairline cannot carry one", () => {
        // `line` is decoration between two surfaces; `edge` bounds a control a person must FIND
        // and is held to WCAG 1.4.11's 3:1 on every one of the four surfaces it can sit on.
        expect(contrastRatio(c.line, c.surface)).toBeLessThan(AA_LARGE_AND_UI);
        expect(contrastRatio(c.line, c.surfaceElevated)).toBeLessThan(AA_LARGE_AND_UI);
        for (const surface of ALL_SURFACES) {
          expect(contrastRatio(c.edge, c[surface])).toBeGreaterThanOrEqual(AA_LARGE_AND_UI);
        }
      });

      for (const [roleA, roleB] of DISTINGUISHABLE_PAIRS) {
        it(`${roleA} and ${roleB} are distinguishable (contrast ≥ ${MIN_DISTINGUISHABLE_CONTRAST} or hue distance ≥ ${MIN_DISTINGUISHABLE_HUE_DEG}°)`, () => {
          const contrast = contrastRatio(c[roleA], c[roleB]);
          const hueDelta = hueDistance(hueDegrees(c[roleA]), hueDegrees(c[roleB]));
          expect(contrast >= MIN_DISTINGUISHABLE_CONTRAST || hueDelta >= MIN_DISTINGUISHABLE_HUE_DEG).toBe(true);
        });
      }

      /**
       * SIDELINE'S SIX, PINNED. The direction spends exactly six pigments, so three roles that
       * used to be free to differ are now the same value on purpose: a good outcome IS the live
       * green (a claim that hit), a clock running out IS the rival rose (the swing against you),
       * and a link IS the court blue (there is no second blue). The verb and the verdict stay on
       * different channels: `accent` is never `positive`.
       */
      it("keeps the act and the outcome on different channels", () => {
        expect(c.accent).not.toBe(c.positive);
      });

      it("spends six pigments and no more: positive is live, warning is rose, info is court blue", () => {
        expect(c.positive).toBe(c.live);
        expect(c.warning).toBe(c.negative);
        expect(c.info).toBe(c.accent);
      });

      it("never uses the amber fill as text: selfInk is the text form, and it differs from the fill wherever the fill fails", () => {
        // In daylight the amber fill measures about 2.4:1 on paper, so the text form has to be
        // its own darker value. At night the fill already clears, and the two may coincide.
        if (contrastRatio(c.self, c.surfaceElevated) < AA_TEXT) expect(c.selfInk).not.toBe(c.self);
        expect(contrastRatio(c.selfInk, c.surfaceInset)).toBeGreaterThanOrEqual(AA_TEXT);
      });
    });
  }
});

/**
 * A role sitting directly on a plain surface is not the only ground it can be painted on: the
 * product tints a surface with a translucent 10% wash of a semantic role (`bg-<role>/10`) and
 * puts text on the composite. A role can clear 4.5:1 against `surface` itself and still miss the
 * floor once 10% of a saturated hue is mixed into that ground. `blendOver` reproduces the flat
 * sRGB composite a Tailwind `bg-<role>/10` utility paints and the one axe measures against.
 */
const BAND_ALPHA = 0.1;

interface ColorBand {
  readonly tint: ColorRole;
  readonly ground: ColorRole;
  readonly textRoles: readonly ColorRole[];
}

const COLOR_BANDS: readonly ColorBand[] = [
  // The rival's wash: your opponent's chip, the swing against you.
  { tint: "negative", ground: "surface", textRoles: ["textMuted", "negative", "warning"] },
  { tint: "negative", ground: "surfaceElevated", textRoles: ["textMuted", "negative"] },
  // The verb's wash: the board's "on the clock" tile. Court blue INK never rides its own wash
  // (4.44:1 in daylight, 4.48:1 at night): the tile's words are ordinary ink.
  { tint: "accent", ground: "surface", textRoles: ["textMuted", "textPrimary"] },
  { tint: "accent", ground: "surfaceElevated", textRoles: ["textMuted", "textPrimary"] },
  // Your own row's wash, and the amber ink that rides on it.
  { tint: "self", ground: "surface", textRoles: ["textMuted", "textPrimary", "selfInk"] },
  { tint: "self", ground: "surfaceElevated", textRoles: ["textMuted", "textPrimary", "selfInk"] },
  // The live chip: live ink on its own wash.
  { tint: "live", ground: "surface", textRoles: ["textMuted", "live"] },
  { tint: "live", ground: "surfaceElevated", textRoles: ["textMuted", "live"] },
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

/**
 * THE MAGNITUDE RAMP (P11: tint only against a stated population, never as the only channel).
 * Four gates: every step clears AA on ALL FOUR surfaces; `neutral` IS `textPrimary`; the ramp is
 * strictly ordered by contrast against the ground, never by hue (green versus red is the pair
 * that vanishes for one man in twelve); no verdict step is interchangeable with `neutral`.
 * Colour is never magnitude's only channel: the caret and weight step live with `Stat`.
 */
const MAGNITUDE_RAMP: readonly MagnitudeStep[] = ["strong", "good", "weak", "bad"];
const MIN_ADJACENT_STEP_CONTRAST = 1.15;
const MIN_RAMP_END_CONTRAST = 1.5;
const MIN_VERDICT_VS_NEUTRAL_CONTRAST = 1.25;

describe("TOKENS.magnitude", () => {
  it("carries the same five steps in both palettes", () => {
    for (const theme of THEMES) {
      expect(Object.keys(TOKENS.magnitude[theme]).sort()).toEqual([...MAGNITUDE_STEPS].sort());
    }
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const c = TOKENS.color[theme];
      const m = TOKENS.magnitude[theme];

      for (const step of MAGNITUDE_STEPS) {
        for (const surface of ALL_SURFACES) {
          it(`${step} on ${surface} ≥ ${AA_TEXT}:1`, () => {
            expect(contrastRatio(m[step], c[surface])).toBeGreaterThanOrEqual(AA_TEXT);
          });
        }
      }

      it("makes the no-verdict step the ordinary ink, deliberately", () => {
        expect(m.neutral).toBe(c.textPrimary);
      });

      it("orders the ramp by contrast against the ground, so it reads as a ramp with no hue at all", () => {
        const ladder = MAGNITUDE_RAMP.map((step) => contrastRatio(m[step], c.surface));
        for (let i = 1; i < ladder.length; i++) {
          expect(ladder[i]).toBeLessThan(ladder[i - 1]!);
        }
      });

      for (let i = 1; i < MAGNITUDE_RAMP.length; i++) {
        const previous = MAGNITUDE_RAMP[i - 1]!;
        const step = MAGNITUDE_RAMP[i]!;
        it(`${previous} and ${step} are separated by luminance, not hue (≥ ${MIN_ADJACENT_STEP_CONTRAST}:1)`, () => {
          expect(contrastRatio(m[previous], m[step])).toBeGreaterThanOrEqual(MIN_ADJACENT_STEP_CONTRAST);
        });
      }

      it(`puts the ends of the ramp ≥ ${MIN_RAMP_END_CONTRAST}:1 apart`, () => {
        expect(contrastRatio(m.strong, m.bad)).toBeGreaterThanOrEqual(MIN_RAMP_END_CONTRAST);
      });

      for (const step of MAGNITUDE_RAMP) {
        it(`${step} is not interchangeable with an uncoloured number (≥ ${MIN_VERDICT_VS_NEUTRAL_CONTRAST}:1 vs neutral)`, () => {
          expect(contrastRatio(m[step], m.neutral)).toBeGreaterThanOrEqual(MIN_VERDICT_VS_NEUTRAL_CONTRAST);
        });
      }
    });
  }
});

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

      // A position is read off the colour before the letters, so every pair is held apart.
      for (let i = 0; i < POSITION_ROLES.length; i++) {
        for (let j = i + 1; j < POSITION_ROLES.length; j++) {
          const roleA = POSITION_ROLES[i]!;
          const roleB = POSITION_ROLES[j]!;
          it(`${roleA} and ${roleB} stickers are distinguishable`, () => {
            const contrast = contrastRatio(p[roleA].sticker, p[roleB].sticker);
            const hueDelta = hueDistance(hueDegrees(p[roleA].sticker), hueDegrees(p[roleB].sticker));
            expect(contrast >= MIN_DISTINGUISHABLE_CONTRAST || hueDelta >= MIN_DISTINGUISHABLE_HUE_DEG).toBe(true);
          });
        }
      }
    });
  }
});

/**
 * The tier ladder's gate: the letter readable ON the badge, the badge findable AGAINST the row
 * it divides, in both themes, and the ladder's ends far enough apart in hue that S never reads
 * as C. Adjacent rungs are close on purpose (the letter is the colourblind channel).
 */
describe("TOKENS.tier", () => {
  it("defines the same grades in both themes", () => {
    expect(Object.keys(TOKENS.tier.light).sort()).toEqual([...TIER_GRADES].sort());
    expect(Object.keys(TOKENS.tier.dark).sort()).toEqual([...TIER_GRADES].sort());
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const c = TOKENS.color[theme];
      const t = TOKENS.tier[theme];

      for (const grade of TIER_GRADES) {
        it(`${grade}'s letter on its own badge ≥ ${AA_TEXT}:1`, () => {
          expect(contrastRatio(t[grade].label, t[grade].fill)).toBeGreaterThanOrEqual(AA_TEXT);
        });
        for (const surface of SURFACES) {
          it(`${grade}'s badge is findable on ${surface} ≥ ${AA_LARGE_AND_UI}:1`, () => {
            expect(contrastRatio(t[grade].fill, c[surface])).toBeGreaterThanOrEqual(AA_LARGE_AND_UI);
          });
        }
      }

      it(`puts the ends of the ladder ≥ ${MIN_DISTINGUISHABLE_HUE_DEG}° apart in hue, so S never reads as C`, () => {
        const first = t[TIER_GRADES[0]!].fill;
        const last = t[TIER_GRADES[TIER_GRADES.length - 1]!].fill;
        expect(hueDistance(hueDegrees(first), hueDegrees(last))).toBeGreaterThanOrEqual(MIN_DISTINGUISHABLE_HUE_DEG);
      });
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
  it("carries roughly ten times the range between the biggest number on a screen and its label", () => {
    // P2's dynamic range: a huge number over a tiny caption. Checked against BOTH emissions,
    // because the dense scale shrinks the label without shrinking the number. Range comes from
    // SIZE and only from size; the weight cap (`weight-cap.source.test.ts`) does not move.
    const MIN_DISPLAY_RANGE = 9;
    const largest = Math.max(...Object.values(TOKENS.font.display));
    expect(largest / TOKENS.font.size.xs).toBeGreaterThanOrEqual(MIN_DISPLAY_RANGE);
    expect(largest / TOKENS.font.sizeDense.xs).toBeGreaterThanOrEqual(MIN_DISPLAY_RANGE);
  });
  it("display line height is tighter than the tight body line height", () => {
    expect(TOKENS.font.lineHeight.display).toBeLessThan(TOKENS.font.lineHeight.tight);
  });
  it("puts a score at 84 and its label at 11, the stated 7.6x", () => {
    expect(TOKENS.font.display["2xl"]).toBe(84);
    expect(TOKENS.font.size.xs).toBe(11);
    expect(TOKENS.font.display["2xl"] / TOKENS.font.size.xs).toBeCloseTo(7.64, 1);
  });

  /**
   * SIDELINE'S DENSITY, pinned by name: a name is 17px on a row in both emissions (a name is the
   * largest thing on the row and does not shrink with the viewport), rows are 48 with a 36 face,
   * research rows go to 44, and no object spends more than four columns.
   */
  it("sets the row name at 17px on the phone and at desktop density alike", () => {
    expect(TOKENS.font.size.lg).toBe(TOKENS.density.namePx);
    expect(TOKENS.font.sizeDense.lg).toBe(TOKENS.density.namePx);
  });

  it("carries Sideline's density constants: 48px rows, 36px faces, 17px names, 44px research rows, four columns", () => {
    expect(TOKENS.density).toEqual({ rowPx: 48, denseRowPx: 44, facePx: 36, namePx: 17, maxColumns: 4 });
    expect(TOKENS.density.denseRowPx).toBeLessThan(TOKENS.density.rowPx);
    expect(TOKENS.density.facePx).toBeLessThan(TOKENS.density.rowPx);
  });

  it("sets leading no looser than the density it inherited", () => {
    const { display, tight, base } = TOKENS.font.lineHeight;
    expect(display).toBeLessThan(1.0);
    expect(tight).toBeLessThanOrEqual(1.15);
    expect(base).toBeLessThanOrEqual(1.45);
  });

  /**
   * SIDELINE'S RADII, pinned value by value: 20 on a card and a sheet, 16 on a bubble, 12 on a
   * row plate and the avatar's ring, pills on buttons and chips. `shape` names which step each
   * object spends so a call site never chooses a corner.
   */
  it("carries the radius scale Sideline's primitives are drawn at, sm 8, md 12, lg 16, xl 20, pill", () => {
    expect(TOKENS.radius).toEqual({ sm: 8, md: 12, lg: 16, xl: 20, pill: 999 });
  });

  it("keeps the radius scale strictly increasing below pill", () => {
    const { sm, md, lg, xl, pill } = TOKENS.radius;
    expect(sm).toBeLessThan(md);
    expect(md).toBeLessThan(lg);
    expect(lg).toBeLessThan(xl);
    expect(xl).toBeLessThan(pill);
  });

  it("names every object's radius step from the scale: cards and sheets at 20, bubbles at 16, rows and rings at 12, chips and buttons pills", () => {
    const steps = Object.keys(TOKENS.radius);
    for (const step of Object.values(TOKENS.shape)) expect(steps).toContain(step);
    expect(TOKENS.radius[TOKENS.shape.card]).toBe(20);
    expect(TOKENS.radius[TOKENS.shape.sheet]).toBe(20);
    expect(TOKENS.radius[TOKENS.shape.bubble]).toBe(16);
    expect(TOKENS.radius[TOKENS.shape.row]).toBe(12);
    expect(TOKENS.radius[TOKENS.shape.avatarRing]).toBe(12);
    expect(TOKENS.radius[TOKENS.shape.chip]).toBe(999);
    expect(TOKENS.radius[TOKENS.shape.button]).toBe(999);
  });

  /**
   * SIDELINE'S ONE MATERIAL: two designed shadow sets over ONE key set (the parity contract
   * `TOKENS.color` keeps), a soft drop shadow in both, and no inset top-light in either. The
   * verb's glow is a tint of each theme's own Court blue.
   */
  it("carries the same shadow keys in both themes", () => {
    expect(Object.keys(TOKENS.shadow.light).sort()).toEqual(Object.keys(TOKENS.shadow.dark).sort());
  });

  it("draws the card as a soft drop shadow with no inset light, in both themes", () => {
    expect(TOKENS.shadow.light.card).not.toContain("inset");
    expect(TOKENS.shadow.dark.card).not.toContain("inset");
    expect(TOKENS.shadow.light.card).toContain("4px 16px");
    expect(TOKENS.shadow.dark.card).toContain("4px 16px");
  });

  it("derives each theme's verb glow from its own Court blue", () => {
    expect(TOKENS.shadow.light.verbGlow).toContain("36, 87, 245");
    expect(TOKENS.shadow.dark.verbGlow).toContain("91, 133, 255");
  });

  /**
   * P4, MEASURED. Transitions live between 150 and 400ms: a press, a leave, an arrival, and the
   * one longer celebration per moment. `highlight` (the wash on a changed number) is the one
   * motion Sideline states longer than the band, at 600ms. `breathe` and `wire` are clocks
   * reporting something still true, not eases, and are exempt by name.
   */
  it("keeps the arrival and the leave inside P4's 150 to 400ms band, the arrival slower than the leave", () => {
    const { fast, out, in: arrive, celebrate } = TOKENS.motion.duration;
    expect(out).toBeGreaterThanOrEqual(150);
    expect(arrive).toBeLessThanOrEqual(400);
    expect(celebrate).toBeLessThanOrEqual(400 + 80);
    expect(fast).toBeLessThan(out);
    expect(out).toBeLessThan(arrive);
    expect(arrive).toBeLessThan(celebrate);
  });

  it("names Sideline's durations: 240 in, 180 out, 600 highlight, 2s breathe", () => {
    expect(TOKENS.motion.duration.in).toBe(240);
    expect(TOKENS.motion.duration.out).toBe(180);
    expect(TOKENS.motion.duration.highlight).toBe(600);
    expect(TOKENS.motion.duration.breathe).toBe(2_000);
  });

  it("carries the spring for arrivals and the ease-out for leaves, and nothing else", () => {
    expect(TOKENS.motion.easing).toEqual({ spring: "cubic-bezier(0.2, 0.9, 0.3, 1.15)", out: "cubic-bezier(0.2, 0, 0, 1)" });
  });
});
