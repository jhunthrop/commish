import type { PlayerFacts } from "./facts";
import type { PlayerFactsDepth } from "./facts/types";

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

/** Every line of the section, in `PlayerFactsDepth`'s own field order. */
function depthLines(depth: PlayerFactsDepth): readonly string[] {
  return [
    // Each fact's own renderer is added here as it is wired, in the spec's own fact order.
    ...seasonEndingLines(depth),
    gamesMissedLine(depth),
    injuryHistoryLine(depth),
    coachingLine(depth),
  ].filter((line): line is string => line !== null && line !== "");
}

/** The whole section, or `null` when the store held nothing worth a line. */
export function renderDepthSection(facts: PlayerFacts): string | null {
  const lines = depthLines(facts.depth);
  if (lines.length === 0) return null;
  return `The record:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}
