import type { MatchupLineupEntry, MatchupSide, MatchupSummary } from "../contract";
import { formatPoints } from "./format";

/**
 * THE FACTS THAT TURN A SCORE INTO A STORY, and every one of them is arithmetic over numbers the
 * matchup page already holds. No new query, no model, no forecast.
 *
 * Gameday's spec names what a generic scoreboard omits: *"Answer 'can I still win?', not only 'am
 * I winning?'. Yet-to-play, projected final, and per-player game state are what convert a score
 * into a story."* and *"State regret plainly (bench points, missed waivers) because the manager is
 * already computing it."* Two of those three are pure functions of a `MatchupSide` and live here.
 *
 * THE THIRD ONE, THE PROJECTED FINAL, IS DELIBERATELY ABSENT AND THAT IS A REFUSAL, NOT AN
 * OVERSIGHT. A projected final needs a per-player weekly projection, and nothing in the league
 * layer emits one — `matchupWeek` reads stat lines, not forecasts, and the projection engine
 * (`@/projections`) publishes no weekly per-player number this read can reach. Gameday's honesty
 * clause is "no invented data", so the hero prints `NOT_STARTED_DASH` where the projection goes
 * and the surface carries "can I still win?" on the two facts that ARE true: how many of your
 * starters have yet to take the field, and how much of the board each side has actually put up.
 * When the engine lands a weekly projection, `Scoreboard`'s `projected` slot is where it goes and
 * nothing else on the screen has to move.
 */

/** Whether this slot holds a player who has not been scored yet. Both halves matter: an EMPTY
 *  slot is not a player who might still score, and a slot whose player already has a stat line is
 *  finished. `points === null` alone would count an unfilled FLEX as a reason for hope. */
function yetToPlay(entry: MatchupLineupEntry): boolean {
  return entry.playerId !== null && entry.points === null;
}

/**
 * How many of this side's starters have not put a number on the board yet — the count the
 * "3 yet to play" chip states, and the honest answer to "can I still win?" that this product can
 * actually compute.
 *
 * It counts STARTERS ONLY, because a bench player cannot score for you, and it counts SLOTS, not
 * games: two starters on the same real-world team read as two, which is what a manager watching
 * his own lineup means by the phrase.
 */
export function yetToPlayCount(side: MatchupSide): number {
  return side.starters.filter(yetToPlay).length;
}

/**
 * The same count, with the one gate that makes it true on a week that has ended: ONCE THE WEEK IS
 * FINAL, NOBODY HAS ANYTHING LEFT TO PLAY.
 *
 * Found by looking at the rendered page rather than by reading the code (Sunday v5). A starter
 * with no stat line is "yet to play" while the afternoon is still running, and after the week
 * settles the identical row means something entirely different — he was inactive, he was on a bye,
 * the feed never carried him. Printing "8 to play" in the LIVE ink under a `Final` badge is the
 * same class of lie `NOT_STARTED_DASH` exists to stop, told in the other direction: it promises
 * points that can no longer arrive.
 *
 * The gate lives here rather than at three call sites because all three ask the identical
 * question, and the one that forgot would be the one on the screen a manager reads on Sunday.
 */
export function remainingToPlay(side: MatchupSide, weekStatus: MatchupSummary["weekStatus"]): number {
  return weekStatus === "final" ? 0 : yetToPlayCount(side);
}

/**
 * What this side left on its bench — the sum of every bench player who actually scored, or `null`
 * when nobody on the bench has played yet.
 *
 * `null` rather than `0` is the same ruling `NOT_STARTED_DASH` makes for a player: before any
 * bench game has kicked off, "0.00 on your bench" is a claim about a Sunday that has not happened.
 * Zero itself is a real answer once games are in — a bench that genuinely produced nothing is a
 * fact worth stating, and a manager who benched correctly has earned reading it.
 *
 * REGRET IS STATED, NEVER COMPUTED INTO A JUDGEMENT. This returns the number and nothing else:
 * no "you should have started him", no optimal-lineup difference. The manager is already doing
 * that arithmetic, which is exactly why the spec asks for the figure rather than the verdict.
 */
export function benchPoints(side: MatchupSide): number | null {
  const scored = side.bench.filter((entry) => entry.points !== null);
  if (scored.length === 0) return null;
  return scored.reduce((total, entry) => total + (entry.points ?? 0), 0);
}

/**
 * The starter carrying this side's afternoon — the highest real score in the lineup, or `null`
 * before anybody has scored.
 *
 * Ties resolve to the first slot in roster order, which is arbitrary and stated as such: two
 * players on exactly the same number are equally the story, and picking one by a hidden rule
 * would be a judgement the data does not support. The surface prints the number beside the name,
 * so a reader can see the tie for themselves.
 */
export function topStarter(side: MatchupSide): MatchupLineupEntry | null {
  let best: MatchupLineupEntry | null = null;
  for (const entry of side.starters) {
    if (entry.points === null) continue;
    if (best === null || entry.points > (best.points ?? 0)) best = entry;
  }
  return best;
}

/**
 * "You are up 7.40." / "You are down 7.40." / "Bay Bandits leads by 7.40." — the margin, in the
 * one sentence every surface that shows two scores states it with.
 *
 * IT IS A SUBTRACTION, NOT A JUDGEMENT. Both numbers are already on screen; this says out loud
 * what a manager would otherwise do in their head, which is the whole reason it earns its line.
 *
 * `null` when either score is missing — a margin needs two real numbers, never a guess against a
 * dash — and second person only for a manager reading their own game. Somebody else's matchup is
 * written about them, in the third person, the same discipline `MedianResultLine` already keeps.
 *
 * Extracted here (Gameday) because it now has two callers with different layouts around it: the
 * hero's own middle column, and `MatchupScoreboard`'s single line. One sentence, one spelling.
 */
export function marginSentence(matchup: MatchupSummary, myTeamId: string | null): string | null {
  const { homeScore, awayScore, homeTeamId, awayTeamId, homeTeamName, awayTeamName } = matchup;
  if (homeScore === null || awayScore === null) return null;
  const margin = formatPoints(Math.abs(homeScore - awayScore));
  const iAmHome = myTeamId === homeTeamId;
  const iAmAway = myTeamId === awayTeamId;

  if (homeScore === awayScore) {
    return iAmHome || iAmAway ? `You are tied at ${formatPoints(homeScore)}.` : `Tied at ${formatPoints(homeScore)} apiece.`;
  }
  const homeLeads = homeScore > awayScore;
  if (iAmHome || iAmAway) {
    const winning = (iAmHome && homeLeads) || (iAmAway && !homeLeads);
    return winning ? `You are up ${margin}.` : `You are down ${margin}.`;
  }
  return `${homeLeads ? homeTeamName : awayTeamName} leads by ${margin}.`;
}

/**
 * The margin as the DELTA IT IS, from the viewer's own seat: positive while they lead, negative
 * while they trail. `null` when either score is missing — a margin needs two real numbers, never a
 * guess against a dash.
 *
 * LAW 1, AND WHY THIS EXISTS BESIDE `marginSentence` RATHER THAN REPLACING IT. *"Every number is a
 * delta, not a fact"*: a lower third's job is to carry the comparison, and `+3.00` is the
 * comparison stated as a figure a reader can scan a column of. `marginSentence` is the same
 * arithmetic written as a sentence, which is the right form inside a card's own prose line and the
 * wrong one in a strip of tabular cells — the two callers want different registers of one fact,
 * which is exactly the case for two functions over one subtraction rather than one function and a
 * formatting flag.
 *
 * A viewer with no team in this matchup gets the HOME side's delta, the same seat every other
 * mine/theirs derivation on this surface gives them.
 */
export function signedMargin(matchup: MatchupSummary, myTeamId: string | null): number | null {
  const { homeScore, awayScore, awayTeamId } = matchup;
  if (homeScore === null || awayScore === null) return null;
  return awayTeamId === myTeamId ? awayScore - homeScore : homeScore - awayScore;
}

/** A `MatchupDetail`'s own `MatchupSummary` shape, so `marginSentence` can be handed either. The
 *  detail carries the same six fields under `home`/`away` rather than flattened, and this is the
 *  one place that translation happens — a second copy at a call site is how the two shapes start
 *  disagreeing about which side is home. */
export function summaryOf(matchup: {
  readonly weekNumber: number;
  readonly home: MatchupSide;
  readonly away: MatchupSide;
  readonly final: boolean;
  readonly weekStatus: MatchupSummary["weekStatus"];
}): MatchupSummary {
  return {
    weekNumber: matchup.weekNumber,
    homeTeamId: matchup.home.teamId,
    awayTeamId: matchup.away.teamId,
    homeTeamName: matchup.home.teamName,
    awayTeamName: matchup.away.teamName,
    homeScore: matchup.home.score,
    awayScore: matchup.away.score,
    final: matchup.final,
    weekStatus: matchup.weekStatus,
  };
}
