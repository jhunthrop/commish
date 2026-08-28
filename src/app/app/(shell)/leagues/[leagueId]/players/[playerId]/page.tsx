import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import { Card, PlayerObject, SeasonBars, SourceStrip, type SeasonWeek, type SourceValue } from "@/components/ui";
import type { Position } from "@/domain/player";
import { playerSeason, type PlayerSeasonBody } from "@/league-service/player";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string; readonly playerId: string }>;
}

/** An honest static title rather than a database read that exists only to name a browser tab —
 *  `pageTitle`'s own ruling (flow analysis A5). */
export function generateMetadata(): Metadata {
  return pageTitle("Player");
}

/**
 * A position in the words a manager would use, PLURAL, because that is the shape a population
 * takes in a sentence: "Top 8% of running backs this season."
 *
 * The words live at the call site rather than beside `PositionBadge`, and deliberately: a badge
 * owns a pigment and a three-letter code, and `Stat`'s own contract says the caller names the
 * population "in the words a manager would use". This screen is that caller.
 */
const POSITION_PLURAL: Readonly<Record<Position, string>> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

/**
 * THE SOURCE STRIP'S FIVE CELLS: a positional rank, three readings of one quantity, and what he
 * has actually produced.
 *
 * The shape is borrowed from the reference product and the middle three are where ours is meant
 * to be better than theirs: they compare three platforms' draft positions, which is three
 * aggregations of the same crowd, and we compare the market against expert consensus against our
 * own model, which is a disagreement somebody can be right or wrong about.
 *
 * TODAY EXACTLY ONE OF THE THREE REACHES THIS PAGE, and the other two print a dash and say
 * nothing. `PlayerSeasonBody`'s docblock carries the full account of what blocks each one; the
 * short version is that expert consensus lives in a different id space with no crosswalk and only
 * for seasons the model is scored on, and our own board has no persisted per-player output at all.
 * They are named and dashed rather than omitted, because a strip that silently drops the sources
 * it cannot reach is a strip that stops being a comparison — the dash is the honest report that
 * this product holds an opinion it cannot yet show you.
 *
 * ONLY ONE CELL IS TINTED. Points per game is a verdict about the player and has a population
 * behind it. The three draft-position cells are one quantity read by different sources: colouring
 * them would be colouring a SOURCE rather than a player, which is a claim none of them makes.
 */
function sourcesFor(body: PlayerSeasonBody): readonly SourceValue[] {
  const { player, positionRank, pointsPerGame, pointsPerGamePercentile } = body;
  return [
    { label: player.position, value: positionRank === null ? null : String(positionRank) },
    // One decimal, the precision `formatAdp` (`@/draft-room/lib/tiers`) already rules on: a
    // consensus of real drafts genuinely carries it, and rounding to a whole number makes two
    // different players look identical.
    { label: "Market", value: player.adp === null ? null : player.adp.toFixed(1) },
    { label: "Experts", value: null },
    { label: "Model", value: null },
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

/** Each played week, with the population that makes its colour mean something: not his own
 *  thirteen afternoons, but every week played at his position this season. */
function weeksFor(body: PlayerSeasonBody): readonly SeasonWeek[] {
  const population = `${POSITION_PLURAL[body.player.position]} in a week this season`;
  return body.weeks.map((week) => ({
    week: week.week,
    points: week.points,
    comparison: week.percentile === null ? undefined : { percentile: week.percentile, population },
  }));
}

/**
 * ONE PLAYER, AS THREE THINGS AND NO FOURTH: the object, the strip, the season.
 *
 * There is no prose on this page and there must never be any. Not a heading over the strip, not a
 * legend under it, not a sentence explaining what the bars are. The reference product the founder
 * named reads SIMPLE while being denser than us, and the reason is exactly this: its player panel
 * is four elements and no explanatory sentence anywhere on it. The chips carry the facts we would
 * otherwise write out, the source names are their own legend, and the week numbers are their own
 * axis. Everything a screen reader needs is on the elements themselves.
 *
 * WHY THE PAGE IS UNDER A LEAGUE. A fantasy point is not a property of a player, it is a property
 * of a player inside a rule set — see `playerSeason`. There is no honest league-free version of
 * this screen, so there is no league-free route to it.
 */
export default async function PlayerPage({ params }: PageProps) {
  const user = await requireCurrentUser();
  const { leagueId, playerId } = await params;

  // The cheap, canonical gate — a team in this league or its commissioner. A non-member gets the
  // same 404 the matchup page gives them, never a "you are not allowed" page that confirms the
  // league exists.
  const membership = await resolveLeagueMembership(getDb(), leagueId, user.id);
  if (!membership.ok) notFound();

  const body = await playerSeason(getDb(), leagueId, playerId);
  if (body === null) notFound();

  return (
    <Card as="section" className="flex flex-col gap-6">
      <PlayerObject player={body.player} />
      <SourceStrip label={`Where ${body.player.name} is ranked, by source`} sources={sourcesFor(body)} />
      <SeasonBars label={`${body.player.name}, points by week`} weeks={weeksFor(body)} />
    </Card>
  );
}
