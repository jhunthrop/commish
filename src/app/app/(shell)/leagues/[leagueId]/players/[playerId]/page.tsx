import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import Link from "next/link";
import { Card, PlayerObject } from "@/components/ui";
import { parseSeasonParam, playerSeason } from "@/league-service/player";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PlayerPageSeasonSwitcher } from "@/league-room/components/season-switcher";
import { DossierComposition } from "@/league-room/dossier/dossier-composition";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string; readonly playerId: string }>;
  readonly searchParams: Promise<{ readonly season?: string }>;
}

/** An honest static title rather than a database read that exists only to name a browser tab —
 *  `pageTitle`'s own ruling (flow analysis A5). */
export function generateMetadata(): Metadata {
  return pageTitle("Player");
}

/**
 * THE FULL PAGE, UNCAPPED (Player Dossier plan, Task 6) — the identical dossier composition the
 * bottom-sheet peek renders (`player-peek.tsx`), at its uncapped depth: the full `ReadCard` (its
 * own `bodyFull`, honestly falling back to `bodyCompact` for a `"template"`-sourced capsule — see
 * `read-card.tsx`'s own docblock), `WhyGroups` with no `cap` at all (every group, no expander),
 * and the complete game log (this page never had one before this task — `SeasonTotalsAndLog` is
 * new here). `body.dossier` absent — `null` or `undefined` alike — falls back to the page's own
 * pre-dossier composition (`SourceStrip` + `Edge` + the uncapped `Outlook`, unchanged), the same
 * binding fallback Task 5 established for the peek.
 *
 * THE BOTH-BASES LAW (Global Constraints: the 12.0-vs-14.28 defect — two scoring bases shown side
 * by side with neither labeled). This page shows numbers under TWO different rule sets at once
 * when a dossier exists: the dossier's own facts (the board's standard PPR, named by
 * `dossier.basis.scoringLabel` wherever a dossier module states a per-game rate — `SeasonStrip`'s
 * own "a game" fact, for one) and this LEAGUE's own scoring (`body.totals`/`body.log`/
 * `body.pointsPerGame`, always true for this page — see `playerSeason`'s own docblock).
 * `SeasonTotalsAndLog` now names its own basis directly on both of its headers
 * ("under this league's scoring"); nothing on this page states a number without naming which of
 * the two rule sets produced it.
 *
 * FIX ROUND 1, IMPORTANT 4 — this page's own ~45-line composition (call card through `WhyGroups`,
 * plus the fallback and the season totals/log) used to be byte-identical to the peek's own copy of
 * the same block. Both now render `DossierComposition` (`league-room/dossier/dossier-
 * composition.tsx`), passed `depth="full"` for the two things that differ (no cap on `Outlook`,
 * `Edge` alongside the source strip in the fallback), `readVariant="full"` and no `whyCap`.
 */
export default async function PlayerPage({ params, searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const { leagueId, playerId } = await params;
  const { season: rawSeason } = await searchParams;
  const season = parseSeasonParam(rawSeason);

  // The cheap, canonical gate — a team in this league or its commissioner. A non-member gets the
  // same 404 the matchup page gives them, never a "you are not allowed" page that confirms the
  // league exists.
  const membership = await resolveLeagueMembership(getDb(), leagueId, user.id);
  if (!membership.ok) notFound();

  const body = await playerSeason(getDb(), leagueId, playerId, undefined, season);
  if (body === null) notFound();

  const played = body.weeks.some((week) => week.points !== null);
  // Player Dossier plan, Task 5/6 — `undefined` (a fixture predating the dossier) and `null` (the
  // board never ranked him) are the SAME "nothing to build the dossier composition from" state.
  const dossier = body.dossier ?? null;
  const switcher = body.availableSeasons.length > 1 ? <PlayerPageSeasonSwitcher leagueId={leagueId} playerId={playerId} seasons={body.availableSeasons} season={body.season} /> : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* The way back. A player screen is reached from a lineup, a roster or a trade, and until
          now the only route off it was the rail. Quiet, because a way out is never the loud
          action however loud the verb beside it (law 5's surviving discipline). */}
      <Link href={`/app/leagues/${leagueId}`} className="text-sm text-accent underline">
        Back to the league
      </Link>

      <Card as="section" className="flex flex-col gap-6">
        <PlayerObject player={body.player} />

        <DossierComposition body={body} dossier={dossier} depth="full" switcher={switcher} played={played} readVariant="full" />
      </Card>
    </div>
  );
}
