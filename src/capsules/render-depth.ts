import { POSITION_PLURAL } from "@/league-room/lib/player-season-view";
import type { PlayerFacts, PlayerFactsRankedStat } from "./facts";
import type { PlayerFactsDepth, PlayerFactsFixture } from "./facts/types";

/**
 * THE DEPTH SECTION — `PlayerFacts.depth` turned into the same plain, dated, sourced sentences
 * every other section of `render.ts` already speaks, gathered under ONE heading.
 *
 * ONE HEADING, AND WHY IT MATTERS BEYOND TIDINESS (spec §5): the sheet's length grows here, and a
 * cached prompt prefix only pays while the bytes ahead of the change are identical. Appending the
 * whole depth group as the LAST section leaves every earlier section byte-for-byte where it was,
 * so the stable prefix a provider caches is unchanged rather than invalidated by lines interleaved
 * through the middle of it.
 *
 * ABSENCE IS RENDERED AS ABSENCE, without exception. Every function below returns `null` when its
 * own fact is missing and the caller drops it; the whole section returns `null` when nothing at all
 * was found. There is no placeholder line, no "unknown", and no zero standing in for a season the
 * store holds nothing about — the writer is told what we know and never told a shape where a fact
 * would have been.
 *
 * NO JUDGMENT, ANYWHERE. These sentences state measured facts and stop. A schedule is named, never
 * called easy; a coach is named, never called an upgrade; a missed season is dated, never explained
 * past what the source itself published.
 */

/** WHY EACH PRIOR SEASON ENDED — one line per season the evidence supports, never a line saying a
 *  season finished cleanly (this store cannot make that claim). The cause is quoted from whichever
 *  input answered and is never upgraded: "Knee" stays "Knee". */
function seasonEndingLines(depth: PlayerFactsDepth): readonly string[] {
  return depth.seasonEndings.map((ending) => {
    const cause =
      ending.source === "report"
        ? `the injury report listed him ${ending.reportStatus}${ending.primaryInjury === null ? "" : `, ${ending.primaryInjury.toLowerCase()}`}`
        : `the weekly roster listed him ${ending.rosterStatus} with no body part on file`;
    return `His ${ending.season} season ended after week ${ending.lastPlayedWeek}. From week ${ending.firstMissedWeek} on, ${cause}.`;
  });
}

/** GAMES MISSED, one sentence for every season the roster actually carried him. A season the store
 *  holds no roster weeks for is not in the list at all, so the sentence never implies a zero. */
function gamesMissedLine(depth: PlayerFactsDepth): string | null {
  if (depth.gamesMissed.length === 0) return null;
  const parts = depth.gamesMissed.map((season) => `${season.missed} of a possible ${season.teamGames} in ${season.season}`);
  return `Games missed, counted over the weeks a roster actually carried him: ${parts.join(", ")}.`;
}

/** THIS SEASON'S DESIGNATION HISTORY, one clause per run. A run over a single capture states that
 *  one date; a run over several states both ends and the count, which is what makes "for three
 *  straight weeks" a fact rather than an impression. */
function injuryHistoryLine(depth: PlayerFactsDepth): string | null {
  if (depth.injuryHistory.length === 0) return null;
  const spells = depth.injuryHistory.map((spell) => {
    const body = spell.description === null ? "" : `, ${spell.description.toLowerCase()}`;
    const when =
      spell.firstSeenAt === spell.lastSeenAt
        ? `on ${spell.firstSeenAt}`
        : `from ${spell.firstSeenAt} to ${spell.lastSeenAt} across ${spell.captureCount} captures`;
    return `${spell.designation} ${when}${body}`;
  });
  return `Injury designations captured this season, oldest first: ${spells.join(". ")}.`;
}

/** "New this year" only where the flag is `true`. A `null` flag prints the name and no tenure
 *  claim at all, because the table not covering the prior season is not evidence of continuity. */
function tenureClause(isNew: boolean | null): string {
  if (isNew === null) return "";
  return isNew ? ", new this year" : ", continuing from last season";
}

/** WHO IS CALLING THE PLAYS, by name. Each half is dropped independently when the curated table
 *  names nobody for it. */
function coachingLine(depth: PlayerFactsDepth): string | null {
  const coaching = depth.coaching;
  if (coaching === null) return null;
  const parts: string[] = [];
  if (coaching.headCoach !== null) parts.push(`head coach ${coaching.headCoach}${tenureClause(coaching.headCoachIsNew)}`);
  if (coaching.playCaller !== null) {
    const role = coaching.playCallerRole === "HC" ? "the head coach calls the plays himself" : "offensive play caller";
    const named = coaching.playCallerRole === "HC" ? `${role}, ${coaching.playCaller}` : `${role} ${coaching.playCaller}`;
    parts.push(`${named}${tenureClause(coaching.playCallerIsNew)}`);
  }
  return parts.length === 0 ? null : `Coaching for ${coaching.season}: ${parts.join(". ")}.`;
}

/** English for how many seasons he has already played. Past ten, the number reads better than the
 *  word, which is where every style guide draws the same line. */
const SEASON_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"] as const;

function seasonOrdinal(seasonsPlayed: number): string {
  const word = SEASON_WORDS[seasonsPlayed];
  return word === undefined ? `season number ${seasonsPlayed + 1}` : `${word} season`;
}

/** AGE, EXPERIENCE AND PEDIGREE. Every clause is dropped on its own when its value is absent, so a
 *  player the roster archive has a birth date for but no draft row still gets his age. */
function pedigreeLine(depth: PlayerFactsDepth): string | null {
  const pedigree = depth.pedigree;
  if (pedigree === null) return null;
  const parts: string[] = [];
  if (pedigree.ageOnOpeningDay !== null) parts.push(`Age ${pedigree.ageOnOpeningDay.toFixed(1)} on opening day`);
  if (pedigree.seasonsPlayed !== null) parts.push(`entering his ${seasonOrdinal(pedigree.seasonsPlayed)}`);
  if (pedigree.college !== null) parts.push(`out of ${pedigree.college}`);
  const draft = draftClause(depth);
  if (draft !== null) parts.push(draft);
  return parts.length === 0 ? null : `${parts.join(", ")}.`;
}

/** The draft half of the pedigree, or `null` when the archive holds nothing about his draft. */
function draftClause(depth: PlayerFactsDepth): string | null {
  const pedigree = depth.pedigree;
  if (pedigree === null || pedigree.draftYear === null) return null;
  if (pedigree.undrafted === true) return `undrafted out of the ${pedigree.draftYear} class`;
  const where = [
    pedigree.draftRound === null ? null : `round ${pedigree.draftRound}`,
    pedigree.draftPick === null ? null : `pick ${pedigree.draftPick}`,
  ].filter((part): part is string => part !== null);
  const by = pedigree.draftClub === null ? "" : ` by ${pedigree.draftClub}`;
  return where.length === 0 ? `drafted in ${pedigree.draftYear}${by}` : `drafted in ${pedigree.draftYear} at ${where.join(", ")}${by}`;
}

/** Slot numbers as a manager says them. Past fifth the number reads better than the word. */
const SLOT_WORDS = ["first", "second", "third", "fourth", "fifth"] as const;

function slotWord(slot: number): string {
  return SLOT_WORDS[slot - 1] ?? `number ${slot}`;
}

/** HIS DATED DEPTH CHART SLOT, and the men listed around him at his own position. */
function depthChartLine(facts: PlayerFacts): string | null {
  const chart = facts.depth.depthChart;
  if (chart === null) return null;
  const around =
    chart.aroundHim.length === 0
      ? "No other player at his position is listed on that release"
      : `Listed with him: ${chart.aroundHim.map((peer) => `${peer.name} ${slotWord(peer.slot)}`).join(", ")}`;
  return `Depth chart as of ${chart.asOf}: listed ${slotWord(chart.slot)} among ${facts.identity.team} ${facts.identity.position}s. ${around}.`;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** A window of weeks as a manager reads it: "weeks 1 to 4", or the bare week when there is one. */
function weekSpan(weeks: readonly number[]): string {
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  if (first === undefined || last === undefined) return "no weeks";
  return first === last ? `week ${first}` : `weeks ${first} to ${last}`;
}

/** HOW THE ROLE MOVED INSIDE THE SEASON, with both windows named. No verdict: "went from 25% to
 *  65%" is the fact, and whether that is a breakout is the writer's call to argue, not this
 *  module's to assert. */
function roleTrendLine(depth: PlayerFactsDepth): string | null {
  const trend = depth.roleTrend;
  if (trend === null) return null;
  const clauses = [
    trend.snapShare === null ? null : `snap share ${percent(trend.snapShare.early)} to ${percent(trend.snapShare.late)}`,
    trend.targetShare === null ? null : `target share ${percent(trend.targetShare.early)} to ${percent(trend.targetShare.late)}`,
  ].filter((clause): clause is string => clause !== null);
  if (clauses.length === 0) return null;
  return `Inside ${trend.season}, from ${weekSpan(trend.earlyWeeks)} to ${weekSpan(trend.lateWeeks)}: ${clauses.join(", ")}.`;
}

/** WHO ELSE ATE. Names and shares only. */
function targetCompetitionLine(depth: PlayerFactsDepth): string | null {
  const competition = depth.targetCompetition;
  if (competition === null) return null;
  const named = competition.leaders.map((leader) => `${leader.name} took ${percent(leader.share)}`).join(" and ");
  return `Target competition on ${competition.team} in ${competition.season}: ${named}, ${percent(competition.combinedShare)} between them.`;
}

/** One ranked quantity as a clause with its honest qualifier count, in the same shape `render.ts`'s
 *  own `rankedStatClause` already speaks: the value, the finish, and the real N behind it. Kept
 *  here rather than imported so the depth section stays additive against a file a parallel round
 *  is editing. */
function rankedClause(facts: PlayerFacts, label: string, rank: PlayerFactsRankedStat, formatValue: (value: number) => string): string {
  const position = facts.identity.position;
  const where = `${position}${rank.positionRank} among ${rank.qualifierCount} qualifying ${POSITION_PLURAL[position]}`;
  if (rank.positionRank === 1) return `${label} ${formatValue(rank.value)}, ${where}, best at the position`;
  if (rank.namedNeighbor !== null) return `${label} ${formatValue(rank.value)}, ${where}, one spot behind ${rank.namedNeighbor}`;
  return `${label} ${formatValue(rank.value)}, ${where}`;
}

/** SCORING-RANGE USAGE, in counts rather than shares. Each clause is dropped on its own when the
 *  play-by-play holds no real reading of it. */
function scoringUsageLine(facts: PlayerFacts): string | null {
  const usage = facts.depth.scoringUsage;
  if (usage === null) return null;
  const whole = (value: number): string => `${Math.round(value)}`;
  const clauses = [
    usage.redZoneTouches === null ? null : rankedClause(facts, "red-zone touches", usage.redZoneTouches, whole),
    usage.insideTenTouches === null ? null : rankedClause(facts, "touches inside the ten", usage.insideTenTouches, whole),
    usage.targetDepth === null ? null : rankedClause(facts, "average depth of target", usage.targetDepth, (value) => `${value.toFixed(1)} yards`),
  ].filter((clause): clause is string => clause !== null);
  return clauses.length === 0 ? null : `Scoring-range usage (${usage.season}): ${clauses.join(". ")}.`;
}

/** THE OFFENCE HE PLAYS IN, last season's shape and this season's opening price, each dated so the
 *  two are never read as one claim. No judgment: a fast offence is stated, never called good. */
function teamContextLine(facts: PlayerFacts): string | null {
  const context = facts.depth.teamContext;
  if (context === null) return null;
  const team = facts.identity.team;
  const history = [
    context.paceSecondsPerPlay === null ? null : `${context.paceSecondsPerPlay.toFixed(1)} seconds a play`,
    context.passRate === null ? null : `${percent(context.passRate)} of situation-neutral plays passes`,
    context.wins === null ? null : `${context.wins} wins`,
  ].filter((part): part is string => part !== null);
  const market = [
    context.weekOneImpliedTotal === null ? null : `an implied ${context.weekOneImpliedTotal} points`,
    context.weekOneSpread === null ? null : `a spread of ${context.weekOneSpread > 0 ? `+${context.weekOneSpread}` : context.weekOneSpread} in their favour`,
  ].filter((part): part is string => part !== null);
  const sentences = [
    history.length === 0 ? null : `${team} in ${context.priorSeason}: ${history.join(", ")}.`,
    market.length === 0 ? null : `The books price their week one game at ${market.join(" and ")}.`,
  ].filter((sentence): sentence is string => sentence !== null);
  return sentences.length === 0 ? null : sentences.join(" ");
}

function fixturePhrase(fixture: PlayerFactsFixture): string {
  return `${fixture.home ? "at home against" : "away at"} ${fixture.opponent} in week ${fixture.week}`;
}

/** THE PUBLISHED SCHEDULE. Fixtures and counts only, and never a word about how hard any of it is. */
function scheduleLine(depth: PlayerFactsDepth): string | null {
  const schedule = depth.schedule;
  if (schedule === null) return null;
  const sentences = [
    schedule.weekOneOpponent === null ? "The published schedule holds no week one game for his team." : `Opens ${fixturePhrase(schedule.weekOneOpponent)}.`,
    `${schedule.homeGames} home and ${schedule.roadGames} away on the published schedule${schedule.indoorGames === null ? ", with no roof reading on file" : `, ${schedule.indoorGames} of them indoors`}.`,
    schedule.playoffWeeks.length === 0
      ? "The schedule holds none of weeks 15 to 17 for his team yet."
      : `Weeks 15 to 17: ${schedule.playoffWeeks.map(fixturePhrase).join(", ")}.`,
  ];
  return `Schedule: ${sentences.join(" ")}`;
}

/** Every line of the section, in `PlayerFactsDepth`'s own field order. Takes the whole `PlayerFacts`
 *  rather than the depth group alone because a few of these sentences name his own team and
 *  position, which live on `identity` and must never be restated inside the depth group itself. */
function depthLines(facts: PlayerFacts): readonly string[] {
  const depth = facts.depth;
  return [
    // Each fact's own renderer is added here as it is wired, in the spec's own fact order.
    ...seasonEndingLines(depth),
    gamesMissedLine(depth),
    injuryHistoryLine(depth),
    coachingLine(depth),
    pedigreeLine(depth),
    depthChartLine(facts),
    roleTrendLine(depth),
    targetCompetitionLine(depth),
    scoringUsageLine(facts),
    teamContextLine(facts),
    scheduleLine(depth),
  ].filter((line): line is string => line !== null && line !== "");
}

/** The whole section, or `null` when the store held nothing worth a line. */
export function renderDepthSection(facts: PlayerFacts): string | null {
  const lines = depthLines(facts);
  if (lines.length === 0) return null;
  return `The record:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}
