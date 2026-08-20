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
  | "flex"
  | "bench"
  | "on-the-clock"
  | "lineup-lock"
  | "stake-tier"
  | "matchup"
  | "standings-record";

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
      "Half PPR works like PPR, but a reception is worth half a point instead of a full point. It still rewards catches, just without swinging scores toward pass catchers as hard as full PPR does.",
  },
  "te-premium": {
    key: "te-premium",
    term: "TE premium",
    short: "Tight ends earn extra points per catch, on top of PPR.",
    detail:
      "TE premium adds an extra bonus for every catch a tight end makes, on top of a league's normal PPR points. Tight ends usually catch less than receivers, so the bonus keeps them worth drafting.",
  },
  flex: {
    key: "flex",
    term: "a FLEX spot",
    short: "A lineup spot any running back, receiver, or tight end can fill.",
    detail:
      "A FLEX spot in your lineup can be filled by a running back, a wide receiver, or a tight end, whichever gives your team the most points that week. It is one extra starter without a fixed position of its own.",
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
};

export function term(key: TermKey): GlossaryTerm {
  return GLOSSARY[key];
}
