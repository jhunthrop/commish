import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matchups } from "@/db/schema";
import type { TeamCard } from "@/domain/league";
import { clinchedTeamIds, computeStandings, LEAGUE_CONFIG, seasonProgress } from "@/league";
import type { TeamStandingsRow } from "@/league-room/contract";

/**
 * The standings table, with the display names, the owner's face, and the clinch flag the page
 * renders. `teamCards` is the SAME "team + owner's public profile" row set `leagueHome`
 * (`@/league-service/read.ts`) already reads via `listTeamCards` — passed in rather than
 * re-queried, so a page that already paid for that join does not pay for it twice.
 */
export async function leagueStandings(db: Db, leagueId: string, teamCards: readonly TeamCard[]): Promise<readonly TeamStandingsRow[]> {
  const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const standings = computeStandings({ teamIds: teamCards.map((card) => card.id), matchups: matchupRows });

  const { weeksRemaining } = seasonProgress(matchupRows, LEAGUE_CONFIG.regularSeasonWeeks);
  const clinched = new Set(clinchedTeamIds({ standings, weeksRemaining, playoffTeams: LEAGUE_CONFIG.playoffTeams }));
  const cardById = new Map(teamCards.map((card) => [card.id, card]));

  return standings.map((row) => {
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
    };
  });
}
