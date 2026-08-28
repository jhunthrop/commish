import { MICRO_LABEL } from "./config";

/**
 * Where a player's real-world game actually is. A discriminated union rather than three loose
 * optional strings, because the three states carry DIFFERENT facts — a live game has a quarter
 * and a clock, a finished one has neither, a scheduled one has a kickoff and nothing else — and
 * a shape that made all three optional would let a caller construct "live with no clock" or,
 * far worse, "scheduled with points", which is the exact lie this file exists to stop.
 */
export type GameState =
  | { readonly kind: "live"; readonly quarter: string; readonly clock: string }
  | { readonly kind: "final" }
  | { readonly kind: "scheduled"; readonly kickoff: string };

/**
 * THE ONE GLYPH FOR "THERE IS NO NUMBER YET" — an em-dash, and never a zero.
 *
 * Gameday's spec names this as the most common lie a fantasy scoreboard tells: *"A player who has
 * not played reads as a dash and a kickoff time, never a zero. Folding 'has not played' into
 * 'scored nothing' is the most common lie a fantasy scoreboard tells."* A `0.0` beside a player
 * whose game kicks off at 4:25 is a claim — that he was targeted and produced nothing — and a
 * manager reading it makes a start/sit decision on a fact nobody has.
 *
 * It lives here, exported, rather than in each surface that needs it, because the second copy is
 * the one that becomes a `0` under deadline. `PointsShareBar` imports it for the same reason: a
 * share of zero total points is the same "has not happened yet" as an unplayed player, and both
 * must read as the same glyph or the product has two ways of saying nothing.
 *
 * The em-dash here is DATA, not copy — the product's no-em-dashes-in-prose rule is about
 * sentences a manager reads, and this is the absence of a number in a numeric column.
 */
export const NOT_STARTED_DASH = "—";

/**
 * The points a surface should actually print for a player in this game state. THE core rule,
 * expressed as a function so no surface has to remember it: a scheduled player's points are the
 * dash, whatever number the caller is holding. Every other state prints the real figure, because
 * a live or finished game's zero IS a fact — he played and did nothing.
 *
 * Pure and separate from the component on purpose: the points render in the row's own points
 * column, next to the chip and not inside it, so the rule has to be reachable without rendering
 * a chip at all. A `Stat`'s `value` is exactly what this returns.
 */
export function pointsForGameState(state: GameState, points: string): string {
  return state.kind === "scheduled" ? NOT_STARTED_DASH : points;
}

/**
 * LAW 1, COLOUR IS A LEGEND — three of the six channels, spent once each.
 *
 * `live` is the live family (`negative`), the same pigment `Countdown`'s `hot` tone and the draft
 * room's my-turn rail already spend, so "this is happening right now" is one colour across the
 * whole product rather than a per-surface choice. `final` is settled and therefore faint: it is
 * history, and history should recede on a screen a manager scans for what is still moving.
 * `scheduled` is muted — quieter than live, louder than done, because a kickoff time is the one
 * thing that answers "can I still win?".
 *
 * A literal class map, never a template string: Tailwind's scanner reads source text, so a
 * `text-${kind}` built at runtime ships no rule at all and the chip renders in inherited ink.
 */
const INK: Readonly<Record<GameState["kind"], string>> = {
  live: "text-negative",
  final: "text-text-faint",
  scheduled: "text-text-muted",
};

/**
 * The word a screen reader hears before the figures, and eyes never see. "Q3 · 8:42" and
 * "4:25 ET" are legible on screen because of where they sit and what colour they are, and both
 * of those channels are gone by the time the string reaches assistive tech — announced bare, they
 * are two unexplained numbers. `final` has none because "Final" is already the word.
 */
const LEAD: Readonly<Record<GameState["kind"], string | null>> = {
  live: "Live,",
  final: null,
  scheduled: "Kickoff",
};

/** The visible text of each state, in the register a scoreboard has always used. */
function stateText(state: GameState): string {
  switch (state.kind) {
    case "live":
      return `${state.quarter} · ${state.clock}`;
    case "final":
      return "Final";
    case "scheduled":
      return state.kickoff;
  }
}

export interface GameStateChipProps {
  readonly state: GameState;
  readonly className?: string;
}

/**
 * Per-player game state — the smallest of Gameday's Sunday primitives and the one that does the
 * most work.
 *
 * The spec's list of what makes a screen feel like a sports app opens with it: *"Answer 'can I
 * still win?', not only 'am I winning?'. Yet-to-play, projected final, and per-player game state
 * are what convert a score into a story."* A points column alone says who is ahead. A points
 * column with this beside it says whether the lead survives the afternoon, which is the only
 * question a manager actually has at 2pm.
 *
 * All three states share one register — the mono micro-label (`MICRO_LABEL`, the product's single
 * sanctioned all-caps address). That is what a stadium scoreboard has always done with `Q3` and
 * `FINAL`, it is legible at 11px in a mono face where the display face would go muddy, and having
 * one register for the whole set means the eye reads POSITION and COLOUR to tell the states apart
 * rather than re-reading the words. `whitespace-nowrap` because "Q3 · 8:42" broken across two
 * lines in a dense table cell reads as a rendering bug.
 *
 * (This prose says "all-caps" and never names the caps sweep's own file: that sweep reads comments
 * too, deliberately — a banned word alive in a docblock is one paste away from a `className`.)
 *
 * `data-game-state` is the test seam and the styling hook for a row that wants to react to its
 * player's state without re-deriving it from the strings.
 */
export function GameStateChip({ state, className = "" }: GameStateChipProps) {
  const lead = LEAD[state.kind];
  return (
    // `relative` for the same reason `Stat` carries it, and it cost that component a full e2e
    // cycle to find: the lead word below is `sr-only`, which is `position: absolute`, and an
    // absolutely positioned box with no positioned ancestor takes the INITIAL containing block —
    // so every `overflow: hidden` between it and the page clips it for PAINT but not for the
    // document's scrollable area. Eighteen of these chips down a starters table would otherwise
    // stretch the root scroll area by the table's full content height.
    <span data-game-state={state.kind} className={`relative inline-flex items-center whitespace-nowrap ${MICRO_LABEL} ${INK[state.kind]} ${className}`}>
      {lead === null ? null : <span className="sr-only">{`${lead} `}</span>}
      {stateText(state)}
    </span>
  );
}
