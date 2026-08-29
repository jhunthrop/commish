import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matchups, weeks } from "@/db/schema";
import type { TeamCard } from "@/domain/league";
import { clinchedTeamIds, computeStandings, LEAGUE_CONFIG, seasonProgress } from "@/league";
import type { TeamStandingsRow } from "@/league-room/contract";

/** Every week this league already has a stored median for, keyed by week number — a week absent
 *  from the map has no median yet (unsettled, or the toggle is off), matching `weeks.median_score`
 *  itself, which is nullable for exactly those cases. */
async function medianByWeekFor(db: Db, leagueId: string): Promise<ReadonlyMap<number, number>> {
  const rows = await db.select({ weekNumber: weeks.weekNumber, medianScore: weeks.medianScore }).from(weeks).where(eq(weeks.leagueId, leagueId));
  return new Map(rows.flatMap((row) => (row.medianScore === null ? [] : [[row.weekNumber, row.medianScore] as const])));
}

/**
 * The last week this league has a settled result in, or `null` before it has any — the boundary
 * "last week's ranking" is measured against.
 *
 * A matchup counts once BOTH scores are present, which is the identical test `computeStandings`
 * itself applies. A half-scored week is not a result, so it is not a week the standings moved in.
 */
function lastSettledWeek(rows: readonly { readonly weekNumber: number; readonly homeScore: number | null; readonly awayScore: number | null }[]): number | null {
  let latest: number | null = null;
  for (const row of rows) {
    if (row.homeScore === null || row.awayScore === null) continue;
    if (latest === null || row.weekNumber > latest) latest = row.weekNumber;
  }
  return latest;
}

/**
 * Where every team stood BEFORE the most recent settled week — law 2's previous value, and the
 * whole reason the standings can show `▲2` instead of only `3`.
 *
 * IT IS ARITHMETIC, NOT A SECOND SOURCE, which is what makes it legal under law 7. The same
 * `computeStandings` runs a second time over the same matchup rows already in hand, with the most
 * recent settled week held out — no new query, no stored history table, no snapshot anybody has to
 * trust. A league whose only settled week IS the most recent one has nothing to hold out, so the
 * map comes back empty and every row reports a dash rather than a fabricated "unchanged".
 */
function previousRankByTeamId(input: {
  readonly teamIds: readonly string[];
  readonly matchups: readonly Parameters<typeof computeStandings>[0]["matchups"][number][];
  readonly medianByWeek: ReadonlyMap<number, number>;
}): ReadonlyMap<string, number> {
  const boundary = lastSettledWeek(input.matchups);
  // `null` is a league with no results at all; `1` is a league whose first week is its only one.
  // Neither has a previous ranking, and inventing one would rank twelve teams by nothing.
  if (boundary === null || boundary <= 1) return new Map();
  const before = input.matchups.filter((row) => row.weekNumber < boundary);
  const medianBefore = new Map([...input.medianByWeek].filter(([week]) => week < boundary));
  const priorStandings = computeStandings({ teamIds: input.teamIds, matchups: before, medianByWeek: medianBefore });
  return new Map(priorStandings.map((row, index) => [row.teamId, index + 1]));
}

/**
 * The standings table, with the display names, the owner's face, and the clinch flag the page
 * renders. `teamCards` is the SAME "team + owner's public profile" row set `leagueHome`
 * (`@/league-service/read.ts`) already reads via `listTeamCards` — passed in rather than
 * re-queried, so a page that already paid for that join does not pay for it twice.
 *
 * `medianGame` is REQUIRED, not queried here (fix round 1, LOW — the implementer's own flagged
 * seam, adjudicated): the sole production caller, `leagueHome` (`@/league-service/read.ts`),
 * already selects the full `leagues` row for its own purposes before it ever calls this, so a
 * second `leagues` query here for the one column this function needs would be the identical
 * wasted round trip `teamCards` already exists to avoid. A required parameter deletes that
 * dead fallback branch entirely rather than documenting why it exists; this function's OWN tests
 * already know the value (they choose it), so threading it through costs them nothing.
 */
export async function leagueStandings(
  db: Db,
  leagueId: string,
  teamCards: readonly TeamCard[],
  medianGame: boolean,
): Promise<readonly TeamStandingsRow[]> {
  const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const medianByWeek = await medianByWeekFor(db, leagueId);
  const standings = computeStandings({ teamIds: teamCards.map((card) => card.id), matchups: matchupRows, medianByWeek });

  const { weeksRemaining } = seasonProgress(matchupRows, LEAGUE_CONFIG.regularSeasonWeeks);
  // A median game is worth a second win every remaining week (Task 2's clinch correction) — the
  // caller's job, never `clinchedTeamIds`' own, per that parameter's own docblock.
  const gamesRemaining = weeksRemaining * (medianGame ? 2 : 1);
  const clinched = new Set(clinchedTeamIds({ standings, gamesRemaining, playoffTeams: LEAGUE_CONFIG.playoffTeams }));
  const cardById = new Map(teamCards.map((card) => [card.id, card]));
  const previousRank = previousRankByTeamId({ teamIds: teamCards.map((card) => card.id), matchups: matchupRows, medianByWeek });

  return standings.map((row, index) => {
    // `computeStandings` only ever produces a row for a teamId drawn from `teamCards.map(id)`
    // (`tallies`'s keys, above) — the exact same source `cardById`'s keys come from — so a
    // standings row's card is always found. No `?? ` fallback: one would read as a real
    // possibility a reader has to rule out by tracing two functions, when the single line above
    // already rules it out by construction.
    const card = cardById.get(row.teamId)!;
    return {
      ...row,
      teamName: card.name,
      ownerDisplayName: card.ownerDisplayName,
      ownerAvatar: card.ownerAvatarUrl,
      clinched: clinched.has(row.teamId),
      rank: index + 1,
      previousRank: previousRank.get(row.teamId) ?? null,
    };
  });
}
