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
 * Dark — the room at night, and the v2 identity: the founder-approved mocks are dark-first, and
 * this is what they specify verbatim.
 */
const dark: Palette = {
  surface: "#0B0C0F", // the ground
  surfaceElevated: "#111318", // a panel
  surfaceRaised: "#161920", // a row hover, a field, a nested tile
  surfaceInset: "#1C2029", // a track, a slot well, an unfilled meter
  line: "#20242E", // the decorative hairline between two surfaces
  edge: "#6B7488", // the boundary of a control a user must find (>= 3:1)
  textPrimary: "#EDEFF4",
  textMuted: "#98A0B2",
  textFaint: "#808A9E", // retuned UP from the mock's #6B7488 to clear 4.5:1 at 12px
  accent: "#41E58A",
  accentText: "#04120A",
  accentGlow: "rgba(65, 229, 138, 0.14)",
  // `accent` and `positive` are the SAME green, deliberately — v2's identity is that a live
  // game and a live action are the same energy. See docs/design-system.md, "One pigment, two
  // jobs": green is a fill only when it is an action; a positive outcome is green as text, a
  // glow or a meter fill, never as a solid button-shaped block.
  positive: "#41E58A",
  negative: "#FF5A52",
  negativeText: "#04120A",
  warning: "#FFB224",
  warningGlow: "rgba(255, 178, 36, 0.12)",
  info: "#5B9BFF",
  scrim: "#000000",
};

/**
 * Light — the same room in daylight, designed to the same roles and the same contrast
 * thresholds, never derived from `dark` by inversion (founder ruling, 2026-08-23). `surface`
 * is a cool near-white; depth moves the OTHER direction from dark's monotonic climb, because a
 * light UI's brightest surface is the card, not the page — `surfaceElevated` is the peak
 * (white), and `surfaceRaised`/`surfaceInset` step down from the page toward gray as a field or
 * a well recedes. `accent`/`positive`/`negative`/`warning`/`info` keep dark's hue families,
 * darkened and saturated until they clear 4.5:1 as text directly on `surface` — a naive
 * inversion (dark's bright mint literally on white) fails that by roughly 3x.
 */
const light: Palette = {
  surface: "#F5F6F8", // the ground
  surfaceElevated: "#FFFFFF", // a panel — the brightest surface, not a step further from it
  surfaceRaised: "#ECEEF2", // a row hover, a field, a nested tile — a shade toward gray
  surfaceInset: "#E3E6EB", // a track, a slot well, an unfilled meter — grayer still
  line: "#D8DCE3", // the decorative hairline between two surfaces
  edge: "#5B6478", // the boundary of a control a user must find (>= 3:1)
  textPrimary: "#16181D",
  textMuted: "#565C68",
  textFaint: "#5A6270",
  accent: "#12784A",
  accentText: "#FFFFFF",
  accentGlow: "rgba(18, 120, 74, 0.12)",
  // Same doubling as dark, same reason — see `dark.positive`'s docblock.
  positive: "#12784A",
  negative: "#B0202F",
  negativeText: "#FFFFFF",
  warning: "#8A5A0B",
  warningGlow: "rgba(138, 90, 11, 0.12)",
  info: "#2547B8",
  scrim: "#000000",
};

/**
 * The Poster Board's marker set, one pack per theme, each re-derived against its own ground
 * (`dark.surface` #0B0C0F, `light.surface` #F5F6F8). Six pigments do all the coloring in this
 * product. Two still double as a semantic role with a unique hex in both themes: `whistle` (QB)
 * is `negative`, `clay` (TE) is `warning`. `leaf` (RB) doubles as `positive`, which is the SAME
 * hex as `accent` in both themes; since `accent`/`positive` collapsed into one green, `marker`
 * (WR) can no longer also be `accent` without becoming indistinguishable from `leaf` (RB) — the
 * sticker test's pairwise check is what would catch that. `marker` is `info`'s blue instead:
 * still a shared hex with a semantic role, just a different one. `grape` (K) and `slate` (DEF)
 * carry no semantic role, as before. The doubling is safe because the two uses never share a
 * context — see docs/design-system.md, "One pigment, two jobs".
 */
const darkPigments: Pigments = {
  whistle: dark.negative,
  leaf: dark.positive,
  marker: dark.info,
  clay: dark.warning,
  grape: "#C08BFF",
  slate: "#3E4A5C",
};

const lightPigments: Pigments = {
  whistle: light.negative,
  leaf: light.positive,
  marker: light.info,
  clay: light.warning,
  grape: "#6B3FA0",
  slate: "#B9C0CB",
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
     * scale is for letter-spaced uppercase eyebrows only, never a sentence — the rule this
     * scale's own docblock neighbor.
     */
    display: { sm: 20, md: 28, lg: 44, xl: 64 },
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
    duration: { fast: 120, base: 200, slow: 320 },
    easing: { standard: "cubic-bezier(0.2, 0, 0, 1)", emphasized: "cubic-bezier(0.3, 0, 0, 1)" },
  },
  /** Minimum supported viewport width, px (mobile-first baseline). */
  minViewport: 360,
} as const;
