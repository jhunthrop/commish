import { describe, it, expect } from "vitest";
import { TOKENS, COLOR_ROLES, MAGNITUDE_STEPS, TIER_GRADES, type ColorRole, type MagnitudeStep, type PositionColorRole, type ThemeName } from "./tokens";
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

      /**
       * INVERTED FOR SUNDAY v5 (2026-08-28). Through v2, v3 and v4 this asserted that `accent`
       * and `positive` were the SAME green, on the argument that a live game and a live action
       * are one energy. v5 repeals that: law 4 gives the act its own channel (amber, which is
       * also the furniture and you) and the verdict its own pair (cyan against warm red).
       *
       * A timing tower has to be able to say "we rate him higher than the room does" without
       * that reading as "press this", and one pigment cannot carry both. Kept as an assertion
       * rather than deleted, because the doubling is the thing a careless palette edit would
       * silently restore.
       */
      it("keeps the act and the verdict on different channels — v5 repealed the doubling", () => {
        expect(c.accent).not.toBe(c.positive);
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

// THE MAGNITUDE RAMP — the heat map (docs/design/2026-08-27-fun-pass-spec.md, rule 1's largest
// amendment). Five steps: four verdicts and the absence of one. Four gates, and the third and
// fourth are what make this ramp different from the reference product's:
//
// 1. Every step clears AA text contrast on ALL FOUR surfaces, not the two `TEXT_ON_SURFACE`
//    checks the semantic roles against. A heat-coloured number lands in a table row, an inset
//    well and a raised tile exactly as readily as on the page ground, and unlike `warning` it has
//    no "demoted usage" story to fall back on — it is the number itself.
// 2. `neutral` IS `textPrimary`, deliberately, the same way `accent` IS `positive`. A number with
//    no stated comparison set has to be indistinguishable from ordinary text; give the "no
//    verdict" step a pigment of its own and every uncompared number in the product starts reading
//    as a judgement, which is the exact failure the spec forbids ("we do not colour a number
//    because it looks big").
// 3. The ramp is strictly ordered by CONTRAST AGAINST THE GROUND, never by hue. Green-versus-red
//    is the worst available pair for deuteranopia, which affects roughly one man in twelve, and
//    this product's audience is overwhelmingly men — so hue, the channel `DISTINGUISHABLE_PAIRS`
//    above is happy to accept, is precisely the channel this ramp may not lean on. Ordering by
//    contrast-against-`surface` also spares the gate a per-theme direction: "louder" is brighter
//    at night and darker in daylight, and one assertion covers both.
// 4. No verdict step may be visually interchangeable with `neutral`. A heat-coloured number and a
//    plain one have to differ in something a monochrome eye can see, or the tint is doing all the
//    work.
//
// None of this is the whole colourblind gate. Colour is never magnitude's only channel — the
// value reads plainly as its own number and a judged value carries a caret and a weight step —
// and THAT gate lives with the component that renders it, `src/components/ui/stat.test.tsx`.
// This block only proves the pigments are legible and correctly ordered.
const MAGNITUDE_SURFACES: readonly ColorRole[] = ["surface", "surfaceElevated", "surfaceRaised", "surfaceInset"];
/** The judged steps, best first. `neutral` sits between `good` and `weak` and is not on the ramp. */
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
        for (const surface of MAGNITUDE_SURFACES) {
          it(`${step} on ${surface} ≥ ${AA_TEXT}:1`, () => {
            expect(contrastRatio(m[step], c[surface])).toBeGreaterThanOrEqual(AA_TEXT);
          });
        }
      }

      it("makes the no-verdict step the ordinary ink, deliberately — an uncompared number is not a judgement", () => {
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

      it(`puts the ends of the ramp ≥ ${MIN_RAMP_END_CONTRAST}:1 apart, because green and red are the pair that vanishes`, () => {
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

/**
 * The tier ladder's own gate. A grade badge is an opaque fill carrying its own dark label, so it
 * has two jobs and this block checks both: the letter has to be readable ON the badge, and the
 * badge has to be findable AGAINST the row it divides — in both themes, because the palette is
 * theme-independent and only one of the two grounds was ever looked at while it was chosen.
 *
 * WHAT BREAKS WITHOUT IT: a band nobody can see is not a divider, it is decoration, and a grade
 * letter that washes into its own fill is a colour-only signal — the exact failure the
 * colourblind rule exists to forbid.
 */
describe("TOKENS.tier", () => {
  it("defines the same grades in both themes, so no band can exist in a theme nobody designed", () => {
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
        // The UI threshold, not the text one: the badge is a shape you have to FIND against the
        // ground, which is exactly what WCAG 1.4.11 sizes 3:1 for. The letter inside it carries
        // the text threshold, above. `surfaceElevated` is checked because a band sits between two
        // pool CARDS, not only on the page ground.
        for (const surface of ["surface", "surfaceElevated"] as const) {
          it(`${grade}'s badge is findable on ${surface} ≥ ${AA_LARGE_AND_UI}:1`, () => {
            expect(contrastRatio(t[grade].fill, c[surface])).toBeGreaterThanOrEqual(AA_LARGE_AND_UI);
          });
        }
      }

      // THE RANGE OF THE LADDER, not the separation of its rungs. Adjacent grades are close in hue
      // on purpose (see `TOKENS.tier`'s docblock) and every badge prints its own letter, so a
      // pairwise-hue rule would be the position stickers' gate applied to something that is an
      // ORDER rather than a set of categories. What has to be true is that top and bottom do not
      // look like the same grade — a ramp with no range is one colour spent four times.
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
    // THE DYNAMIC-RANGE GATE (docs/design/2026-08-27-fun-pass-spec.md, cause 3): "Sports
    // interfaces live on roughly 10x scale contrast — a huge number, a tiny label. We are at
    // about 2x. Uniform hierarchy is a document convention, and it is why the eye has nothing to
    // grab on any page."
    //
    // The two ends are real, not notional: the top of the display scale is what a `Stat` renders
    // its value at, and `xs` is the `EYEBROW` register every label in the product is set in. The
    // ratio is checked against BOTH emissions, because the dense scale shrinks the label without
    // shrinking the number and a gate that only saw the phone would be measuring the easy case.
    //
    // Range comes from SIZE and only from size — the ≤600 weight cap is rule 2 and does not move
    // (`weight-cap.source.test.ts` is what keeps it from being reached for instead).
    const MIN_DISPLAY_RANGE = 9;
    const largest = Math.max(...Object.values(TOKENS.font.display));
    expect(largest / TOKENS.font.size.xs).toBeGreaterThanOrEqual(MIN_DISPLAY_RANGE);
    expect(largest / TOKENS.font.sizeDense.xs).toBeGreaterThanOrEqual(MIN_DISPLAY_RANGE);
  });
  it("display line height is tighter than the tight body line height", () => {
    expect(TOKENS.font.lineHeight.display).toBeLessThan(TOKENS.font.lineHeight.tight);
  });

  /**
   * LAW 2's OWN NUMBER. The law is not "make it big", it is a stated ratio: *"A score is 84px;
   * its label is 11px"* — 7.6x. The dynamic-range gate above only asks for ≥9x against the top
   * of the display scale, which is the TV board's 116px; it would still pass if the scoreboard
   * step vanished. This pins the two values the law actually names, so the scale cannot drift
   * out from under the sentence in `docs/design-system.md` that quotes them.
   */
  it("puts a score at 84 and its label at 11 — law 2's stated 7.6x, not a nearby ratio", () => {
    expect(TOKENS.font.display["2xl"]).toBe(84);
    expect(TOKENS.font.size.xs).toBe(11);
    expect(TOKENS.font.display["2xl"] / TOKENS.font.size.xs).toBeCloseTo(7.64, 1);
  });

  /**
   * LAW 4, MEASURED. "Tight leading, real tables, no decorative whitespace." v3 shipped
   * 1.06/1.2/1.5 and every surface drifted airy underneath it. The absolute ceilings below are
   * what "tighter than v3" means in numbers, so the claim survives the next person who nudges a
   * value for one screen's benefit.
   */
  it("sets leading tighter than v3 at every step, because density is the law not a preference", () => {
    const { display, tight, base } = TOKENS.font.lineHeight;
    expect(display).toBeLessThan(1.0);
    expect(tight).toBeLessThanOrEqual(1.15);
    expect(base).toBeLessThanOrEqual(1.45);
  });

  it("motion durations are strictly increasing", () => {
    const { fast, base, slow } = TOKENS.motion.duration;
    expect(fast).toBeLessThan(base);
    expect(base).toBeLessThan(slow);
  });

  /**
   * LAW 6's CAP, ENFORCED ON THE TOKEN RATHER THAN ON REVIEW. *"Nothing eases longer than
   * 250ms."* v3's `slow` was 320ms and every celebration in the product read from it, so the law
   * is only real if the token moves — a rule that lives in prose while the variable says 320 is
   * a rule the next author overrides by accident.
   *
   * `pulse` and `wire` are deliberately exempt, named here so the exemption is a decision rather
   * than an oversight: neither is an EASE. `pulse` is the live dot's cycle length and `wire` is a
   * ticker's loop — both are continuous states reporting something still true, not a transition
   * playing out. Law 6 caps transitions; it does not cap a clock.
   */
  it("keeps every eased duration inside law 6's 250ms ceiling", () => {
    const LAW_6_CEILING_MS = 250;
    const { fast, base, slow } = TOKENS.motion.duration;
    for (const eased of [fast, base, slow]) expect(eased).toBeLessThanOrEqual(LAW_6_CEILING_MS);
    expect(slow).toBe(LAW_6_CEILING_MS);
  });
});
