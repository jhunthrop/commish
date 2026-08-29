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
  // v5 law 4 channel three. Split from `negative`, which through v4 carried BOTH "happening now"
  // and "this is bad" — a conflation a broadcast never makes.
  "live",
  "liveText",
  "warning",
  "warningGlow",
  "info",
  "scrim",
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
 * Both themes are first-class (founder ruling, 2026-08-23 — revised ruling 1). `surface`
 * through `edge` are the four steps of depth the mocks use (ground, panel, raised row/field,
 * inset track/well) plus the two edge roles: `line` separates two surfaces decoratively, `edge`
 * bounds a control a user must find (see `tokens.test.ts`'s "gives an interactive boundary its
 * own role"). One `ColorRole` union, one role set, two designed palettes.
 */

/**
 * DARK — a stadium at night (Sunday v5, `docs/design/2026-08-28-sunday-spec.md`).
 *
 * Every value here was solved numerically against the binding ground and is recorded with its
 * measured ratio in that spec's appendix. Nothing in this object was picked by eye, and the
 * ratios in the comments are the measured minimum across all four surfaces — not estimates.
 *
 * THE BINDING GROUND IS `surfaceRaised`, the BRIGHTEST of the four. This has caught a value
 * three times across two design systems now, so it is stated here as well as in the spec:
 * change a surface and every chroma value against it is unverified until re-measured.
 */
const dark: Palette = {
  surface: "#05070C", // the ground, blue-biased black. A stadium is never neutral grey.
  surfaceElevated: "#0B1019", // a card, a panel, a row's container
  surfaceRaised: "#101724", // a row lifted off its card. THE BINDING GROUND for every value below.
  surfaceInset: "#0A0F17", // the well: an unfilled meter, a track. Below the ground, not above it.
  line: "#1B2331", // the decorative hairline between two surfaces
  /**
   * The interactive boundary, held to WCAG 1.4.11's 3:1 rather than the decorative bar, because
   * the edge of a control a person has to FIND is not decoration.
   *
   * The v5 mockup's #4A5872 measured 2.50:1 on the binding ground and could not ship — the same
   * class of failure v4's mock had at 2.13:1, found the same way. Re-solved along its own hue
   * until the dimmest margin cleared: 3.36:1.
   */
  edge: "#5A6C87",
  textPrimary: "#FFFFFF", // floodlit. 17.95:1
  textMuted: "#8794A8", // 5.84:1
  textFaint: "#738195", // 4.53:1 — held to the full text bar, not 3:1
  /**
   * LAW 4, channel one: furniture, you, and the verb. Amber is the network's own graphics — the
   * segmented rail, a tier plate, your own row's marker — and it is the single verb in a lower
   * third. It is deliberately NOT a verdict: amber never says a number is good.
   *
   * This is the v5 change with the widest blast radius. Through v2, v3 and v4 `accent` was money
   * green and `accent`/`positive` were the same pigment on purpose. v5 breaks that doubling:
   * the act and the verdict are now different channels, because a timing tower has to say "we
   * rate him higher" without that reading as "press this".
   */
  accent: "#FFB627", // 10.23:1
  accentText: "#1A1200", // 10.59:1 on the amber fill
  accentGlow: "rgba(255, 182, 39, 0.14)",
  /**
   * LAW 4, channel two: the verdict pair. `positive` means we rate him HIGHER than the room
   * does; `negative` means lower. Cyan against warm red, never green against red — that pair is
   * the worst available for deuteranopia (~1 man in 12) and this audience is overwhelmingly men.
   *
   * The pair is also ordered by LUMINANCE, so it survives with the hue channel switched off
   * entirely: 11.67 against 6.42, a gap of 5.25.
   */
  positive: "#00E5FF", // 11.67:1
  negative: "#FF998A", // 8.70:1
  negativeText: "#1A0303", // 9.62:1 on the warm-red fill
  /**
   * LAW 4, channel three: LIVE, and nothing else ever. Split from `negative` in v5 — through v4
   * one red carried both "happening now" and "this is bad", which a broadcast never conflates.
   *
   * Its label is near-black, not white: white measures 3.71:1 here and fails. Live red is a
   * mid-luminance colour in BOTH themes, which is exactly why it reads as urgent, and the cost
   * of that is that white cannot sit on it.
   */
  live: "#FF3D3D", // 5.12:1
  liveText: "#1A0303", // 5.66:1 on the live fill
  /**
   * A tightening clock. A separate hue from `accent`, not a shade of it: amber is the network's
   * furniture and must never be mistaken for a verdict about time.
   */
  // Law 4 says colour is spent exactly THREE times, so `warning` is not a fourth hue: a
  // tightening clock IS the live channel, and this role points at the same value. Keeping a
  // separate amber-orange here put it 19 degrees from `accent` and failed the confusability gate.
  warning: "#FF3D3D",
  warningGlow: "rgba(255, 61, 61, 0.12)",
  info: "#4CACF0", // 7.24:1
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
  surface: "#F4F5F7", // newsprint — the ground
  surfaceElevated: "#FAFBFC", // a card lifted off the paper
  surfaceRaised: "#FFFFFF", // a row lifted off its card — the brightest surface in daylight
  /**
   * The well, and THE BINDING GROUND for every light value below: the dimmest of the four,
   * because a well recedes in daylight while a raised row climbs. This is the mirror of dark,
   * where the binding ground is the brightest surface, and getting it backwards is the single
   * most repeated mistake in this file's history.
   */
  surfaceInset: "#E8EBEF",
  line: "#DDE1E8", // the decorative hairline between two surfaces
  edge: "#767F8E", // WCAG 1.4.11's 3:1 for a control boundary. 3.38:1
  textPrimary: "#0A0D12", // ink. 16.27:1
  /**
   * Re-solved twice. The plain-surface check passes at a lighter value, but this role also sits
   * on the 10%-of-negative and 10%-of-live tint composites the product paints, and against those
   * a plain-surface-only solve measured 4.27:1 and 4.22:1. Solved against all six grounds.
   */
  textMuted: "#596576", // 4.56:1 across four surfaces AND both tint composites
  textFaint: "#5C6470", // 4.60:1 — held to the full text bar, and to both tint composites
  accent: "#9D5707", // law 4 channel one: furniture, you, the verb. 4.62:1
  accentText: "#FFFFFF", // 5.53:1 on the amber fill
  accentGlow: "rgba(157, 87, 7, 0.12)",
  positive: "#003447", // law 4 channel two, the loud end of the verdict pair. 11.10:1
  /**
   * The quiet end of the verdict pair, and a FIXED POINT: this value is both the text colour and
   * the source of the 10%-of-itself tint it then sits on, so it must clear 4.5:1 against a
   * composite made from itself. v4 documented this trap and v5 walked into it anyway — the
   * plain-surface solve gave #BF3122, which measured 4.50:1 against its own tint.
   *
   * Light needed a second pass for a separate reason too, recorded in the spec: on a BRIGHT
   * ground the loud end of the verdict pair has to go DARKER, not brighter, or `positive` and
   * `negative` cannot both clear the floor and stay 1.5 apart in luminance.
   */
  negative: "#7F2315", // 8.15:1 plain, and clears its own 10% tint
  negativeText: "#FFFFFF", // 5.71:1 on the warm-red fill
  live: "#C81616", // law 4 channel three: live and nothing else. 4.90:1
  liveText: "#FFFFFF", // 5.77:1 on the live fill
  // A tightening clock. A separate hue from `accent`, never a shade of it — see dark's docblock.
  warning: "#C81616", // the live channel; see dark's docblock
  warningGlow: "rgba(200, 22, 22, 0.12)",
  info: "#105C93", // 5.90:1
  scrim: "#000000",
};

/**
 * THE POSITION CHANNEL — law 1's third meaning, and the one value v3 got backwards.
 *
 * v3 desaturated these six to 60% of their semantic parent's saturation, on a 2026-08-24 ruling
 * that a full-saturation sticker "reads as a spreadsheet, not a board". Gameday reverses it in
 * one line: **a badge you have to read is not a badge.** The point of a position sticker is that
 * a manager reads QB off the colour before his eye reaches the letters, and a pigment quiet
 * enough to be polite is a pigment you have to read. These are the mock's own values.
 *
 * Five of the six ship verbatim from the approved mock, each with its near-black label:
 * QB #F2685E, RB #35C98A, WR #4E9BF0, TE #E0A340, K #B98BF5.
 *
 * **DEF is re-solved, because the mock's #6C7A93 clears no label at all.** It is a mid steel:
 * near-black ink on it measures 4.20:1 and white measures 4.34:1, so BOTH miss the 4.5:1 floor —
 * the classic mid-tone trap, where a fill is too dark for dark ink and too light for light. The
 * fix keeps its hue (219°) and darkens it to #616D83, the first value at which the product's own
 * `textPrimary` clears 4.5:1 on it. That also restores what DEF is FOR: its meaning is "no colour
 * of its own", so it is supposed to be the quiet one, and a mid steel sitting between WR's blue
 * and nothing in particular was never that.
 *
 * DEF's fill is too dark to double as text on the room's surfaces, so it keeps the separate,
 * brightened `text` variant v3 established for exactly this reason (#818CA1).
 *
 * LIGHT IS DESIGNED, NOT INVERTED (founder ruling 2026-08-23). Daylight takes the same six hues
 * and walks each DOWN in lightness until white ink clears 4.5:1 on it and the pigment itself
 * clears 4.5:1 as text on paper — one move that satisfies both, since the binding constraint is
 * the same direction. Hues land within 2° of the mock's in every case, so a manager who switches
 * themes sees the same six colours, not a second palette.
 *
 * `def` needs one extra constraint in daylight that it does not need at night: WR and DEF are
 * 6° apart in hue (both blues), so the pairwise gate has to be carried by CONTRAST rather than
 * hue, and `def` is darkened until it is 1.5:1 from `wr` — the same threshold that keeps the
 * semantic roles apart. At night the two are separated by the same channel for the same reason.
 *
 * Every claim above is a number `tokens.test.ts` re-derives; none of it is asserted here.
 *
 */

/** One sticker: the fill, the label printed on it, and the hue's text-on-surface variant. */
function stickerOf(fill: string, label: string, text: string = fill): PositionColor {
  return { sticker: fill, stickerText: label, text };
}

/** The near-black the mock prints on every saturated sticker (`.pos { color: #14151A }`). */
const STICKER_INK = "#14151A";

const darkPositions: PositionPalette = {
  qb: stickerOf("#2A1D3B", "#B08BF0", "#B08BF0"),
  rb: stickerOf("#0E3B32", "#4FE0C0", "#4FE0C0"),
  wr: stickerOf("#3B0E28", "#FF6FA5", "#FF6FA5"),
  te: stickerOf("#184362", "#5BB8EF", "#5BB8EF"),
  k: stickerOf("#60656C", "#E4E8EE", "#9AA5B5"),
  def: stickerOf("#14161A", "#8E9BAD", "#8E9BAD"),
};

const lightPositions: PositionPalette = {
  // Saturated fills, not pale tints. Six pale plates cannot be pairwise separable: keeping them
  // all in the light band needs a 1.5x luminance step five times over, which is a 7.6x range the
  // band does not have. Dark can use dark plates with bright labels for the same reason inverted.
  qb: stickerOf("#A78BE0", "#14181F", "#672EB8"),
  rb: stickerOf("#3FB79A", "#14181F", "#157764"),
  wr: stickerOf("#E36AA0", "#14181F", "#C32265"),
  te: stickerOf("#6FB4E0", "#14181F", "#1E6FA9"),
  // The two neutrals share a hue, so they are separated by lightness instead: 2.15:1 apart.
  k: stickerOf("#7A828F", "#14181F", "#626B77"),
  def: stickerOf("#3E4756", "#FFFFFF", "#5C6B7F"),
  // The third argument is the hue used AS TEXT on a surface, which cannot be the fill: a
  // saturated plate colour is legible against dark ink, not against paper.
};

/**
 * THE HEAT MAP — rule 1's magnitude amendment, founder-approved 2026-08-27
 * (`docs/design/2026-08-27-fun-pass-spec.md`). "It feels like a legal website and not a fantasy
 * site," and the largest single cause was that every number in the product was the same colour.
 * These eight pigments are what a number is allowed to be tinted when it falls somewhere real in
 * a stated comparison set. They are NOT a semantic role: `Stat` is the only component permitted
 * to name one (`magnitude-budget.source.test.ts`), because magnitude on a control would spend the
 * one signal green still has, which is "press this."
 *
 * Solved numerically against the gates, the same method the slate ruling above used — pick the
 * hue family, then walk lightness until every surface clears. Two constraints bind, one per
 * theme, and neither is the surface you would guess:
 *
 * - **Dark's binding ground is `surfaceRaised`** (#2F2F39, the BRIGHTEST of the four), so every
 *   dark step needs relative luminance ≥ 0.307 to clear 4.5:1.
 * - **Light's binding ground is `surfaceInset`** (#F3F3F1, the DIMMEST of the four — a well
 *   recedes in daylight), so every light step needs luminance ≤ 0.160. Solving against white
 *   instead would have allowed 0.183 and shipped a `bad` red that failed in every table's own
 *   track. The 2026-08-27 solve caught that on the first pass; it is written down here so the
 *   next person tuning this ramp does not rediscover it in an axe report.
 *
 * **The ramp is ordered by luminance, not by hue, and that ordering is the point.** Green versus
 * red is the worst available pair for deuteranopia (roughly one man in twelve) and this
 * product's audience is overwhelmingly men. So `strong` → `good` → `weak` → `bad` is strictly
 * decreasing in contrast against the ground in BOTH themes: louder is brighter at night and
 * darker in daylight, and the sequence survives with the hue channel switched off entirely.
 * Hue families still carry the meaning for everyone else — green because good is the same feeling
 * as money, amber for middling, red for bad — they are simply not carrying it alone.
 *
 * `neutral` is `textPrimary` verbatim, the same deliberate doubling as `accent`/`positive`: a
 * number with no comparison set behind it must be indistinguishable from ordinary text. Give the
 * no-verdict step a pigment of its own and every uncompared number in the product starts reading
 * as a judgement — which is the exact thing the spec forbids ("we do not colour a number because
 * it looks big"). `tokens.test.ts` pins the equality so a palette tune cannot quietly break it.
 *
 * Colour is never magnitude's only channel. The value reads plainly as its own number and a
 * judged value carries a caret and a weight step — that gate lives with `Stat`
 * (`src/components/ui/stat.tsx`), because only the component can keep it.
 */
const darkMagnitude: MagnitudePalette = {
  strong: "#34E4FF", // 11.70:1
  good: "#69C5D3", // 9.00:1
  neutral: dark.textPrimary, // no comparison set behind it: indistinguishable from ordinary text
  weak: "#FF7A59", // 6.99:1
  bad: "#F05543", // 5.20:1
};

const lightMagnitude: MagnitudePalette = {
  strong: "#004B66", // 7.99:1
  good: "#205A6F", // 6.38:1
  neutral: light.textPrimary,
  weak: "#A04028", // 5.39:1
  bad: "#C63120", // 4.55:1
};

/**
 * TEAM IDENTITY — rule 1's third amended meaning, founder-approved 2026-08-27
 * (`docs/design/2026-08-27-fun-pass-spec.md`): *"A team's own colour, behind a player's face
 * only. Never on a surface, never behind text."* The reference product the founder named puts a
 * team-coloured block behind every face in the pool, and it is most of why a list of names reads
 * as football rather than as a directory.
 *
 * Three things this is NOT, stated because each one is a rule somebody could reasonably think
 * this breaks:
 *
 * - **Not a semantic role.** These thirty-two values mean "the Chiefs" and nothing else. They
 *   never become a surface, a fill behind text, a control, or a magnitude. The consumer
 *   (`src/components/ui/player-face.tsx`) paints one decorative, `aria-hidden` tile and
 *   the face sits on top of it, so no contrast threshold applies and none is claimed.
 * - **Not theme-varying.** A club's colour is the club's, in daylight and at night alike.
 *   Inverting it per theme would be inventing a Chiefs red that the Chiefs do not have.
 * - **Not a CSS variable.** Unlike every other palette here, this one is keyed by DATA — the
 *   team code riding a `Player` — so it can never reach the DOM as a Tailwind class (a class the
 *   static scanner cannot see ships no rule at all). It reaches the DOM as an inline `style`,
 *   the same idiom `UI_CONFIG.infoTip.minTargetPx` already documents, which is precisely why the
 *   values have to live HERE: `tokens.ts` is the one file in the repo allowed to contain a colour
 *   literal, and `no-raw-color.source.test.ts` is what keeps that true.
 *
 * Keys are the abbreviations the stats feed emits (`teamAbv`, `src/stats/tank01/map.ts`). `WAS`
 * rides beside `WSH` because that one genuinely varies between feeds. An unrecognized code —
 * a free agent, a retired club code, a feed that changes its mind — resolves to nothing and the
 * face renders with no tile at all, which is the honest answer rather than a grey rectangle
 * pretending to be somebody's colours.
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
 * The four grades a draft board's tier ladder carries, best first. `S` is the top break, then
 * `A`, `B`, `C`; below the fourth break the pool draws no grade at all (see
 * `src/draft-room/lib/tiers.ts`).
 *
 * Ordered, and the array order IS the ladder — the same contract `MAGNITUDE_STEPS` keeps, so
 * `tokens.test.ts` can assert the ramp without restating the sequence.
 */
export const TIER_GRADES = ["S", "A", "B", "C"] as const;

export type TierGrade = (typeof TIER_GRADES)[number];

/**
 * TIER GRADE — rule 1's second amended meaning, founder-approved 2026-08-27 and parked until the
 * ranking could make tiers real (`docs/design-system.md`: *"S/A/B bands as coloured bars, once the
 * projection engine makes tiers real. Parked until then; this amendment already covers it, so no
 * second ruling is needed when it lands."*). It has landed: the pool tiers on ADP gaps, so the
 * bands are measured rather than drawn, and this is the palette the amendment already sanctioned.
 *
 * The four values are the founder-approved mock's own (`Draft Room, Broadcast Cut`, 2026-08-27) —
 * a warm-to-cool ramp read as a grade, not as a semantic role.
 *
 * Three things this is NOT, each one a rule somebody could reasonably think it breaks:
 *
 * - **Not the live family, even though `S` is a red.** `negative` is #FF6B5E and `S` is #FF7A6E,
 *   which are neighbours on purpose: the mock puts the hottest grade at the hot end of the ramp.
 *   What keeps them apart is that a grade is only ever an opaque BADGE FILL carrying its own dark
 *   label, and `negative` is only ever ink, a hairline, or a 10% tint. The two never appear in the
 *   same role, so neither can be mistaken for the other.
 * - **Not theme-independent, though the mock's own values are.** The mock is a single dark room by
 *   construction, and its four fills are bright pigments chosen against #1A1A21. Dropped onto the
 *   light theme's near-white ground every one of them fails WCAG 1.4.11's 3:1 — a badge you cannot
 *   find is not a divider, it is decoration. So this is TWO designed palettes over one ladder, the
 *   same shape `TOKENS.position` keeps: dark carries the approved mock's values verbatim, light
 *   carries the same four hues re-derived dark enough to be findable, with white ink on them.
 * - **Not an inline style, unlike `teamColors` — and the difference is not the one it looks like.**
 *   Both palettes are keyed by data, but a team code ARRIVES AT RUNTIME off the stats feed and is
 *   unbounded, so a Tailwind class for it is one the static scanner cannot see and therefore ships
 *   no rule at all. A grade is one of four literals (`TIER_GRADES`), so a component can write all
 *   four class names out and Tailwind sees every one. That is what lets this palette be emitted as
 *   per-theme custom properties (`--commish-tier-*`, `src/design/generate-css.ts`) and consumed as
 *   classes — which is not a convenience but the requirement below: an inline style would have to
 *   choose between the two designed palettes in React, and nothing rendering here can read the
 *   resolved theme. Renderer: `TierDivider` (`src/components/ui/tier-divider.tsx`).
 *
 * **The colourblind channel is the LETTER, not a caret.** Adjacent rungs of this ramp are close in
 * hue on purpose (red, amber, gold — a warmth that cools as the grade falls), which is what makes
 * it read as one ladder rather than four unrelated stickers. That is why `tokens.test.ts` does NOT
 * hold tier pairs to the position stickers' pairwise-hue rule: a position sticker is a CATEGORY and
 * must be told apart from every other, while a grade is an ORDER and is always printed with its own
 * letter on it. What the gate does check is that the ladder's ends are genuinely far apart, so the
 * ramp has real range, and that every badge is findable and every letter readable, in both themes.
 */
interface TierColor {
  /** The badge's fill. ≥3:1 against `surface` and `surfaceElevated` in its own theme. */
  readonly fill: string;
  /** The grade letter printed ON the fill. ≥4.5:1 against it. */
  readonly label: string;
}

type TierPalette = Readonly<Record<TierGrade, TierColor>>;

/** The founder-approved mock's values verbatim, on the near-black ink it prints them with. */
const darkTiers: TierPalette = {
  S: { fill: "#FFB627", label: "#1A1200" }, // 10.59:1
  A: { fill: "#B9C2D0", label: "#14181F" }, // 9.91:1
  B: { fill: "#7F8C9F", label: "#0A0D12" }, // 5.58:1 on ground, 5.70:1 label
  C: { fill: "#5E6773", label: "#FFFFFF" }, // 3.32:1 on ground, 5.73:1 label
};

/** The same four hues (6°, 30°, 48°, 217° against dark's 5°, 31°, 49°, 209°) taken down in
 *  lightness until each clears 4.5:1 against white — which is what puts white ink on them and,
 *  in one step, satisfies the 3:1 findability floor on every light surface with margin. */
const lightTiers: TierPalette = {
  S: { fill: "#9D5707", label: "#FFFFFF" }, // 5.07:1 on ground, 5.53:1 label
  A: { fill: "#495465", label: "#FFFFFF" }, // 7.03:1 on ground, 7.67:1 label
  B: { fill: "#6E7D91", label: "#0A0D12" }, // 3.85:1 on ground, 4.64:1 label
  C: { fill: "#7F8C9F", label: "#0A0D12" }, // 3.13:1 on ground, 5.70:1 label
};

export const TOKENS = {
  color: { light, dark },
  team: teamColors,
  tier: { light: lightTiers, dark: darkTiers },
  magnitude: { light: lightMagnitude, dark: darkMagnitude },
  position: { light: lightPositions, dark: darkPositions },
  radius: { sm: 4, md: 8, lg: 12, pill: 999 },
  font: {
    /**
     * Base scale, px — what a phone gets.
     *
     * `xs` is 11, not 12 (law 2): 11px is the mock's micro-label everywhere it appears
     * (`.lbl`, `.sb-rec`, table headers, the feed's timestamps) and it is the DENOMINATOR of the
     * law's stated range. A score is 84 and its label is 11, which is 7.6x — the number law 2
     * names. Move this and the range claim in `docs/design-system.md` stops being true, which is
     * why `tokens.test.ts` asserts the ratio rather than the two values.
     */
    size: { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, "2xl": 26, "3xl": 34 },
    /** The dense scale, px — emitted inside a min-width media query at
     *  `UI_CONFIG.shell.denseFromPx`. Same keys as `size`; a component never writes
     *  `text-sm lg:text-xs` because density is a property of the viewport, expressed once. */
    sizeDense: { xs: 11, sm: 12, md: 13.5, lg: 15, xl: 17, "2xl": 22, "3xl": 30 },
    /**
     * Display scale, px — the display face only. Deliberately a SEPARATE scale from `size`:
     * these sizes interleave with the body scale numerically, and a display size is never a
     * substitute for a body size at the same px (see docs/design-system.md). `xs` in the body
     * scale is for letter-spaced eyebrows only (mono, sentence case — the caps charter removed
     * the uppercase treatment `xs` carried before v3), never a sentence — the rule this
     * scale's own docblock neighbor. `xl` is 58 (was 64 in v2) — the Sunday Standard mock's
     * display size (self-ruling S3); the display tracking rule that pairs with it lives in
     * globals.css, not here.
     *
     * `2xl` and `3xl` are the fun pass's own addition (Task 3, 2026-08-27). The spec's third
     * named cause of "it feels like a legal website" is that this product has almost no
     * typographic dynamic range: "sports interfaces live on roughly 10x scale contrast — a huge
     * number, a tiny label. We are at about 2x." The scale topped out at 58 against a 12px
     * eyebrow, which is 4.8x, and no amount of care at a call site invents range a scale does not
     * carry. 116 over the eyebrow is 9.7x on a phone and 10.5x at desktop density.
     *
     * The range comes from SIZE and only from size. Rule 2's ≤600 weight cap does not move, and
     * `weight-cap.source.test.ts` is what stops the next author reaching for a heavier face
     * instead of a bigger one. These two steps are not densified: a display size is a call site's
     * own responsive decision (`text-display-lg sm:text-display-3xl`, the idiom E6 established
     * for the hero), because 116px is a TV board and a matchup hero, never a 360px phone.
     */
    display: { sm: 20, md: 28, lg: 44, xl: 58, "2xl": 84, "3xl": 116 },
    /**
     * LAW 4, DENSITY IS RESPECT — every step tighter than v3's (1.06 / 1.2 / 1.5).
     *
     * `display` drops below 1 because at 84px the line box is the number's own bounding box and
     * anything looser puts air inside a scoreboard; the mock sets 0.92 on its largest step and
     * 1.0 on the next. `base` is the one that moves the whole product: 1.45 rather than 1.5 is
     * roughly one extra table row per screen at Sunday's densities, which is the entire content
     * of the law. Space separates kinds of information here; it never exists to calm.
     */
    lineHeight: { display: 0.95, tight: 1.15, base: 1.45 },
  },
  /**
   * Paper depth. Theme-independent on purpose: a shadow is cast light, and on the dark surface
   * the border/edge roles do the separating instead — a lightened "shadow" would read as a glow.
   */
  shadow: {
    card: "0 1px 2px rgb(22 24 29 / 0.06), 0 1px 3px rgb(22 24 29 / 0.05)",
    sticker: "0 2px 0 rgb(22 24 29 / 0.14)",
  },
  /**
   * LAW 6, MOTION REPORTS AND NEVER PERFORMS. Nothing here animates a mount, a scroll or a
   * hover; every duration below belongs to something that actually happened.
   *
   * `highlight` is law 6's own ceiling, stated as a number: *"nothing eases longer than 250ms."*
   * It is the one-off wash on a row whose value just changed — the only motion on the Sunday
   * screen besides the live dot and the running clock. It is deliberately the LONGEST
   * event-driven duration in this object and the law's cap is deliberately the same figure, so
   * `tokens.test.ts` can assert the cap against the token rather than against a comment.
   */
  motion: {
    /** ms */
    duration: {
      fast: 120,
      base: 200,
      /**
       * LAW 6'S CEILING, and the value-change wash's own duration. Was 320ms in v3, which the
       * law retires in one clause: *"nothing eases longer than 250ms."* Deliberately NOT a
       * second `highlight` token beside it — the longest ease the product may run and the
       * duration of the only motion a changed number is allowed to make are the same fact, and
       * two names for one fact is how they drift apart.
       */
      slow: 250,
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
