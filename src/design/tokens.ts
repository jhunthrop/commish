export type ThemeName = "light" | "dark";

/**
 * Every color role the product has, in each theme.
 *
 * SIDELINE (founder chose the direction 2026-09-10, `docs/design/2026-09-10-first-principles.md`
 * section 3.2). Six pigments and nothing else: Chalk (the ground), Graphite (the ink), Court blue
 * (the one verb, links, your messages), Streak amber (yours: your row, a streak, a held seat),
 * Live green (live, presence, a claim that hit, a good outcome) and Rival rose (your opponent, the
 * swing against you, a clock running out). The role SET below is the one every consumer already
 * spells, so the product re-skins without a rename sweep. What each role points at is Sideline's.
 */
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
  "live",
  "liveText",
  "warning",
  "warningGlow",
  "info",
  "scrim",
  /**
   * SIDELINE'S FOURTH CHROMA, "yours". Through v5 and v6 `accent` carried three jobs at once
   * (furniture, you, the verb). Sideline splits the verb (Court blue, `accent`) from you (Streak
   * amber, `self`), because a screen full of other people's cards has to be able to point at
   * yours without that reading as "press this". Four roles, because amber is a mid-luminance
   * pigment in daylight: `self` is the FILL and the ring, `selfText` is the label printed on it,
   * `selfInk` is amber used AS TEXT on a surface (darkened in daylight until it clears 4.5:1),
   * and `selfGlow` is the wash under your own row.
   */
  "self",
  "selfText",
  "selfInk",
  "selfGlow",
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

/**
 * The magnitude ramp, best first: where a number falls in a stated comparison set. Five steps,
 * four of them a verdict and `neutral` the absence of one. Ordered — the array order IS the
 * ramp, which is what lets `tokens.test.ts` assert monotonicity without restating the sequence.
 */
export const MAGNITUDE_STEPS = ["strong", "good", "neutral", "weak", "bad"] as const;

export type MagnitudeStep = (typeof MAGNITUDE_STEPS)[number];

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
type MagnitudePalette = Readonly<Record<MagnitudeStep, string>>;

/**
 * Both themes are first-class (founder ruling, 2026-08-23). `surface` through `edge` are the
 * four steps of depth (ground, paper, a row lifted off its card, a well) plus the two edge roles:
 * `line` separates two surfaces decoratively, `edge` bounds a control a user must find.
 *
 * EVERY VALUE BELOW WAS SOLVED NUMERICALLY against the gates `tokens.test.ts` re-derives, not
 * picked by eye, and the mock's own values moved wherever they failed a gate. Two moved in
 * daylight and the reason is the same for both: the mock's faint ink (#8A8D95) measures 3.3:1
 * on paper and its rose (#D6336C) 4.25:1 on chalk, both under the 4.5:1 text floor this palette
 * has never relaxed. The hue is the mock's, the lightness is the gate's.
 */

/**
 * DARK — Sideline at night. Chalk becomes a near-black with a whisper of blue, paper a step
 * above it, and the raised row is THE BINDING GROUND (the brightest of the four): every chroma
 * value below was measured against it. Change a surface and every value against it is
 * unverified until re-measured; this has now caught a value five times across four systems.
 */
const dark: Palette = {
  surface: "#121316", // Chalk at night: the ground
  surfaceElevated: "#1A1B1F", // paper: a card, a bubble, a sheet
  surfaceRaised: "#212227", // a row lifted off its card. THE BINDING GROUND for every value below.
  surfaceInset: "#0C0D10", // the well: an unfilled meter, a track. Below the ground, not above it.
  line: "#2A2B31", // the hairline between two surfaces: 1.32:1 on the ground, a line and never a boundary
  edge: "#767A84", // WCAG 1.4.11's 3:1 for a control boundary: 3.69:1 on the binding ground
  textPrimary: "#F2F2EE", // Graphite at night: 13.65:1 on the binding ground
  textMuted: "#A9ACB4", // 6.74:1
  /**
   * The mock's #7C7F88 measures 4.3:1 on the raised row and cannot ship as text. Walked up its
   * own hue until the dimmest margin cleared the full text bar: 5.11:1.
   */
  textFaint: "#8F929B",
  /**
   * COURT BLUE, the one verb. Links, the solid pill, your own message bubble. It is the only
   * saturated fill a screen may carry more than once, and P3 says a viewport carries it once.
   */
  accent: "#5B85FF", // 5.06:1 on paper
  accentText: "#0B1226", // 5.53:1 on the blue fill: white measures 3.3:1 here and fails
  accentGlow: "rgba(91, 133, 255, 0.14)",
  /**
   * LIVE GREEN carries both the live channel and the good outcome, deliberately one pigment: a
   * claim that hit, a win, a game running now, a manager who is here. Sideline spends six
   * pigments and a seventh verdict green would be the spreadsheet's habit of colouring numbers.
   * A judged NUMBER still reads through the magnitude ramp, which keeps its own gates.
   */
  positive: "#2ED47F", // 8.88:1 on paper
  negative: "#FF6B9A", // RIVAL ROSE: your opponent, the swing against you. 6.41:1 on paper
  negativeText: "#2A0912", // 6.82:1 on the rose fill
  live: "#2ED47F", // the live channel, the same pigment as `positive`: see its docblock
  liveText: "#062114", // 8.77:1 on the green fill
  /**
   * A clock running out is the swing against you, so `warning` IS the rose. Through v5 it was
   * the live red; Sideline moves live to green and the tightening clock to rose, and
   * `tokens.test.ts` pins the equality so the two cannot drift into a seventh pigment.
   */
  warning: "#FF6B9A",
  warningGlow: "rgba(255, 107, 154, 0.14)",
  info: "#5B85FF", // a link is Court blue; there is no second blue
  scrim: "#000000",
  self: "#F5B341", // STREAK AMBER: your ring, your row's wash, a held seat. 10.09:1 on paper
  selfText: "#1A1200", // 10.09:1 on the amber fill
  selfInk: "#F5B341", // amber as text: legal at night as it is
  selfGlow: "rgba(245, 179, 65, 0.14)",
};

/**
 * LIGHT — Sideline in daylight, designed to the same roles and gates, never derived from `dark`
 * by inversion (founder ruling, 2026-08-23). Chalk is a warm off-white; paper is white; depth
 * moves the OTHER direction from dark, so the well (`surfaceInset`) is THE BINDING GROUND for
 * every ink value below, the dimmest of the four. Getting this backwards is the single most
 * repeated mistake in this file's history.
 */
const light: Palette = {
  surface: "#F6F5F1", // Chalk: the ground
  surfaceElevated: "#FFFFFF", // paper
  surfaceRaised: "#FBFAF7", // a row lifted off its card, between chalk and paper
  surfaceInset: "#ECEBE6", // the well, and THE BINDING GROUND for every value below
  line: "#E6E5DF", // the hairline: 1.16:1 on chalk
  edge: "#7A7D86", // 3.45:1 on the binding ground
  textPrimary: "#17181C", // Graphite
  textMuted: "#5B5E66", // 5.49:1 on the binding ground
  /**
   * The mock's #8A8D95 measures 3.3:1 on paper. Walked down its own hue until it cleared the
   * full text bar on the well: 4.59:1.
   */
  textFaint: "#666973",
  accent: "#2457F5", // COURT BLUE, verbatim: 5.14:1 on chalk, 4.79:1 on the well
  accentText: "#FFFFFF", // 5.59:1 on the blue fill
  accentGlow: "rgba(36, 87, 245, 0.12)",
  /**
   * The mock's #128A52 is a mid-tone trap: white measures 4.39:1 on it and near-black 4.35:1, so
   * neither label can ride the fill. Darkened along its own hue until white clears it AND it
   * clears 4.5:1 as text on its own 10% wash (5.08:1), the fixed-point trap v4 documented.
   */
  positive: "#0C6D3F",
  /**
   * The mock's #D6336C measures 4.25:1 on chalk. Darkened until it clears chalk (5.54:1) and its
   * own 10% wash (4.74:1). Same fixed point as the green, same direction of fix.
   */
  negative: "#BC1F57",
  negativeText: "#FFFFFF", // 6.05:1 on the rose fill
  live: "#0C6D3F", // the same pigment as `positive`: see dark's docblock
  liveText: "#FFFFFF", // 6.41:1 on the green fill
  warning: "#BC1F57", // the rose: see dark's docblock
  warningGlow: "rgba(188, 31, 87, 0.12)",
  info: "#2457F5", // a link is Court blue
  scrim: "#000000",
  self: "#E39A0E", // STREAK AMBER, verbatim, as a FILL and a ring only: 2.36:1 as text on paper, so it never is
  selfText: "#1A1200", // 8.07:1 on the amber fill
  selfInk: "#8A5C05", // amber as text, darkened until it clears the well: 5.02:1 on chalk
  selfGlow: "rgba(227, 154, 14, 0.14)",
};

/**
 * THE POSITION CHANNEL, unchanged by Sideline ("position stickers keep their six hues in every
 * direction: a legend is a legend"). Every ratio was re-measured against the new surfaces and
 * every one clears; the values are the Gameday solve's own.
 *
 * DEF is the quiet one by design ("no colour of its own") and is separated from WR by contrast
 * rather than hue in both themes. Light is designed, not inverted: the same six hues walked down
 * in lightness until white ink clears 4.5:1 on the plate and the pigment clears 4.5:1 as text on
 * paper.
 */

/** One sticker: the fill, the label printed on it, and the hue's text-on-surface variant. */
function stickerOf(fill: string, label: string, text: string = fill): PositionColor {
  return { sticker: fill, stickerText: label, text };
}

const darkPositions: PositionPalette = {
  qb: stickerOf("#2A1D3B", "#B08BF0", "#B08BF0"),
  rb: stickerOf("#0E3B32", "#4FE0C0", "#4FE0C0"),
  wr: stickerOf("#3B0E28", "#FF6FA5", "#FF6FA5"),
  te: stickerOf("#184362", "#5BB8EF", "#5BB8EF"),
  k: stickerOf("#60656C", "#E4E8EE", "#9AA5B5"),
  def: stickerOf("#14161A", "#8E9BAD", "#8E9BAD"),
};

const lightPositions: PositionPalette = {
  qb: stickerOf("#A78BE0", "#14181F", "#672EB8"),
  rb: stickerOf("#3FB79A", "#14181F", "#157764"),
  wr: stickerOf("#E36AA0", "#14181F", "#C32265"),
  te: stickerOf("#6FB4E0", "#14181F", "#1E6FA9"),
  k: stickerOf("#7A828F", "#14181F", "#626B77"),
  def: stickerOf("#3E4756", "#FFFFFF", "#5C6B7F"),
};

/**
 * THE HEAT MAP — a number's own ink when it falls somewhere real in a STATED comparison set
 * (P11: tint is spent only on a comparison against a stated population, never as the only
 * channel). Only `Stat` may name one (`magnitude-budget.source.test.ts`).
 *
 * Ordered by CONTRAST AGAINST THE GROUND, never by hue: green versus red is the pair that
 * vanishes for one man in twelve, so louder is brighter at night and darker in daylight and the
 * ramp survives with hue switched off. `neutral` is `textPrimary` verbatim: an uncompared number
 * is indistinguishable from ordinary text. Re-measured against Sideline's surfaces: dark's
 * binding ground is the raised row (#212227), light's is the well (#ECEBE6), and `bad` clears
 * both (4.61:1 and 4.58:1).
 */
const darkMagnitude: MagnitudePalette = {
  strong: "#74E7A4", // 10.00:1 on the binding ground
  good: "#7DC79C", // 7.67:1
  neutral: dark.textPrimary,
  weak: "#EF846E", // 5.98:1
  bad: "#F05549", // 4.61:1
};

const lightMagnitude: MagnitudePalette = {
  strong: "#044E33", // 8.60:1 on the binding well
  good: "#1F5C45", // 6.58:1
  neutral: light.textPrimary,
  weak: "#9F3C28", // 5.58:1
  bad: "#C82C20", // 4.58:1
};

/**
 * TEAM IDENTITY — a club's own colour, and Sideline puts it in exactly two places: the 2px ring
 * around a headshot and the headshot's own tile. Never on a surface, never behind text (the
 * refusal list that survives every redesign).
 *
 * Not a semantic role, not theme-varying (a club's colour is the club's in daylight and at
 * night), and not a CSS variable: this palette is keyed by DATA (the team code riding a
 * `Player`), so it reaches the DOM as an inline `style` from `src/components/ui/player-face.tsx`,
 * which is why the literals have to live here, the one file allowed to contain a colour. Keys
 * are the abbreviations the stats feed emits; `WAS` rides beside `WSH` because that one varies
 * between feeds. An unrecognized code resolves to nothing and the face renders with no ring.
 */
const teamColors: Readonly<Record<string, string>> = {
  ARI: "#97233F",
  ATL: "#A71930",
  BAL: "#241773",
  BUF: "#00338D",
  CAR: "#0085CA",
  CHI: "#0B162A",
  CIN: "#FB4F14",
  CLE: "#311D00",
  DAL: "#003594",
  DEN: "#FB4F14",
  DET: "#0076B6",
  GB: "#203731",
  HOU: "#03202F",
  IND: "#002C5F",
  JAX: "#006778",
  KC: "#E31837",
  LAC: "#0080C6",
  LAR: "#003594",
  LV: "#000000",
  MIA: "#008E97",
  MIN: "#4F2683",
  NE: "#002244",
  NO: "#D3BC8D",
  NYG: "#0B2265",
  NYJ: "#125740",
  PHI: "#004C54",
  PIT: "#FFB612",
  SEA: "#002244",
  SF: "#AA0000",
  TB: "#D50A0A",
  TEN: "#4B92DB",
  WSH: "#5A1414",
  WAS: "#5A1414",
};

/**
 * The four grades a draft board's tier ladder carries, best first. Ordered, and the array order
 * IS the ladder — the same contract `MAGNITUDE_STEPS` keeps.
 */
export const TIER_GRADES = ["S", "A", "B", "C"] as const;

export type TierGrade = (typeof TIER_GRADES)[number];

/**
 * TIER GRADE — a warm-to-cool ramp read as a grade, not a semantic role. Two designed palettes
 * over one ladder: a grade badge is an opaque FILL carrying its own label, findable (≥3:1)
 * against the row it divides and readable (≥4.5:1) on its own fill, in both themes. The
 * colourblind channel is the LETTER, always printed on the badge. Emitted as per-theme custom
 * properties (`--commish-tier-*`) because a grade is a closed union of four literals Tailwind
 * can see, unlike a team code. Renderer: `TierDivider`. Re-measured against Sideline's surfaces;
 * dark `C` is the tightest value in the palette at 3.00:1 on paper.
 */
interface TierColor {
  /** The badge's fill. ≥3:1 against `surface` and `surfaceElevated` in its own theme. */
  readonly fill: string;
  /** The grade letter printed ON the fill. ≥4.5:1 against it. */
  readonly label: string;
}

type TierPalette = Readonly<Record<TierGrade, TierColor>>;

const darkTiers: TierPalette = {
  S: { fill: "#FFB627", label: "#1A1200" },
  A: { fill: "#B9C2D0", label: "#14181F" },
  B: { fill: "#7F8C9F", label: "#0A0D12" },
  C: { fill: "#5E6773", label: "#FFFFFF" },
};

const lightTiers: TierPalette = {
  S: { fill: "#9D5707", label: "#FFFFFF" },
  A: { fill: "#495465", label: "#FFFFFF" },
  B: { fill: "#6E7D91", label: "#0A0D12" },
  C: { fill: "#7F8C9F", label: "#0A0D12" },
};

export const TOKENS = {
  color: { light, dark },
  team: teamColors,
  tier: { light: lightTiers, dark: darkTiers },
  magnitude: { light: lightMagnitude, dark: darkMagnitude },
  position: { light: lightPositions, dark: darkPositions },
  /**
   * SIDELINE'S RADII: 20px on cards and sheets (`xl`), pills on buttons and chips, 12px on the
   * avatar's ring and a row's hover plate (`md`), 16px on a message bubble (`lg`), 8px on the
   * smallest tiles (`sm`). The scale is the v6 scale unchanged; what moved is which step each
   * primitive spends, and `shape` below names that so a call site never picks.
   */
  radius: { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 },
  /** Which radius step each object takes. A primitive reads this; a call site never chooses. */
  shape: { card: "xl", sheet: "xl", bubble: "lg", row: "md", avatarRing: "md", chip: "pill", button: "pill" },
  font: {
    /**
     * Base scale, px — what a phone gets. `xs` is 11, the micro label and the DENOMINATOR of
     * the dynamic-range gate (`tokens.test.ts`). `lg` is 17: Sideline's name size on a row,
     * the same on a phone and at desktop density, because a name is the largest thing on a
     * row and does not shrink with the viewport.
     */
    size: { xs: 11, sm: 13, md: 15, lg: 17, xl: 22, "2xl": 28, "3xl": 38 },
    /** The dense scale, px — emitted inside a min-width media query at
     *  `UI_CONFIG.shell.denseFromPx`. Same keys as `size`; a component never writes
     *  `text-sm lg:text-xs` because density is a property of the viewport, expressed once. */
    sizeDense: { xs: 11, sm: 12.5, md: 14, lg: 17, xl: 20, "2xl": 25, "3xl": 34 },
    /**
     * Display scale, px — Bricolage Grotesque, optical sizing on, at the sizes a number or a
     * name is the object: `sm` a row figure, `md` a card figure, `lg` a hero name, `xl` the
     * mock's 58 to 64 hero and player-page figure, `2xl`/`3xl` the scoreboard and the TV board.
     * Never a substitute for a body size at the same px.
     */
    display: { sm: 20, md: 28, lg: 44, xl: 58, "2xl": 84, "3xl": 116 },
    lineHeight: { display: 0.95, tight: 1.15, base: 1.45 },
  },
  /**
   * SIDELINE'S ONE MATERIAL: a layered surface with a soft `0 4px 16px` shadow at 6 percent and
   * a `0 1px 2px` at 4 (the mock's `--shadow`), deepened at night where a shadow has to read
   * against a dark ground. No inset top-light: v6's material is retired with v6. `verbGlow` is
   * the halo under the one Court blue pill, a tint of each theme's own accent.
   */
  shadow: {
    light: {
      card: "0 4px 16px rgba(23, 24, 28, 0.06), 0 1px 2px rgba(23, 24, 28, 0.04)",
      raised: "0 1px 2px rgba(23, 24, 28, 0.05)",
      overlay: "0 16px 48px rgba(23, 24, 28, 0.18)",
      verbGlow: "0 6px 18px rgba(36, 87, 245, 0.28)",
      sticker: "0 2px 0 rgba(23, 24, 28, 0.14)",
    },
    dark: {
      card: "0 4px 16px rgba(0, 0, 0, 0.35)",
      raised: "0 1px 2px rgba(0, 0, 0, 0.3)",
      overlay: "0 16px 48px rgba(0, 0, 0, 0.5)",
      verbGlow: "0 6px 18px rgba(91, 133, 255, 0.28)",
      sticker: "0 2px 0 rgba(0, 0, 0, 0.35)",
    },
  },
  /**
   * P4: EVERY LIVE EVENT MOVES, AND NOTHING ELSE DOES. Springs for anything that appears
   * (`in`, 240ms), an ease-out for anything that leaves (`out`, 180ms), a 600ms wash on a row
   * whose value just changed (`highlight`), and a 2s breath on a presence dot (`breathe`).
   * Transitions live inside P4's 150 to 400ms band; `highlight` is the one longer motion the
   * principle allows per moment, and `breathe`/`wire` are clocks, not eases. `fast` is a press.
   */
  motion: {
    /** ms */
    duration: {
      fast: 120,
      out: 180,
      in: 240,
      /** The pick landing and the win: Tailgate's slap-in, at celebration scale only (section 5). */
      celebrate: 480,
      highlight: 600,
      breathe: 2_000,
      /** The front door's ticker loop. */
      wire: 38_000,
    },
    easing: { spring: "cubic-bezier(0.2, 0.9, 0.3, 1.15)", out: "cubic-bezier(0.2, 0, 0, 1)" },
  },
  /**
   * SIDELINE'S DENSITY, stated as numbers so a row cannot drift: 48px rows with a 36px face and
   * a 17px name, four columns at most; research surfaces (the pool, a game log) go dense to
   * 44px with the face still present. Read by the row primitives, pinned by `tokens.test.ts`.
   */
  density: { rowPx: 48, denseRowPx: 44, facePx: 36, namePx: 17, maxColumns: 4 },
  /**
   * HOW WIDE A READING SURFACE GETS BEFORE IT STOPS GROWING, px.
   *
   * 1120 is the approved mock's own column (`docs/design/mocks/2026-09-11/signed-in-home/
   * signed-in-home.html`: a 1200px wrap with 40px of padding a side). The founder's production
   * screenshot at a wide window is what named this: the signed-in home ran edge to edge, so a
   * card's name sat at the far left of a 2560px display and the number and verb it belongs to sat
   * at the far right, a foot of empty ground between a fact and its own basis. P1 and P2 both
   * assume a reader can take a card in at one glance.
   *
   * A READING surface only. The working surfaces stay full-bleed on purpose and are not to be
   * capped with this: the draft board wants every column it can get, the wire and the game log
   * are comparisons, and `AppShell`'s own `<main>` stays `max-w-*`-free (its Step 2 brief) so
   * each surface makes its own choice. The page's padding lives on that `<main>` (`px-4 py-4`)
   * and sits outside this cap, which is why the utility only sets a width and a centre.
   *
   * One name, so the next reading surface shares the number rather than inventing a neighbour:
   * emitted as `--commish-layout-reading-column` and spent through the `.reading-column` utility
   * in `globals.css`.
   */
  layout: { readingColumnPx: 1120 },
  /** Minimum supported viewport width, px (mobile-first baseline). */
  minViewport: 360,
} as const;
