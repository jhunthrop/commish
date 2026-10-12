import type { Position } from "@/domain/player";
import { POSITION_PLURAL } from "@/domain/position-words";
import { PROP_MARKET_LABELS } from "./prop-market-labels";
import { renderDepthSection } from "./render-depth";
import type { PlayerFacts, PlayerFactsRankedStat, PlayerFactsTrendMetric } from "./facts";

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

/**
 * THE ADP, IN DRAFTING WORDS (founder ruling, 2026-09-07: "it's a fantasy football app, not a stock
 * trading app"). The sheet says where drafters take him, never what "the market" "prices" him at,
 * because the model quotes the sheet and `BANNED_VOCABULARY` now refuses the trading words. The
 * rounded pick is printed beside the raw ADP so "around pick 100" grounds by construction: it is on
 * the sheet, and it is a plain rounding of the ADP on the ledger either way.
 */
function adpLine(facts: PlayerFacts): string {
  const { market } = facts;
  // The fact, never the sentence (written rate round, 2026-09-08): "drafters are not taking him"
  // and the evidence line's "nobody is drafting him yet" came back as the opener on 49 players.
  if (market.adp === null) return "ADP: none on file.";
  const byAdp = market.positionAdp === null ? "" : `, ${market.positionAdp} by ADP`;
  return `ADP ${market.adp} (drafters take him around pick ${Math.round(market.adp)}${byAdp}).`;
}

/** THE TWO RANGES, STATED AS DATA RATHER THAN AS A SENTENCE (refrains round, 2026-09-07). The prior
 *  wording ("Most seasons land between", "the injury seasons, not a talent read") came back
 *  verbatim in the reads, because a sheet that hands the model a finished sentence gets that
 *  sentence back. Terse labels leave the sentence for the writer to make. */
function rangesLine(facts: PlayerFacts): string {
  const { projection } = facts;
  return (
    `Middle range, where most outcomes fall: ${Math.round(projection.typicalLow)} to ${Math.round(projection.typicalHigh)} points. ` +
    `Full tails: ${Math.round(projection.floorPoints)} to ${Math.round(projection.ceilingPoints)}, the low tail from seasons shortened by injury.`
  );
}

function boardLine(facts: PlayerFacts): string {
  const { market, projection } = facts;
  const rankBits = [`overall rank ${market.boardRank}`];
  if (market.positionRank !== null) rankBits.push(`position rank ${facts.identity.position}${market.positionRank} by our own board`);
  const line = `Our number: ${Math.round(projection.projectedPoints)} season points. ${rangesLine(facts)} ${rankBits.join(", ")}.`;
  const adpBits: string[] = [adpLine(facts)];
  if (market.marketAnchorPoints !== null) {
    // Stated as data, not as a sentence: "have historically returned" came back on 68% of the
    // baseline's reads (refrains round). The founder's framing stands, this is what players drafted
    // there RETURNED, busts and injuries pooled, never what drafters expect.
    adpBits.push(
      `Past seasons of ${facts.identity.position}s drafted around his ADP: about ${market.marketAnchorPoints} points, busts and injuries pooled in. Our number is ${signed(market.marketAnchorDelta ?? 0)} points from that.`,
    );
  }
  if (market.playersLeftInTier !== null && market.dropToNextTier !== null) {
    adpBits.push(`${market.playersLeftInTier} players left in his tier before a ${market.dropToNextTier.toFixed(1)}-point cliff.`);
  }
  return [line, ...adpBits].join(" ");
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
      // The founder's own words, kept. Split at the semicolon because the sheet is prose the model
      // reads, and a semicolon on the sheet is a semicolon the validator later refuses in the read.
      case "new_play_caller":
        return `New play caller at ${item.team}. A new play caller is the honest concern.`;
      case "rookie":
        return item.overallPick === null ? "A rookie, went undrafted." : `A rookie, drafted at pick ${item.overallPick}.`;
      // Not "nobody is drafting him yet" (written rate round, 2026-09-08): a sheet that hands the
      // writer a sentence gets it back, and this one opened 12.2% of the written board.
      case "market_unlisted":
        return "No ADP on file for him.";
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
  return `Season so far (${season.season}): ${season.gamesPlayed} ${gameWord}, ${season.pointsPerGame.toFixed(1)} points per game. Totals: ${parts.join(", ")}.`;
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
 * `facts.booksNumbers`/`facts.usage`/`facts.trend` (the last one, color v2, Task 2) translated
 * into the same plain, manager-language sentences every other section here already uses, never a
 * bare recitation of the raw fields. `write.ts`'s own VOICE_RULES tells the model to weave two or
 * three of these into the story rather than list them, so each sentence below states one clean
 * idea a model can lift in part.
 */
/** One `PlayerFactsRankedStat` as a plain clause, WITHOUT a trailing period (color v2, Task 1) —
 *  the value, the honest "Nth among M qualifying Xs" read, and, for a top-three finish, the
 *  leader's own name or the peer one rank above. Shared by `lastSeasonStoryLine` (points, touches,
 *  receiving yards, each its own sentence) and `usageLine` (the three shares, comma-joined into
 *  one sentence), so the "who's ahead of him" phrasing never drifts between the two sections. */
function rankedStatClause(position: Position, label: string, rank: PlayerFactsRankedStat, formatValue: (value: number) => string): string {
  const qualifierNoun = POSITION_PLURAL[position];
  const rankBit = `${position}${rank.positionRank} among ${rank.qualifierCount} qualifying ${qualifierNoun}`;
  if (rank.positionRank === 1) return `${label} ${formatValue(rank.value)}, ${rankBit}, best at the position`;
  if (rank.namedNeighbor !== null) return `${label} ${formatValue(rank.value)}, ${rankBit}, one spot behind ${rank.namedNeighbor}`;
  return `${label} ${formatValue(rank.value)}, ${rankBit}`;
}

/** `rankedStatClause`, as its own complete sentence — the shape `lastSeasonStoryLine` wants for
 *  touches/receiving yards, each stated on its own. */
function rankedStatSentence(position: Position, label: string, rank: PlayerFactsRankedStat, formatValue: (value: number) => string): string {
  return `${rankedStatClause(position, label, rank, formatValue)}.`;
}

function lastSeasonStoryLine(facts: PlayerFacts): string | null {
  const story = facts.lastSeasonStory;
  if (story === null) return null;
  const position = facts.identity.position;
  const gameWord = story.gamesPlayed === 1 ? "game" : "games";
  const wholeNumber = (value: number): string => `${Math.round(value)}`;
  const sentences = [
    `Last season (${story.season}): ${rankedStatSentence(position, "total points", story.pointsRank, wholeNumber)}`,
    `Over ${story.gamesPlayed} ${gameWord}, averaging ${story.pointsPerGame.toFixed(1)} points a game.`,
    `His best week was week ${story.bestWeek.week} with ${story.bestWeek.points} points.`,
    `He scored above the position's own weekly median in ${story.weeksAboveMedian} of those ${story.gamesPlayed} ${gameWord}.`,
  ];
  // `touchesRank` is `null` on the honest "the participation feed never placed him" absence (see
  // facts.ts's own docblock) — omitted entirely rather than a placeholder sentence, the same rule
  // every other color fact in this file already keeps.
  if (story.touchesRank !== null) sentences.push(rankedStatSentence(position, "Touches", story.touchesRank, wholeNumber));
  sentences.push(rankedStatSentence(position, "Receiving yards", story.receivingYardsRank, wholeNumber));
  return sentences.join(" ");
}

function booksNumbersLine(facts: PlayerFacts): string | null {
  const { propsLines, teamVegasWinTotal } = facts.booksNumbers;
  const sentences: string[] = [];
  if (propsLines.length > 0) {
    const named = propsLines.map((line) => `${PROP_MARKET_LABELS[line.market]} ${line.medianLine}`).join(", ");
    // "The books hang" came back on 80% of the baseline's reads (refrains round): a label now,
    // with the ownership of the number stated after it rather than as a sentence to reuse.
    sentences.push(`Pre-kickoff lines the books have posted on him this season: ${named}. Their numbers, not this engine's own claim.`);
  }
  if (teamVegasWinTotal !== null) {
    sentences.push(`His team's own Vegas win total for this season is ${teamVegasWinTotal}.`);
  }
  return sentences.length === 0 ? null : sentences.join(" ");
}

function usageLine(facts: PlayerFacts): string | null {
  const usage = facts.usage;
  if (usage === null) return null;
  const position = facts.identity.position;
  const asPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const shares: string[] = [];
  if (usage.snapShare !== null) shares.push(usage.snapShareRank === null ? `snap share ${asPercent(usage.snapShare)}` : rankedStatClause(position, "snap share", usage.snapShareRank, asPercent));
  if (usage.targetShare !== null) shares.push(usage.targetShareRank === null ? `target share ${asPercent(usage.targetShare)}` : rankedStatClause(position, "target share", usage.targetShareRank, asPercent));
  if (usage.redZoneShare !== null)
    shares.push(usage.redZoneShareRank === null ? `red-zone share of his own touches ${asPercent(usage.redZoneShare)}` : rankedStatClause(position, "red-zone share of his own touches", usage.redZoneShareRank, asPercent));
  if (shares.length === 0) return null;
  return `Last season's usage (${usage.season}): ${shares.join(", ")}.`;
}

/** One material trend metric as a plain sentence (color v2, Task 2) — "rose"/"fell" plus both raw
 *  seasons, never a bare delta a manager would have to do the subtraction on himself. An
 *  IMMATERIAL metric renders nothing at all: its real numbers still ground the fact sheet
 *  (`facts.ts`'s own ledger), but this file only ever narrates a movement worth a manager's
 *  attention, matching `trend.ts`'s own documented threshold. */
function trendMetricSentence(subject: string, metric: PlayerFactsTrendMetric, formatValue: (value: number) => string): string | null {
  if (!metric.material) return null;
  const verb = metric.delta >= 0 ? "rose" : "fell";
  return `${subject} ${verb} from ${formatValue(metric.priorValue)} in ${metric.priorSeason} to ${formatValue(metric.recentValue)} in ${metric.recentSeason}.`;
}

function trendLine(facts: PlayerFacts): string | null {
  const trend = facts.trend;
  if (trend === null) return null;
  const position = facts.identity.position;
  const opportunityNoun = position === "WR" || position === "TE" ? "yards per target" : "yards per touch";
  const asPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const sentences = [
    trend.pointsPerGame === null ? null : trendMetricSentence("His points per game", trend.pointsPerGame, (v) => `${v}`),
    trend.yardsPerOpportunity === null ? null : trendMetricSentence(`His ${opportunityNoun}`, trend.yardsPerOpportunity, (v) => `${v}`),
    trend.targetShare === null ? null : trendMetricSentence("His target share", trend.targetShare, asPercent),
  ].filter((sentence): sentence is string => sentence !== null);
  return sentences.length === 0 ? null : sentences.join(" ");
}

function colorLines(facts: PlayerFacts): readonly string[] {
  return [lastSeasonStoryLine(facts), booksNumbersLine(facts), usageLine(facts), trendLine(facts)].filter((line): line is string => line !== null);
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
  // THE DEPTH SECTION, LAST AND UNDER ONE HEADING (spec 2026-09-07, §5) — appended rather than
  // interleaved so every section above stays byte-identical and the cacheable prefix of the prompt
  // is not invalidated by the sheet growing. `null` when the depth stores held nothing for him,
  // which renders no heading at all rather than an empty one.
  const depth = renderDepthSection(facts);
  if (depth !== null) sections.push(depth);
  return sections.join("\n\n");
}
