import { VERIFIED_BADGE_TOOLTIP } from "@/participation/verified";

/**
 * The registry: every piece of jargon this product shows a manager, defined exactly once.
 *
 * Nothing else in the codebase may write an inline definition string — a component that wants
 * to explain a term imports it from HERE, through `InfoTip` (`@/components/ui/info-tip`), so
 * two surfaces can never quietly say two different things about what "on the clock" means.
 *
 * `waiver` is deliberately absent: this product has no waiver-wire surface yet, and defining a
 * feature it doesn't have would teach a word nobody can act on.
 */
export type TermKey =
  | "snake-draft"
  | "auction-draft"
  | "ppr"
  | "half-ppr"
  | "te-premium"
  | "custom-scoring"
  | "flex"
  | "superflex"
  | "bench"
  | "on-the-clock"
  | "lineup-lock"
  | "stake-tier"
  | "matchup"
  | "standings-record"
  | "queue"
  | "verified-reviewer";

export interface GlossaryTerm {
  readonly key: TermKey;
  /**
   * The noun phrase that completes `InfoTip`'s trigger label, "What is ${term}?" — e.g.
   * "a snake draft" reads as "What is a snake draft?" This is grammar, not a heading: it is
   * never rendered on its own.
   */
  readonly term: string;
  /** One line, always short enough to sit inline for a `guided` reader — see `HELP_CONFIG`. */
  readonly short: string;
  /** The longer explanation, shown once a reader clicks the trigger open. */
  readonly detail: string;
}

export const GLOSSARY: Readonly<Record<TermKey, GlossaryTerm>> = {
  "snake-draft": {
    key: "snake-draft",
    term: "a snake draft",
    short: "Picks snake back and forth by round, so no team drafts last every time.",
    detail:
      "Every manager picks in order, then the order reverses. In a 12-team league picks run 1 to 12, then 12 to 1, and back again. It means the manager who picks last in one round picks first in the next.",
  },
  "auction-draft": {
    key: "auction-draft",
    term: "an auction draft",
    short: "Every manager can bid on every player from a shared budget.",
    detail:
      "Instead of taking turns, every manager can bid on every player as it comes up. Each team has a fixed budget for the whole draft, and a player joins whichever team bid the most. Nobody is locked out of a player, only outbid.",
  },
  ppr: {
    key: "ppr",
    term: "PPR",
    short: "One point for every reception, on top of yards and touchdowns.",
    detail:
      "PPR stands for point per reception. A pass catcher earns one full point every time they catch the ball, in addition to yards and touchdowns, so reliable receivers score more than standard rules give them.",
  },
  "half-ppr": {
    key: "half-ppr",
    term: "Half PPR",
    short: "Half a point for every reception, on top of yards and touchdowns.",
    detail:
      "Half PPR pays half a point for every catch, on top of yards and touchdowns, rather than a full point per catch. It still rewards catches, just not as heavily as a league that pays a full point for every one.",
  },
  "te-premium": {
    key: "te-premium",
    term: "TE premium",
    short: "Tight ends earn extra points per catch, on top of PPR.",
    detail:
      "TE premium adds an extra bonus for every catch a tight end makes, on top of the point every catch already earns in this league. Tight ends usually catch less than receivers, so the bonus keeps them worth drafting.",
  },
  "custom-scoring": {
    key: "custom-scoring",
    term: "custom scoring",
    short: "The commissioner changed at least one scoring rule from the standard presets.",
    detail:
      "This league's point values don't match Standard, PPR, Half PPR, or PPR with a TE premium exactly, because its commissioner adjusted at least one of them. It is not a lower-quality league, just a hand-tuned one.",
  },
  flex: {
    key: "flex",
    term: "a FLEX spot",
    short: "A lineup spot any running back, receiver, or tight end can fill.",
    detail:
      "A FLEX spot in your lineup can be filled by a running back, a wide receiver, or a tight end, whichever gives your team the most points that week. It is one extra starter without a fixed position of its own.",
  },
  superflex: {
    key: "superflex",
    term: "a superflex spot",
    short: "A flex spot that also accepts a quarterback, so most teams start two.",
    detail:
      "A superflex spot works like a FLEX, but it also accepts a quarterback alongside running backs, receivers, and tight ends. Quarterbacks are usually worth more than any other position, so most managers in a superflex league use it to start a second one.",
  },
  bench: {
    key: "bench",
    term: "the bench",
    short: "Players on your roster who are not starting this week.",
    detail:
      "Your bench holds players on your roster who are not in a starting lineup slot this week. They score no points for you, but stay eligible to start in a future week.",
  },
  "on-the-clock": {
    key: "on-the-clock",
    term: "on the clock",
    short: "This team must make its pick before time runs out.",
    detail:
      "Being on the clock means it is that team's turn to draft, and a countdown is running. If the clock runs out before they pick, the room moves on for them so the draft never stalls on one team.",
  },
  "lineup-lock": {
    key: "lineup-lock",
    term: "a lineup lock",
    short: "Once a week's first game kicks off, that week's lineup can't change.",
    detail:
      "A lineup locks for the whole week the moment its first game kicks off, not player by player. Set your lineup before that kickoff, because you can't swap anyone in or out again until the following week opens.",
  },
  "stake-tier": {
    key: "stake-tier",
    term: "a stake tier",
    short: "A label for how competitive a league is. No money changes hands.",
    detail:
      "A stake tier is a label, like Free, Friendly, Competitive, or High stakes, that describes how seriously a league plays, not an entry fee. No money changes hands in this product today.",
  },
  matchup: {
    key: "matchup",
    term: "a matchup",
    short: "Your team's head-to-head game against one opponent this week.",
    detail:
      "Your matchup is the one other team your points are compared against this week. Whoever scores more with their starting lineup wins that week's game, and every team gets a new matchup each week of the season.",
  },
  "standings-record": {
    key: "standings-record",
    term: "a record",
    short: "Wins, losses, and ties so far this season.",
    detail:
      "A record shows how many weeks a team has won, lost, and tied so far this season, written as wins-losses or wins-losses-ties. Standings rank every team in the league by that record first.",
  },
  queue: {
    key: "queue",
    term: "your draft queue",
    short: "The list of players you ranked to auto-draft if you're away when it's your pick.",
    detail:
      "Your draft queue is the ranked list of players you'd want if you can't pick in person. If the clock runs out on your turn, the room drafts the highest-ranked player still available from your queue instead of skipping you.",
  },
  /**
   * Founder decision #8, verbatim (`VERIFIED_BADGE_TOOLTIP`, `@/participation/verified`) — read
   * from there rather than restated here, so the badge and its own explanation can never drift
   * apart. `short` and `detail` are the identical sentence on purpose: it already states the
   * claim rather than implying a broader one, and a shortened version would only invite a reader
   * to guess what got cut.
   */
  "verified-reviewer": {
    key: "verified-reviewer",
    term: "a verified reviewer",
    short: VERIFIED_BADGE_TOOLTIP,
    detail: VERIFIED_BADGE_TOOLTIP,
  },
};

export function term(key: TermKey): GlossaryTerm {
  return GLOSSARY[key];
}
