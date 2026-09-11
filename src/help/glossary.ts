import { SIT_AND_GO_GRACE_MINUTES } from "@/matchmaking/config";
import { VERIFIED_BADGE_TOOLTIP } from "@/participation/verified";

/**
 * The registry: every piece of jargon this product shows a manager, defined exactly once.
 *
 * Nothing else in the codebase may write an inline definition string — a component that wants
 * to explain a term imports it from HERE, either through `InfoTip`'s (`@/components/ui/info-tip`)
 * click-to-reveal trigger, or, for a page that already reads start to finish rather than one a
 * manager glances at mid-task, by rendering an entry directly (`/league-rules`'s `GlossarySection`,
 * Task 10 / E10) — so two surfaces can never quietly say two different things about what "on the
 * clock" means.
 *
 * `waiver` is deliberately absent: this product has no waiver-wire surface yet, and defining a
 * feature it doesn't have would teach a word nobody can act on.
 *
 * A term defined here does not have to be wired to an `InfoTip` the same commit it is added — but
 * it cannot go unwired silently. `glossary.source.test.ts`'s `UNSURFACED` allowlist is where an
 * unwired term is named on purpose, with a reason and the task that owns wiring it; a term with
 * neither an `InfoTip` caller nor an `UNSURFACED` entry fails that test (Phase 3.6 addendum,
 * Task 15 — the backend-leverage inventory, `docs/backend-surface-map.md`).
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
  | "median-game"
  | "queue"
  | "draft-slot"
  | "sit-and-go"
  | "verified-reviewer"
  | "house-league"
  | "playoffs"
  | "release-seat";

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
      "This league's point values do not match Standard, PPR, Half PPR, or PPR with a TE premium exactly, because its commissioner adjusted at least one of them. It is not a lower-quality league, just a hand-tuned one.",
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
    // THE SENTENCE THE SPEC NAMES. `docs/design/2026-08-27-fun-pass-spec.md` quotes this exact
    // line as its example of the second cause of "it feels like a legal website": *"'This team
    // must make its pick before time runs out.' is a compliance sentence. A fantasy product says
    // 'You're on the clock' and stops talking."* Task 4's voice pass swept `src/draft-room/**`
    // and this string survived it, because it lives in the glossary and only reaches the room
    // through a guided `InfoTip` — where it prints inline, under the very label it contradicts.
    // Same fact, said the way the product says it.
    short: "It is their turn, and the clock is running.",
    detail:
      "Being on the clock means it is that team's turn to draft, and a countdown is running. If the clock runs out before they pick, the room moves on for them so the draft never stalls on one team.",
  },
  "lineup-lock": {
    key: "lineup-lock",
    term: "a lineup lock",
    short: "Once a week's first game kicks off, that week's lineup cannot change.",
    detail:
      "A lineup locks for the whole week the moment its first game kicks off, not player by player. Set your lineup before that kickoff, because you cannot swap anyone in or out again until the following week opens.",
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
  "median-game": {
    key: "median-game",
    term: "a median game",
    short: "Every week, your record also counts how you scored against the league median.",
    detail:
      "This league plays a median game: every week, on top of your head-to-head matchup, your score is compared to the league's median score that week. Beat the median and you get a second win added to your record; miss it and you get a second loss. Both results fold into the same wins-losses-ties record shown here, so a team can go 2-0 or 0-2 in a single week.",
  },
  queue: {
    key: "queue",
    term: "your draft queue",
    short: "The list of players you ranked, used to pick for you if you are away on your turn.",
    // C3: the safety net has one phrasing, "the room picks for you: your queue first, then the
    // best player your roster needs" — quoted
    // here so the waiting room's own missed-draft and filling-state sentences (Task 9) never
    // drift from what this term already promises.
    detail:
      "Your draft queue is the ranked list of players you would want if you cannot pick in person. If the clock runs out on your turn, the room picks for you: your queue first, then the best player your roster needs.",
  },
  "draft-slot": {
    key: "draft-slot",
    term: "a draft slot",
    short: "Your position in the draft order, from 1st pick to last.",
    detail:
      "A draft slot is your position in the draft order, from slot 1 (the first pick of the draft) to the last slot. You can rank the slots you want before the draft starts. We draw managers in a random order and give each one their highest-ranked slot that is still free, so a good rank still beats pure luck without anybody being able to pick their exact spot outright.",
  },
  "sit-and-go": {
    key: "sit-and-go",
    term: "a sit-and-go league",
    short: "Drafts on its own the moment every seat fills, no scheduled time.",
    detail: `A sit-and-go league has no draft time on the calendar. Instead, its draft starts on its own about ${SIT_AND_GO_GRACE_MINUTES} minutes after the last open seat fills, giving everyone a chance to open the room before it begins.`,
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
  /**
   * Phase 3.5 addendum, Task 14, Step 5: the word the shelf and the members panel both need.
   * `detail` is the brief's own sentence, verbatim. `short` is a compliant derivative — the
   * full sentence runs to 128 characters, past `HELP_CONFIG.maxShortLength` (90) — that keeps
   * the same two facts (Commish runs it, everyone plays the same game) without the third
   * (the shelf always has a seat), which `detail` still states in full once a reader opens it.
   */
  "house-league": {
    key: "house-league",
    term: "a house league",
    short: "A league Commish runs. Everyone joins the same way and plays the same rules.",
    detail:
      "A league Commish runs. Everyone joins the same way, the rules are the same in every one, and a new one opens whenever one fills.",
  },
  /**
   * Phase 3.6, Task 5: the open-league shelf's own fourth fact (`OpenLeagueCard`'s "Playoffs"
   * line, `PublicLeagueSummary.playoffWeeks`) — a stranger sizing up a league before they join it
   * can see the weeks named but has no way yet to know what happens in them without this.
   */
  playoffs: {
    key: "playoffs",
    term: "the playoff bracket",
    short: "The top teams play a short bracket at the end of the season for the league title.",
    detail:
      "Once the regular season ends, the top teams in the standings play a short elimination bracket across the weeks shown here. Win your game each week to advance; lose and your season is over. Whoever wins the final week takes the league.",
  },
  /**
   * Phase 3.6, Task 8: the escape hatch a room that rolls forward forever requires.
   * `ReleaseSeatControl` (`@/league-room/components/release-seat-control`) is this term's own
   * `InfoTip` caller.
   */
  "release-seat": {
    key: "release-seat",
    term: "releasing your seat",
    short: "Leaves the league and frees your seat for someone else, before the draft starts.",
    detail:
      "Releasing your seat leaves the league right away and frees it for another manager to claim, as long as the draft has not started yet. It cannot be undone. A member league's commissioner cannot release their own seat, because this product has no way yet to hand that role to someone else.",
  },
};

export function term(key: TermKey): GlossaryTerm {
  return GLOSSARY[key];
}
