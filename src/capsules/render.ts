import type { PropMarket } from "@/projections/odds/props-store";
import type { PlayerFacts } from "./facts";

/**
 * THE MODEL-FACING FACT SHEET — a SEPARATE, TESTED SERIALIZATION from `facts.ts`'s own internal
 * `PlayerFacts` object, on founder ruling (2026-09-04, live-fire review): a real gateway sample
 * leaked "p10 to p90 range", "evidence projection" and "measured young-age edge" into fan-facing
 * prose because the model was handed this engine's own internal vocabulary directly. This module
 * re-derives every sentence from `PlayerFacts`' raw NUMBERS — never by echoing a string built
 * anywhere else in this product (`verdictLine`, `ReasonChip`'s copy, `groups.ts`'s labels all stay
 * unread here) — in the plain, translated words a manager already thinks in: "floor 178, ceiling
 * 275" never "p10/p90"; "our number: 248 season points" never "evidence projection"; "age 23.5,
 * the age curve is on his side, worth +1.3 a game" never "measured young-age edge".
 *
 * THE MARKET-ANCHOR NUMBER, PHRASED AS A RETURNED FACT, NOT AN EXPECTATION (second founder
 * live-fire correction): `marketAnchorPoints` is the FITTED REALIZATION curve — what players
 * taken at that draft slot HISTORICALLY RETURNED, busts and injuries pooled
 * (`src/projections/market/curve.ts`) — never what drafters expect. "Implying"/"implied" are
 * banned words for exactly this reason (`config.ts`'s own `BANNED_VOCABULARY`); this renders it
 * as "{position}s taken around his draft slot have historically returned about {N} points a
 * season" paired with "our number says {M}" so the GAP is the story, not an error bar.
 *
 * THE TWO-BAND FRAME (founder ruling, 2026-09-04): the product-wide display convention leads with
 * the p25-p75 "most seasons" band (`PlayerFacts.projection.typicalLow`/`typicalHigh`, derived from
 * the stored median/floor/ceiling — see `facts.ts`'s own docblock), with the honest p10-p90 as the
 * tails behind it. The low tail (`floorPoints`) is NEVER phrased as a bare "floor": it is an
 * AVAILABILITY fact (an injury-season number), not a talent claim — this function always pairs it
 * with that context in one phrase, never as an apology and never as the sentence's own headline.
 *
 * RANK CONTEXT, ONLY WHERE THIS ENGINE ACTUALLY COMPUTES ONE. The founder's own review asked for
 * "32.6% target share, first among WRs" — this engine has no per-quantity rank table (no rank
 * exists for "target share" specifically anywhere in this codebase), and inventing one would be
 * the exact fabrication the validator exists to catch. What IS real and already in `PlayerFacts`
 * is attached instead: the board's own scarcity-based position rank (`market.positionRank`) and
 * the market's own ADP-based one (`market.positionAdp`) sit beside the board rank and the ADP
 * respectively, and the tier's own gap to the next player (`playersLeftInTier`/`dropToNextTier`)
 * rides beside it — three real numbers this engine already holds, none invented for the occasion.
 *
 * ENVIRONMENT BEATS IN MANAGER LANGUAGE (founder, same review): every non-law fact reads as a
 * narrative beat rather than a coded reason ("new play caller at MIA; a new play caller is the
 * honest concern" — the founder's own phrasing, kept verbatim). NO ABSENCE IS EVER STATED: this
 * function only ever renders a FIRED fact; it never claims a risk or a competitor is absent,
 * because `facts.ts` carries no "checked, did not fire" ledger to license that claim honestly
 * (see `facts.ts`'s own docblock on this scope limit) — the system prompt (`write.ts`) repeats
 * this as a hard rule for the same reason.
 *
 * "THE COLOR" (spec §9 AMENDED 2026-09-05, founder: "make it feel like a real analyst breaking it
 * down") is one more section, same discipline: `lastSeasonStoryLine`/`booksNumbersLine`/
 * `usageLine` each translate one of `facts.ts`'s three new color-fact groups into plain sentences,
 * omitted entirely (never a placeholder line) when the underlying store held nothing for him. The
 * props line's own market key (`player_reception_yds`) is exactly the internal-vocabulary hazard
 * this file exists to keep out of a prompt, so `PROP_MARKET_LABELS` is the one place it is turned
 * into English before the model ever sees it.
 */

function signed(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

function signedPercentOf(fraction: number): string {
  return `${signed(Math.round(fraction * 100), 0)}%`;
}

function boardLine(facts: PlayerFacts): string {
  const { market, projection } = facts;
  const rankBits = [`overall rank ${market.boardRank}`];
  if (market.positionRank !== null) rankBits.push(`position rank ${facts.identity.position}${market.positionRank} by our own board`);
  const bandLine = `Most seasons land between ${Math.round(projection.typicalLow)} and ${Math.round(projection.typicalHigh)} points. The full tails run ${Math.round(projection.floorPoints)} to ${Math.round(projection.ceilingPoints)}, and the low end of that tail is the injury seasons, not a talent read.`;
  const line = `Our number: ${Math.round(projection.projectedPoints)} season points. ${bandLine} ${rankBits.join(", ")}.`;
  const marketBits: string[] = [];
  marketBits.push(market.adp === null ? "The market has not priced him." : `Market ADP ${market.adp}${market.positionAdp !== null ? ` (${market.positionAdp} by market rank)` : ""}.`);
  if (market.marketAnchorPoints !== null) {
    marketBits.push(
      `${facts.identity.position}s taken around his draft slot have historically returned about ${market.marketAnchorPoints} points a season (busts and injuries pooled in); our number is ${signed(market.marketAnchorDelta ?? 0)} points from that.`,
    );
  }
  if (market.playersLeftInTier !== null && market.dropToNextTier !== null) {
    marketBits.push(`${market.playersLeftInTier} players left in his tier before a ${market.dropToNextTier.toFixed(1)}-point cliff.`);
  }
  return [line, ...marketBits].join(" ");
}

function availabilityLine(facts: PlayerFacts): string | null {
  const availability = facts.availability;
  if (availability === null) return null;
  return `Availability: expected ${Math.round(availability.expectedGames)} games, with a realistic range of ${Math.round(availability.floorGames)} to ${Math.round(availability.ceilingGames)} once you account for injury risk.`;
}

function evidenceLines(facts: PlayerFacts): readonly string[] {
  return facts.evidence.map((item) => {
    switch (item.kind) {
      case "law":
        return `${item.headline}: worth ${signed(item.netEffectPoints)} a game${item.lawCount > 1 ? ` (net of ${item.lawCount} factors)` : ""}.`;
      case "offseason_share_gained":
        return `Offseason role grew: targets ${signedPercentOf(item.targetShareChange)}, carries ${signedPercentOf(item.carryShareChange)}.`;
      case "offseason_share_lost":
        return `Offseason role shrank: targets ${signedPercentOf(item.targetShareChange)}, carries ${signedPercentOf(item.carryShareChange)}.`;
      case "changed_team":
        return `Changed teams: ${item.from} to ${item.to}.`;
      case "new_play_caller":
        return `New play caller at ${item.team}; a new play caller is the honest concern.`;
      case "rookie":
        return item.overallPick === null ? "A rookie, went undrafted." : `A rookie, drafted at pick ${item.overallPick}.`;
      case "market_unlisted":
        return "The market has not listed him at all.";
    }
  });
}

function seasonLine(facts: PlayerFacts): string {
  const season = facts.season;
  if (season === null) return "No games played yet this season.";
  const t = season.totals;
  const parts = [
    `${t.carries === null ? "n/a" : t.carries} carries`,
    `${t.rushingYards} rush yards`,
    `${t.targets === null ? "n/a" : t.targets} targets`,
    `${t.receptions} catches`,
    `${t.receivingYards} rec yards`,
    `${t.passingYards} pass yards`,
    `${t.touchdowns} touchdowns`,
    `${t.fantasyPoints} fantasy points`,
  ];
  const gameWord = season.gamesPlayed === 1 ? "game" : "games";
  return `Season so far (${season.season}): ${season.gamesPlayed} ${gameWord}, ${season.pointsPerGame} points per game. Totals: ${parts.join(", ")}.`;
}

function byeLine(facts: PlayerFacts): string {
  return facts.byeWeek === null ? "Bye week not yet set." : `Bye: week ${facts.byeWeek}.`;
}

/** THE TRI-STATE READ (fix round 1, CRITICAL 2) — "clean" and "unknown" must never render the
 *  same sentence: a snapshot that genuinely checked and found nothing carries a dated "measured
 *  clean" claim (with its own as-of date, so the model never states health as a timeless fact);
 *  "unknown" (no snapshot has ever been read) says exactly that and nothing more — never the
 *  healthy claim, which would be a fabrication the moment a real designation was simply never
 *  captured yet. */
function injuryLine(facts: PlayerFacts): string {
  const injury = facts.injury;
  if (injury.state === "designated") return `Injury report: designation ${injury.designation} as of ${injury.asOf.slice(0, 10)}.`;
  if (injury.state === "clean") return `Injury report: checked as of ${injury.asOf.slice(0, 10)} and no designation was on file that day.`;
  return "Injury report: no injury feed has been checked for him yet. This is not a health claim either way.";
}

function newsLines(facts: PlayerFacts): readonly string[] {
  if (facts.news.length === 0) return ["No recent headlines on file."];
  return facts.news.map((story) => `"${story.title}"${story.publishedAt === null ? "" : ` (${story.publishedAt.slice(0, 10)})`}`);
}

/**
 * THE COLOR (spec §9 AMENDED 2026-09-05, "an analyst breaking it down") — `facts.lastSeasonStory`/
 * `facts.booksNumbers`/`facts.usage` translated into the same plain, manager-language sentences
 * every other section here already uses, never a bare recitation of the raw fields. `write.ts`'s
 * own VOICE_RULES tells the model to weave two or three of these into the story rather than list
 * them, so each sentence below states one clean idea a model can lift in part.
 */
function lastSeasonStoryLine(facts: PlayerFacts): string | null {
  const story = facts.lastSeasonStory;
  if (story === null) return null;
  const gameWord = story.gamesPlayed === 1 ? "game" : "games";
  return (
    `Last season (${story.season}): finished ${facts.identity.position}${story.positionRank} at the position by total points, ` +
    `over ${story.gamesPlayed} ${gameWord}, averaging ${story.pointsPerGame} points a game. ` +
    `His best week was week ${story.bestWeek.week} with ${story.bestWeek.points} points. ` +
    `He scored above the position's own weekly median in ${story.weeksAboveMedian} of those ${story.gamesPlayed} ${gameWord}.`
  );
}

/** Never echoed to the model as `player_reception_yds` (`facts.ts`'s own two-audience rule): a
 *  raw market key is exactly the kind of internal vocabulary the p10/p90 incident already taught
 *  this engine to keep out of a prompt. */
const PROP_MARKET_LABELS: Readonly<Record<PropMarket, string>> = {
  player_pass_yds: "pass yards",
  player_reception_yds: "receiving yards",
  player_receptions: "receptions",
  player_rush_yds: "rush yards",
  player_pass_tds: "pass touchdowns",
};

function booksNumbersLine(facts: PlayerFacts): string | null {
  const { propsLines, teamVegasWinTotal } = facts.booksNumbers;
  const sentences: string[] = [];
  if (propsLines.length > 0) {
    const named = propsLines.map((line) => `${PROP_MARKET_LABELS[line.market]} ${line.medianLine}`).join(", ");
    sentences.push(`The books hang these pre-kickoff lines on him this season: ${named}. That is what they returned, not this engine's own claim.`);
  }
  if (teamVegasWinTotal !== null) {
    sentences.push(`His team's own Vegas win total for this season is ${teamVegasWinTotal}.`);
  }
  return sentences.length === 0 ? null : sentences.join(" ");
}

function usageLine(facts: PlayerFacts): string | null {
  const usage = facts.usage;
  if (usage === null) return null;
  const shares: string[] = [];
  if (usage.snapShare !== null) shares.push(`snap share ${(usage.snapShare * 100).toFixed(1)}%`);
  if (usage.targetShare !== null) shares.push(`target share ${(usage.targetShare * 100).toFixed(1)}%`);
  if (usage.redZoneShare !== null) shares.push(`red-zone share of his own touches ${(usage.redZoneShare * 100).toFixed(1)}%`);
  if (shares.length === 0) return null;
  return `Last season's usage (${usage.season}): ${shares.join(", ")}.`;
}

function colorLines(facts: PlayerFacts): readonly string[] {
  return [lastSeasonStoryLine(facts), booksNumbersLine(facts), usageLine(facts)].filter((line): line is string => line !== null);
}

/** The whole fact sheet, plain text, section by section — what `write.ts` sends as the user
 *  message. Every line traces to a `PlayerFacts` field; nothing here is invented and nothing here
 *  echoes another module's own copy (see this file's own docblock). */
export function renderFactsForModel(facts: PlayerFacts): string {
  const sections: string[] = [
    `Player: ${facts.identity.name}, ${facts.identity.position}, ${facts.identity.team}. Season: ${facts.productSeason}.`,
    boardLine(facts),
  ];
  const availability = availabilityLine(facts);
  if (availability !== null) sections.push(availability);
  const evidence = evidenceLines(facts);
  if (evidence.length > 0) sections.push(`The case:\n${evidence.map((line) => `- ${line}`).join("\n")}`);
  const color = colorLines(facts);
  if (color.length > 0) sections.push(`The color:\n${color.map((line) => `- ${line}`).join("\n")}`);
  sections.push(seasonLine(facts));
  sections.push(byeLine(facts));
  sections.push(injuryLine(facts));
  sections.push(`Recent news:\n${newsLines(facts).map((line) => `- ${line}`).join("\n")}`);
  return sections.join("\n\n");
}
