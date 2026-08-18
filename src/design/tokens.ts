export type ThemeName = "light" | "dark";

export type ColorRole =
  | "surface"
  | "surfaceElevated"
  | "border"
  | "textPrimary"
  | "textMuted"
  | "accent"
  | "accentText"
  | "positive"
  | "negative"
  | "negativeText"
  | "warning"
  | "scrim";

/** The six positions a player can occupy — the sticker colors of the draft board. */
export type PositionColorRole = "qb" | "rb" | "wr" | "te" | "k" | "def";

export interface PositionColor {
  /** The sticker card's fill. */
  readonly sticker: string;
  /** The label printed ON the sticker. ≥4.5:1 against `sticker`. */
  readonly stickerText: string;
  /** The position's hue used AS text on a surface. ≥4.5:1 against both surfaces. */
  readonly text: string;
}

type Palette = Readonly<Record<ColorRole, string>>;
type PositionPalette = Readonly<Record<PositionColorRole, PositionColor>>;

/**
 * The Poster Board's marker set. Six pigments do all the coloring in this product, and four
 * of them carry a semantic role as well as a position:
 *
 * | pigment    | position | semantic role |
 * |------------|----------|---------------|
 * | `whistle`  | QB       | `negative`    |
 * | `leaf`     | RB       | `positive`    |
 * | `marker`   | WR       | `accent`      |
 * | `clay`     | TE       | `warning`     |
 * | `grape`    | K        | —             |
 * | `slate`    | DEF      | —             |
 *
 * The doubling is deliberate, not an accident of picking similar hexes: a real draft kit
 * has one pack of markers, and reusing them is what makes the board and the chrome look
 * like one object. It is safe because the two uses never share a context — a position color
 * only ever appears inside a `PositionBadge` or a board sticker, and a semantic color never
 * appears inside either (see docs/design-system.md, "One pigment, two jobs").
 */
interface Pigments {
  readonly whistle: string;
  readonly leaf: string;
  readonly marker: string;
  readonly clay: string;
  readonly grape: string;
  readonly slate: string;
}

/** Light — the poster itself: white card stock, near-black ink, markers doing the talking. */
const PAPER = "#F6F5F1";
const CARD_STOCK = "#FFFFFF";
const INK = "#16181D";
const GRAPHITE = "#5A5E66";
/** Pencil hairline. Darkened from a true hairline so it clears the 3:1 non-text UI rule. */
const PENCIL = "#8E8A7E";

const lightPigments: Pigments = {
  whistle: "#B01F35",
  leaf: "#146C3C",
  marker: "#2547B8",
  clay: "#9F5410",
  grape: "#632EB8",
  slate: "#2F3742",
};

/** Dark — the board wall at night: warm-neutral charcoal, chalk lettering, brighter markers. */
const WALL = "#17181A";
const PANEL = "#202225";
const CHALK = "#F2EFE9";
const CHALK_MUTED = "#A8A69F";
const CHALK_LINE = "#66676C";
/** The darkest surface in the dark theme — what a bright sticker prints its label in. */
const NIGHT = "#14161A";

const darkPigments: Pigments = {
  whistle: "#FF6B5E",
  leaf: "#5EC77E",
  marker: "#7AA5FF",
  clay: "#E5B054",
  grape: "#B48CFF",
  // DEF is the one sticker that stays dark at night: its meaning is "no color of its own",
  // and a bright slate would be indistinguishable from the WR blue beside it.
  slate: "#3E4650",
};

const light: Palette = {
  surface: PAPER,
  surfaceElevated: CARD_STOCK,
  border: PENCIL,
  textPrimary: INK,
  textMuted: GRAPHITE,
  accent: lightPigments.marker,
  accentText: CARD_STOCK,
  positive: lightPigments.leaf,
  negative: lightPigments.whistle,
  negativeText: CARD_STOCK,
  warning: lightPigments.clay,
  /** Modal backdrop overlay. Not text — excluded from the contrast-on-surface checks. */
  scrim: INK,
};

const dark: Palette = {
  surface: WALL,
  surfaceElevated: PANEL,
  border: CHALK_LINE,
  textPrimary: CHALK,
  textMuted: CHALK_MUTED,
  accent: darkPigments.marker,
  accentText: NIGHT,
  positive: darkPigments.leaf,
  negative: darkPigments.whistle,
  negativeText: NIGHT,
  warning: darkPigments.clay,
  scrim: "#000000",
};

/** One sticker: the fill, the label printed on it, and the hue's text-on-surface variant. */
function stickerOf(fill: string, label: string, text: string = fill): PositionColor {
  return { sticker: fill, stickerText: label, text };
}

const lightPositions: PositionPalette = {
  qb: stickerOf(lightPigments.whistle, CARD_STOCK),
  rb: stickerOf(lightPigments.leaf, CARD_STOCK),
  wr: stickerOf(lightPigments.marker, CARD_STOCK),
  te: stickerOf(lightPigments.clay, CARD_STOCK),
  k: stickerOf(lightPigments.grape, CARD_STOCK),
  def: stickerOf(lightPigments.slate, CARD_STOCK),
};

const darkPositions: PositionPalette = {
  qb: stickerOf(darkPigments.whistle, NIGHT),
  rb: stickerOf(darkPigments.leaf, NIGHT),
  wr: stickerOf(darkPigments.marker, NIGHT),
  te: stickerOf(darkPigments.clay, NIGHT),
  k: stickerOf(darkPigments.grape, NIGHT),
  // The dark slate sticker takes a chalk label, and lends a brightened steel to the
  // text-on-surface variant — the fill itself is far too dark to read as text on the wall.
  def: stickerOf(darkPigments.slate, CHALK, "#A8B0BC"),
};

export const TOKENS = {
  color: { light, dark },
  position: { light: lightPositions, dark: darkPositions },
  radius: { sm: 4, md: 8, lg: 12, pill: 999 },
  font: {
    /** Body scale, px. */
    size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, "2xl": 28, "3xl": 36 },
    /**
     * Display scale, px — the condensed board face only. Deliberately a SEPARATE scale from
     * `size`: these sizes interleave with the body scale numerically, and a display size is
     * never a substitute for a body size at the same px (see docs/design-system.md).
     */
    display: { sm: 20, md: 28, lg: 40, xl: 64 },
    lineHeight: { display: 1.05, tight: 1.2, base: 1.5 },
  },
  /**
   * Paper depth. Theme-independent on purpose: a shadow is cast light, and on the dark board
   * wall the border does the separating instead — a lighter "shadow" would read as a glow.
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
