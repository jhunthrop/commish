import type { SeasonWeek, SourceValue } from "@/components/ui";
import type { Position } from "@/domain/player";
import type { PlayerDossierFacts } from "@/league-service/dossier-facts";
import type { PlayerSeasonBody } from "@/league-service/player";
import type { CallCardMarket, CallCardOurBoard } from "../dossier/call-card";
import { verdictLine } from "../outlook/verdict";

/**
 * A position in the words a manager would use, PLURAL — the shape a population takes in a
 * sentence ("Top 8% of running backs this season"). Extracted from the player page when the
 * bottom-sheet peek became this view's second consumer (founder, 2026-08-30: the name opens a
 * drawer wherever it appears).
 */
export const POSITION_PLURAL: Readonly<Record<Position, string>> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

/** The source strip's five cells; precision rulings live with each cell. See the player page's
 *  original docblock for the full account of which sources reach this season. */
export function sourcesFor(body: PlayerSeasonBody): readonly SourceValue[] {
  const { player, positionRank, expertRank, modelRank, pointsPerGame, pointsPerGamePercentile } = body;
  return [
    { label: player.position, value: positionRank === null ? null : String(positionRank) },
    // "ADP" (Task 5, 2026-09-04 — was "Market"): this cell sits among three RANKS
    // (position, experts, model) and a plain draft-position number labelled "Market" read as a
    // fourth rank rather than the average draft position it actually is.
    { label: "ADP", value: player.adp === null ? null : player.adp.toFixed(1) },
    { label: "Experts", value: expertRank === null ? null : String(expertRank) },
    { label: "Model", value: modelRank === null ? null : String(modelRank) },
    {
      label: "PPG",
      value: pointsPerGame === null ? null : pointsPerGame.toFixed(1),
      comparison:
        pointsPerGamePercentile === null
          ? undefined
          : { percentile: pointsPerGamePercentile, population: `${POSITION_PLURAL[player.position]} this season` },
    },
  ];
}

/** `CallCard`'s own props, composed from `PlayerSeasonBody` plus its `dossier` (Player Dossier
 *  plan, Task 5 — the "adapter" `call-card.tsx`'s own docblock disclosed as this task's cost).
 *  `expertRank` is the ONE field `CallCardMarket` needs that the dossier itself does not carry
 *  (it lives on `PlayerSeasonBody` — the ECR-consensus read `dossier-facts.ts` never touches, see
 *  that module's own docblock); everything else comes straight off `dossier.market`/`.projection`/
 *  `.availability`. The verdict is composed here, once, from the SAME `reasons`/`position`
 *  `Outlook` would otherwise re-derive the identical sentence from — `Outlook` is only ever
 *  rendered alongside `CallCard` in the fallback composition (no dossier facts at all), never
 *  both at once for the same player, so there is no duplicate-verdict case for either component
 *  to guard against. */
export function callCardPropsFor(body: PlayerSeasonBody, dossier: PlayerDossierFacts): { readonly verdict: string | null; readonly market: CallCardMarket; readonly ourBoard: CallCardOurBoard; readonly gap: number | null } {
  return {
    verdict: verdictLine(body.reasons, body.player.position),
    market: { adp: dossier.market.adp, expertRank: body.expertRank },
    ourBoard: {
      position: body.player.position,
      positionRank: dossier.market.positionRank,
      boardRank: dossier.market.boardRank,
      points: dossier.projection.projectedPoints,
      scoringLabel: dossier.basis.scoringLabel,
      perGameRank: dossier.projection.perGamePositionRank?.positionRank ?? null,
      expectedGames: dossier.availability?.expectedGames ?? null,
    },
    gap: dossier.market.marketAnchorDelta,
  };
}

/** Whether `ReadCard` will render anything for this body — dossier plan, Task 6: shared by the
 *  peek and the full page so their own grids agree on when `BooksModule` spans alone (no capsule
 *  yet, the common state — Task 4's own note) versus when the two share the row. */
export function hasReadCardFor(body: PlayerSeasonBody): boolean {
  return body.capsule !== null && body.capsule !== undefined;
}

/** Whether the story cell (`StoryModule` + `NewsList`) will render anything for this body — the
 *  same "does either half of this cell have real content" question `hasReadCardFor` answers for
 *  the read/books row, kept alongside it for the identical reason. `StoryModule`'s own `story`
 *  prop is always `null` today (ruling R-d1: the service wiring converges post-merge), so its own
 *  visibility reduces to whether a current designation exists. */
export function hasStoryCellFor(body: PlayerSeasonBody): boolean {
  return body.injuryDesignation !== null || body.news.length > 0;
}

/** Each played week, judged against every week played at his position this season. */
export function weeksFor(body: PlayerSeasonBody): readonly SeasonWeek[] {
  const population = `${POSITION_PLURAL[body.player.position]} in a week this season`;
  return body.weeks.map((week) => ({
    week: week.week,
    points: week.points,
    comparison: week.percentile === null ? undefined : { percentile: week.percentile, population },
  }));
}
