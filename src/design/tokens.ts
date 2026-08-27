export type ThemeName = "light" | "dark";

/** Every color role the product has, in each theme. */
export const COLOR_ROLES = [
  "surface",
  "surfaceElevated",
  "surfaceRaised",
  "surfaceInset",
  "line",
  "edge",
  "textPrimary",
  "textMuted",
  "textFaint",
  "accent",
  "accentText",
  "accentGlow",
  "positive",
  "negative",
  "negativeText",
  "warning",
  "warningGlow",
  "info",
  "scrim",
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

/** The six positions a player can occupy — the sticker colors of the draft board. */
export type PositionColorRole = "qb" | "rb" | "wr" | "te" | "k" | "def";

export interface PositionColor {
  /** The sticker card's fill. */
  readonly sticker: string;
  /** The label printed ON the sticker. ≥4.5:1 against `sticker`. */
  readonly stickerText: string;
  /** The position's hue used AS text on a surface. ≥4.5:1 against `surface` and `surfaceElevated`. */
  readonly text: string;
}

type Palette = Readonly<Record<ColorRole, string>>;
type PositionPalette = Readonly<Record<PositionColorRole, PositionColor>>;

/**
 * Both themes are first-class (founder ruling, 2026-08-23 — revised ruling 1). `surface`
 * through `edge` are the four steps of depth the mocks use (ground, panel, raised row/field,
 * inset track/well) plus the two edge roles: `line` separates two surfaces decoratively, `edge`
 * bounds a control a user must find (see `tokens.test.ts`'s "gives an interactive boundary its
 * own role"). One `ColorRole` union, one role set, two designed palettes.
 */
interface Pigments {
  readonly whistle: string;
  readonly leaf: string;
  readonly marker: string;
  readonly clay: string;
  readonly grape: string;
  readonly slate: string;
}

/**
 * Dark — the room at night, and the v3 identity: the founder-approved Sunday Standard mock
 * (docs mock `sunday-standard.html`, approved 2026-08-24) is dark-first, and this is what it
 * specifies verbatim for the six roles it names directly (`surface`, `surfaceElevated`,
 * `surfaceInset`, `line`, `accent`, `negative`). v2's mint-on-ink identity is retired — the
 * founder rejected that direction outright; v3 is near-monochrome, with color reserved for
 * money (`accent`/`positive`) and live/failure (`negative`) rather than spread across the
 * surface. Every role NOT named by the mock (`surfaceRaised`, `edge`, `textFaint`, `warning`,
 * `info`, and both `*Text`/`*Glow` pairs) is derived here and proven against `tokens.test.ts` —
 * the gates that never moved.
 */
const dark: Palette = {
  /**
   * THE GROUND, LIFTED — founder ruling 2026-08-27, from the four-candidate study
   * (`docs/design/2026-08-27-dark-ground-study.md`): "the dark mode is too dark", candidate C.
   *
   * The v3 mock specified #0D0D0F, and shipping it taught us what the mock could not: at that
   * floor the four-step depth model spans fifteen points of luminance, which nobody sees. Paired
   * with rule 4 (hairlines, not boxes) every surface collapsed onto one plane and the room read
   * as an absence rather than a designed ground — the founder's word for it was a void, looking
   * at a finished mock draft.
   *
   * The fix is the RAMP more than the floor: this lifts the ground thirteen points but doubles
   * the ground-to-raised span to thirty, so a panel reads as a panel without becoming a box. The
   * near-monochrome identity is untouched — colour still means money (`accent`) and live
   * (`negative`), and nothing here spreads pigment across the surface.
   *
   * Text softens with it (`textPrimary` #F4F4F6 → #EAEAF0): #F4F4F6 on this ground is 15.7:1,
   * roughly twice what AAA asks, and that surplus reads as harsh rather than crisp — it halates
   * on OLED. Every role below still clears its own gate in `tokens.test.ts`, which is the
   * authority on that claim, not this comment.
   */
  surface: "#1A1A21", // slate — the ground
  surfaceElevated: "#26262F", // card — a panel
  // Derived: one step brighter than surfaceElevated, keeping the four-step depth model
  // (ground darkest, then the inset well, then the panel, then a raised row/tile closest to the
  // viewer) legible — and now actually visible, which was the whole point of the ruling.
  surfaceRaised: "#2F2F39",
  surfaceInset: "#1F1F27", // track, well, unfilled meter, the wire's band
  line: "#3B3B47", // the decorative hairline between two surfaces
  // Derived: a quiet, near-neutral gray (same cool family as textMuted) tuned so it clears
  // WCAG 1.4.11's 3:1 against all three surfaces a control can sit on — the mock has no
  // control-boundary value of its own.
  edge: "#7A7A80", // lifted with the ground (2026-08-27 slate ruling); minimal hue-preserving bump to clear its gate
  textPrimary: "#EAEAF0",
  textMuted: "#9EA0AD",
  // Derived: the mock's --faint (#5D5D66) is a night-appropriate gray but too dark to clear
  // 4.5:1 against surfaceRaised (the brightest of the four surfaces textFaint is used on) —
  // brightened, same hue family, until it clears the floor on all four. The token moves, the
  // threshold does not.
  textFaint: "#9898A0", // lifted with the ground (2026-08-27 slate ruling); minimal hue-preserving bump to clear its gate
  accent: "#3ECF8E", // money — links, focus rings, seat segments
  // Derived: a label ≥4.5:1 on the money fill. Money is never a button fill in v3, but the role
  // keeps a valid pair.
  accentText: "#04120A",
  accentGlow: "rgba(62, 207, 142, 0.14)", // the floodlight's radial tint (Task 7)
  // `accent` and `positive` are the SAME green, deliberately — v2's identity is that a live
  // game and a live action are the same energy, and v3 keeps the doubling verbatim (only the
  // hex moved). See docs/design-system.md, "One pigment, two jobs": green is a fill only when
  // it is an action; a positive outcome is green as text, a glow or a meter fill, never as a
  // solid button-shaped block.
  positive: "#3ECF8E",
  negative: "#FF6B5E", // live — the mock's failure family: clocks, live chips, destructive
  // Derived: a label ≥4.5:1 on the live fill.
  negativeText: "#04120A",
  // Derived: a quiet amber, same hue family as v2's, resaturated down and retuned to clear
  // 4.5:1 as text on the new (darker) grounds. v3 demotes warning's USAGE (E5) so the clock
  // tightening keeps a voice without the shelf glowing — the role survives, quieter.
  warning: "#BA9335", // lifted with the ground (2026-08-27 slate ruling); minimal hue-preserving bump to clear its gate
  warningGlow: "rgba(173, 126, 14, 0.12)",
  // Derived: a quiet blue, same hue family as v2's, retuned for notices and the WR pigment.
  info: "#5F99F2", // lifted with the ground (2026-08-27 slate ruling); minimal hue-preserving bump to clear its gate
  scrim: "#000000",
};

/**
 * Light — the same room in daylight, designed to the same roles and the same contrast
 * thresholds, never derived from `dark` by inversion (founder ruling, 2026-08-23). `surface`
 * is the mock's paper (`#FBFBFA`); depth moves the OTHER direction from dark's monotonic climb,
 * because a light UI's brightest surface is the card, not the page — `surfaceElevated` is the
 * peak (white, the mock's `--card`), and `surfaceRaised`/`surfaceInset` step down from the page
 * toward gray as a field or a well recedes. `accent`/`positive`/`negative`/`warning`/`info`
 * keep dark's hue families, darkened and saturated until they clear 4.5:1 as text directly on
 * `surface` — a naive inversion (dark's bright mint literally on white) fails that badly.
 */
const light: Palette = {
  surface: "#FBFBFA", // paper — the ground, the mock's --bg
  surfaceElevated: "#FFFFFF", // card — the brightest surface, not a step further from it
  // Derived: one hairline step darker than surfaceElevated, a shade toward gray — keeps the
  // four-step depth model (elevated peak, then the page, then a raised row/tile, then the
  // inset well recedes furthest) without the mock naming this step directly.
  surfaceRaised: "#F8F8F6",
  surfaceInset: "#F3F3F1", // track, well, unfilled meter — the mock's --tickbg
  line: "#E8E8EA", // the decorative hairline between two surfaces
  // Derived: a quiet, near-neutral gray (same cool family as textMuted) tuned so it clears
  // WCAG 1.4.11's 3:1 against all three surfaces a control can sit on.
  edge: "#8B8B91",
  textPrimary: "#1A1A1E", // ink — also the ink pill's fill (see Button, Task 4)
  // Derived, retuned (Task 1 fix round 1): darkened one further notch past the mock's raw
  // "quiet" gray. `tokens.test.ts`'s original pair matrix only checked this role against the
  // four PLAIN surfaces (`surface`/`surfaceElevated`/`surfaceRaised`/`surfaceInset`), which it
  // clears comfortably at either value — but the draft room's "hot" rail paints a translucent
  // `bg-negative/10` tint UNDER this text (`room-rail.tsx`'s `MODE_SKIN.hot`), and axe's
  // real-browser color-contrast scan (`e2e/design-v2.spec.ts`) caught that the untinted value
  // measured only 4.45:1 against that composited ground in daylight — a hair under the 4.5:1
  // floor the plain-surface checks never exercised. See `TOKENS.color bands` below.
  textMuted: "#68686D",
  // Derived: the mock's --faint (#AEAEB4) is a daylight-appropriate gray but too light to clear
  // 4.5:1 against surfaceInset (the dimmest of the four surfaces textFaint is used on) —
  // darkened, same hue family, until it clears the floor on all four. The token moves, the
  // threshold does not.
  textFaint: "#6D6D76",
  accent: "#0B6B43", // money — links, focus rings, seat segments
  // Derived: a label ≥4.5:1 on the money fill.
  accentText: "#FFFFFF",
  accentGlow: "rgba(11, 107, 67, 0.12)", // the floodlight's radial tint (Task 7)
  // Same doubling as dark, same reason — see `dark.positive`'s docblock.
  positive: "#0B6B43",
  // Derived, retuned (Task 1 fix round 1): live — darkened further than the fraction the mock's
  // raw #D6453A was already missing by. `negative` is both the "hot" rail's text-on-its-own-tint
  // color (the on-the-clock label, `text-negative` in `room-rail.tsx`) AND the source color OF
  // that tint (`bg-negative/10`), so this is a fixed point: the value darkens until it clears
  // 4.5:1 against the very 10%-of-itself-over-`surface` composite it paints. See
  // `TOKENS.color bands` below — the plain-surface checks alone (still ≥5.3:1 here) never would
  // have caught this.
  negative: "#C23228",
  negativeText: "#FFFFFF", // label ≥4.5:1 on the live fill
  // Derived, retuned (Task 1 fix round 1): a quiet amber, same hue family as v2's, resaturated
  // down. Darkened one further notch past the original retune: the "Connecting…" chip
  // (`ConnectionBanner`, `Badge tone="warning"`) has no fill of its own, so it sits directly on
  // whatever is behind it — inside the draft room's "hot" rail, that is the same `bg-negative/10`
  // composite `textMuted`'s comment above describes, and axe caught the same class of gap here.
  // See `dark.warning`'s docblock for the usage-demotion context (E5), and
  // `TOKENS.color bands` below for the composite-ground gate.
  warning: "#846315",
  warningGlow: "rgba(132, 99, 21, 0.12)",
  // Derived: a quiet blue, same hue family as v2's, retuned for notices and the WR pigment.
  info: "#4C69CD",
  scrim: "#000000",
};

/**
 * The Poster Board's marker set, one pack per theme, each re-derived against its own ground
 * (`dark.surface` #1A1A21, `light.surface` #FBFBFA).
 *
 * RETONED (LED-2, founder-delegated design ruling, 2026-08-24, persona-adjudicated) then
 * RE-DERIVED for v3's Sunday Standard grounds, same date: these six used to be a straight
 * doubling of a semantic role's own hex — `whistle` (QB) was literally `dark.negative`, `leaf`
 * (RB) was `dark.positive`, `marker` (WR) was `dark.info`, `clay` (TE) was `dark.warning`. The
 * gauntlet named that doubling as the product's last old-software signal: a full-cell sticker
 * fill at semantic-role saturation reads as a spreadsheet, not a board. The ruling is narrow —
 * position color STAYS as scanning information (the veteran reads the position off the color
 * before the letters), and the six hues stay distinct — only the SATURATION was the complaint.
 * Each pigment below is its own value, one HSL desaturation pass off the semantic hue it used
 * to share (60% of the semantic role's saturation, same hue, same lightness as a starting
 * point) — no longer pinned to the semantic role's own hex, so a position sticker and its
 * one-time semantic twin can move independently. `negative`, `positive`, `info` and `warning`
 * still carry full saturation everywhere else in the product (an error state should not read as
 * quiet), while the board's own fills read calmer.
 *
 * `marker` (WR, both themes' straight 60%-saturation point) and `clay` (TE, dark theme's) missed
 * the 4.5:1 text-on-surface floor once plugged into v3's near-monochrome grounds — those two
 * keep the same hue and a comparably reduced saturation but had their LIGHTNESS retuned (darker
 * for `marker` in daylight, brighter for `clay` at night) until they cleared. Every other
 * pigment's straight 60%-saturation/same-lightness value already cleared with margin, so it was
 * left alone — values move only as far as the gate requires.
 *
 * `grape` (K) and `slate` (DEF) never doubled a semantic role; `grape` gets the same
 * desaturation-pass hue family for consistency, `slate` is untouched — it was already the quiet
 * one by design (its meaning is "no color of its own"). Both cleared v3's grounds without
 * retuning, so neither value moved. `tokens.test.ts`'s sticker matrix is the gate this pass is
 * proven against, in both themes: every pairwise sticker still clears 1.5:1 contrast or 30° of
 * hue separation, and `marker`/`slate` (the one pair that was ALREADY hue-adjacent, ~0-9° apart,
 * riding on contrast alone) still clear it with margin to spare.
 *
 * Task 1 fix round 1 retuned `light.negative` and `light.warning` further (a translucent-band
 * gap the sticker matrix can't see — see those two fields' own docblocks and `TOKENS.color
 * bands` in `tokens.test.ts`). The pigments below are UNCHANGED: a sticker fill is always
 * painted opaque, never composited into a translucent band, so the sticker matrix that already
 * proved these values stands. `whistle`/`clay`'s "was #…" comments below name the ANCHOR hex at
 * the time each pigment was derived, not `negative`/`warning`'s current value — the two roles
 * moved out from under an already-proven pigment, which is exactly what "no longer pinned to the
 * semantic role's own hex" (above) means in practice.
 */
const darkPigments: Pigments = {
  whistle: "#DF867E", // v3 dark.negative #FF6B5E, 60% saturation, same hue/lightness
  leaf: "#5BB28B", // v3 dark.accent/positive #3ECF8E, 60% saturation, same hue/lightness
  marker: "#6790CE", // v3 dark.info #5F99F2, 60%-family saturation, lightness retuned for the slate ground
  clay: "#A78C4A", // v3 dark.warning #BA9335, 60%-family saturation, lightness retuned to clear 4.5:1
  grape: "#C2A2E8", // independent purple, unchanged — already clears v3's grounds
  slate: "#3E4A5C", // unchanged — already the quiet one, already clears v3's grounds
};

const lightPigments: Pigments = {
  whistle: "#B35750", // light.negative's Task 1 anchor #D43A2F (since retuned to #C23228), 60% saturation, same hue/lightness
  leaf: "#1E5840", // v3 light.accent/positive #0B6B43, 60% saturation, same hue/lightness
  marker: "#5D70AF", // v3 light.info #4C69CD, 60%-family saturation, lightness retuned to clear 4.5:1
  clay: "#76612F", // light.warning's Task 1 anchor #8E6A17 (since retuned to #846315), 60% saturation, same hue/lightness
  grape: "#6D528D", // independent purple, unchanged — already clears v3's grounds
  slate: "#B9C0CB", // unchanged — already the quiet one, already clears v3's grounds
};

/** One sticker: the fill, the label printed on it, and the hue's text-on-surface variant. */
function stickerOf(fill: string, label: string, text: string = fill): PositionColor {
  return { sticker: fill, stickerText: label, text };
}

const darkPositions: PositionPalette = {
  qb: stickerOf(darkPigments.whistle, dark.negativeText),
  rb: stickerOf(darkPigments.leaf, dark.accentText),
  wr: stickerOf(darkPigments.marker, dark.negativeText),
  te: stickerOf(darkPigments.clay, dark.negativeText),
  k: stickerOf(darkPigments.grape, "#1A0B33"),
  // DEF is the one sticker that stays dark: its meaning is "no color of its own", and a bright
  // slate would be indistinguishable from the WR blue beside it. Its fill is too dark to read
  // as text on the room's surfaces, so its `text` variant is a separate, brightened steel.
  def: stickerOf(darkPigments.slate, dark.textPrimary, "#A9B4C4"),
};

const lightPositions: PositionPalette = {
  qb: stickerOf(lightPigments.whistle, "#FFFFFF"),
  rb: stickerOf(lightPigments.leaf, "#FFFFFF"),
  wr: stickerOf(lightPigments.marker, "#FFFFFF"),
  te: stickerOf(lightPigments.clay, "#FFFFFF"),
  k: stickerOf(lightPigments.grape, "#FFFFFF"),
  // DEF is the quiet one in light too, inverted: its fill is a pale, muted steel — too LIGHT to
  // read as its own label or as text on the room's surfaces, so it takes a dark label and a
  // separate, darkened `text` variant, the mirror image of dark's brightened one.
  def: stickerOf(lightPigments.slate, light.textPrimary, "#4B5563"),
};

export const TOKENS = {
  color: { light, dark },
  position: { light: lightPositions, dark: darkPositions },
  radius: { sm: 4, md: 8, lg: 12, pill: 999 },
  font: {
    /** Base scale, px — what a phone gets. */
    size: { xs: 12, sm: 13.5, md: 15, lg: 17, xl: 20, "2xl": 26, "3xl": 34 },
    /** The dense scale, px — emitted inside a min-width media query at
     *  `UI_CONFIG.shell.denseFromPx`. Same keys as `size`; a component never writes
     *  `text-sm lg:text-xs` because density is a property of the viewport, expressed once. */
    sizeDense: { xs: 11, sm: 12.5, md: 13.5, lg: 15, xl: 17, "2xl": 22, "3xl": 30 },
    /**
     * Display scale, px — the display face only. Deliberately a SEPARATE scale from `size`:
     * these sizes interleave with the body scale numerically, and a display size is never a
     * substitute for a body size at the same px (see docs/design-system.md). `xs` in the body
     * scale is for letter-spaced eyebrows only (mono, sentence case — the caps charter removed
     * the uppercase treatment `xs` carried before v3), never a sentence — the rule this
     * scale's own docblock neighbor. `xl` is 58 (was 64 in v2) — the Sunday Standard mock's
     * display size (self-ruling S3); the display tracking rule that pairs with it lives in
     * globals.css, not here.
     */
    display: { sm: 20, md: 28, lg: 44, xl: 58 },
    lineHeight: { display: 1.06, tight: 1.2, base: 1.5 },
  },
  /**
   * Paper depth. Theme-independent on purpose: a shadow is cast light, and on the dark surface
   * the border/edge roles do the separating instead — a lightened "shadow" would read as a glow.
   */
  shadow: {
    card: "0 1px 2px rgb(22 24 29 / 0.06), 0 1px 3px rgb(22 24 29 / 0.05)",
    sticker: "0 2px 0 rgb(22 24 29 / 0.14)",
  },
  motion: {
    /** ms */
    duration: {
      fast: 120,
      base: 200,
      slow: 320,
      /** The live chip's pulse cycle. */
      pulse: 1_600,
      /** The mock's ticker loop. */
      wire: 38_000,
    },
    easing: { standard: "cubic-bezier(0.2, 0, 0, 1)", emphasized: "cubic-bezier(0.3, 0, 0, 1)" },
  },
  /** Minimum supported viewport width, px (mobile-first baseline). */
  minViewport: 360,
} as const;
