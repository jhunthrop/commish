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
 * Dark — the flagship, and Gameday's own room (`docs/design/2026-08-28-gameday-spec.md`, the
 * rendered artifact). The approved mock is a single dark page by construction, so for the
 * ELEVATION RAMP it is the authority and this palette carries its ladder: page #1A1A21,
 * surface #23252E, raised #2C2F3A, line #383C4A. Every value the mock names AND that survives a
 * gate is here verbatim; the three that do not survive (`edge`, `textFaint`, and the position
 * `def` sticker) are re-solved along their own hue and say so at their field.
 *
 * WHY THE RAMP IS FOUR GROUNDS AND NOT GAMEDAY'S NOMINAL FIVE. The mock declares a fifth step,
 * `--overlay: #363A47`, brighter than `raised`, and never paints it — neither approved screen
 * contains a modal. Shipping it costs a text role: at that luminance `textFaint` has to be
 * brightened to #9FA4AF to clear 4.5:1, which is 1.02:1 from `textMuted` — the two quiet inks
 * become literally the same colour, and the product loses the distinction between "secondary"
 * and "tertiary" everywhere, to gain a ground nothing draws on. The magnitude ramp fails harder
 * still: `bad` measures 4.11:1 there and cannot be fixed without collapsing the whole heat map
 * upward into `weak`.
 *
 * So the fourth step is spent on the WELL (`surfaceInset`) rather than on an overlay, which is
 * the step both approved screens actually use — the matchup's points-share track and the draft
 * room's meters. Four grounds either way; Gameday puts its fourth above the card and we put ours
 * below it, because that is the one the screens paint. A modal keeps `surfaceElevated`: a scrim
 * already separates it from the page, so it needs no brighter ground of its own.
 */
const dark: Palette = {
  surface: "#1A1A21", // PAGE — the ground. The one value v3 and Gameday agree on verbatim.
  surfaceElevated: "#23252E", // SURFACE — a card, a row, a panel. Gameday's `--surface`.
  surfaceRaised: "#2C2F3A", // RAISED — a row lifted off its card, a meter track. Gameday's `--raised`.
  surfaceInset: "#1F1F27", // the well: an unfilled meter, the wire's band. Below the ground, not above it.
  line: "#383C4A", // the decorative hairline between two surfaces (Gameday's `--line`, verbatim)
  /**
   * The interactive boundary. Gameday's mock proposes #5A6072 and it CANNOT SHIP: measured
   * against this ramp it is 2.76:1 on the page and 2.13:1 on a raised row, missing WCAG
   * 1.4.11's 3:1 floor for the edge of a control a user has to find. The mock is a static
   * page with no controls to bound, so nothing in it ever exercised the gate.
   *
   * Solved the way every other pigment here is solved: keep the mock's hue and saturation
   * (218°, the cool steel it chose), walk lightness up until the DIMMEST margin clears, and
   * stop at the first value that does. Binding ground is `surfaceRaised`, at 3.03:1.
   */
  edge: "#70788E",
  textPrimary: "#EDEEF2", // Gameday's `--ink`
  textMuted: "#A0A5B4", // Gameday's `--muted`
  /**
   * Gameday's `--faint` is #767C8C, which measures 4.15:1 on the page and 3.20:1 on a raised
   * row — below the 4.5:1 floor on every surface in the ramp, the same way v3's mock value was.
   * Brightened along its own hue until it clears the binding ground (`surfaceRaised`, 4.51:1).
   *
   * This role is the reason Gameday's fifth ground could not ship — see `TOKENS.color`'s
   * elevation docblock below.
   */
  textFaint: "#9196A3",
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
  qb: stickerOf("#F2685E", STICKER_INK),
  rb: stickerOf("#35C98A", STICKER_INK),
  wr: stickerOf("#4E9BF0", STICKER_INK),
  te: stickerOf("#E0A340", STICKER_INK),
  k: stickerOf("#B98BF5", STICKER_INK),
  // DEF, re-solved from the mock's #6C7A93 — see this block's docblock. Darkened until the
  // product's own ink clears it, which is also what makes it the quiet one again; its `text`
  // variant is brightened separately because the fill itself is too dark to read on a surface.
  def: stickerOf("#616D83", dark.textPrimary, "#818CA1"),
};

const lightPositions: PositionPalette = {
  qb: stickerOf("#E32012", "#FFFFFF"),
  rb: stickerOf("#23835A", "#FFFFFF"),
  wr: stickerOf("#1372DC", "#FFFFFF"),
  te: stickerOf("#9C6A19", "#FFFFFF"),
  k: stickerOf("#924BEF", "#FFFFFF"),
  // Daylight DEF is dark enough to be its own text variant, so it takes no second value — the
  // one place the light palette is simpler than the dark one rather than its mirror.
  def: stickerOf("#535963", "#FFFFFF"),
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
  strong: "#85E0BA", // hue 155, the money-green family, lifted well clear of `accent` itself
  good: "#81CCA6", // hue 150, quieter green — one luminance step down, same family
  neutral: dark.textPrimary, // NOT a pigment: an uncompared number is ordinary ink
  weak: "#CEA547", // hue 42, the amber family — middling, the reference product's own word
  bad: "#EE7A68", // hue 8, the live-red family, still 4.80:1 on the brightest dark ground
};

const lightMagnitude: MagnitudePalette = {
  strong: "#064129", // hue 156 — daylight inverts the ramp's direction, never its order
  good: "#1C583A", // hue 150
  neutral: light.textPrimary,
  weak: "#795A12", // hue 42
  bad: "#C73923", // hue 8, 4.68:1 on `surfaceInset`, the binding ground in daylight
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
  S: { fill: "#FF7A6E", label: "#14140F" },
  A: { fill: "#F5A248", label: "#14140F" },
  B: { fill: "#E8CF5A", label: "#14140F" },
  C: { fill: "#6FA8DC", label: "#14140F" },
};

/** The same four hues (6°, 30°, 48°, 217° against dark's 5°, 31°, 49°, 209°) taken down in
 *  lightness until each clears 4.5:1 against white — which is what puts white ink on them and,
 *  in one step, satisfies the 3:1 findability floor on every light surface with margin. */
const lightTiers: TierPalette = {
  S: { fill: "#BE3A2C", label: "#FFFFFF" },
  A: { fill: "#A85B10", label: "#FFFFFF" },
  B: { fill: "#7A6512", label: "#FFFFFF" },
  C: { fill: "#2F5EA8", label: "#FFFFFF" },
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
