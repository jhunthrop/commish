import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import Link from "next/link";
import { Card, EdgeCell, PlayerObject, SourceStrip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { parseSeasonParam, playerSeason, type PlayerSeasonBody } from "@/league-service/player";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PlayerPageSeasonSwitcher } from "@/league-room/components/season-switcher";
import { BooksModule } from "@/league-room/dossier/books-module";
import { CallCard } from "@/league-room/dossier/call-card";
import { NewsList } from "@/league-room/dossier/news-list";
import { RangeRail } from "@/league-room/dossier/range-rail";
import { ReadCard } from "@/league-room/dossier/read-card";
import { RoleModule } from "@/league-room/dossier/role-module";
import { SeasonChartFallback } from "@/league-room/dossier/season-chart-fallback";
import { SeasonStrip } from "@/league-room/dossier/season-strip";
import { SeasonTotalsAndLog } from "@/league-room/dossier/season-totals-and-log";
import { StoryModule } from "@/league-room/dossier/story-module";
import { WhyGroups } from "@/league-room/dossier/why-groups";
import { Outlook } from "@/league-room/outlook/outlook";
import { callCardPropsFor, hasReadCardFor, hasStoryCellFor, sourcesFor, weeksFor } from "@/league-room/lib/player-season-view";

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
  const hasReadCard = hasReadCardFor(body);
  const hasStoryCell = hasStoryCellFor(body);

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

        {dossier === null ? (
          <>
            {/* TODAY'S LAYOUT, UNCHANGED — the binding fallback (Task 5's own rule, kept for the
                full page too): a player without board facts still gets the source strip, the
                market edge, the uncapped Outlook (verdict and capsule included), and his season. */}
            <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
              <SourceStrip label={`Where ${body.player.name} is ranked, by source`} sources={sourcesFor(body)} />
              <Edge body={body} />
            </div>
            <Outlook reasons={body.reasons} laws={body.laws} position={body.player.position} capsule={body.capsule} />
            <SeasonChartFallback body={body} switcher={switcher} played={played} />
          </>
        ) : (
          <>
            {/* THE CALL, FIRST — the identical adapter the peek uses (`callCardPropsFor`,
                `league-room/lib/player-season-view.ts`). */}
            <CallCard {...callCardPropsFor(body, dossier)} />

            {/* THREE SEPARATE ROW GRIDS (the peek's own review fix, kept identical here): a
                missing member (most commonly `ReadCard`, absent until the capsule sweep reaches
                him) spans its own row's full width rather than cascading later pairs out of
                place. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <RangeRail projection={dossier.projection} availability={dossier.availability} />
              <RoleModule position={body.player.position} usage={dossier.usage} trend={dossier.trend} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* The FULL Read, not the peek's compact one — `bodyFull`, honestly falling back to
                  `bodyCompact` for a `"template"`-sourced capsule (`read-card.tsx`'s own docblock
                  states why). */}
              <ReadCard capsule={body.capsule} variant="full" />
              <div className={hasReadCard ? undefined : "lg:col-span-2"}>
                <BooksModule books={dossier.books} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={hasStoryCell ? undefined : "lg:col-span-2"}>
                {dossier.lastSeasonStory === null ? (
                  <SeasonChartFallback body={body} switcher={switcher} played={played} />
                ) : (
                  <SeasonStrip story={dossier.lastSeasonStory} weeks={weeksFor(body)} scoringLabel={dossier.basis.scoringLabel} switcher={switcher} />
                )}
              </div>
              {!hasStoryCell ? null : (
                <div className="flex flex-col gap-4">
                  {/* The season-ending story service wiring converges post-merge (ruling R-d1) —
                      `story` stays `null` here for now, so this renders only the current
                      designation pill, or nothing, honestly. */}
                  <StoryModule story={null} designation={body.injuryDesignation} />
                  <NewsList news={body.news} />
                </div>
              )}
            </div>

            {/* THE WHY, UNCAPPED — every group, no "The full case" expander (unlike the peek's
                own `cap={5}`). */}
            <WhyGroups reasons={body.reasons} laws={body.laws} position={body.player.position} />
          </>
        )}

        <SeasonTotalsAndLog body={body} />
        {dossier === null ? <NewsList news={body.news} /> : null}
      </Card>
    </div>
  );
}

/**
 * LAW 1, AND THE ONE FIGURE ON THIS PAGE THAT EARNS CHROMA — *"every number is a delta, not a
 * fact"*. Market rank, expert rank and our own rank all sit quiet and grey in the strip beside
 * this; the disagreement BETWEEN two of them is the only comparison on the screen, so it is the
 * only thing with colour on it.
 *
 * WHICH TWO, AND WHY IT IS NOT OURS. The delta this product exists to sell is our board against
 * the room, and our board holds no rank for the season in progress (`PlayerSeasonBody` carries the
 * full account). Law 7 forbids drawing that one, so the honest delta available today is the one
 * between the two sources that ARE here: what the drafting public did, and what the experts said.
 * `EdgeCell` renders a `null` gap as an untinted dash, so a player either side is missing simply
 * shows the absence — which is the same seam our own rank lands in the day the engine emits one.
 *
 * THE SIGN IS FROM THE EXPERTS' SEAT, and it has to be stated because ranks invert: a LOWER number
 * is a better player. `market - experts` is positive when the market lets him fall past where the
 * experts have him, which is the experts rating him HIGHER — exactly what `EdgeCell`'s positive
 * direction means, with the counterparty named in words rather than implied by the sign.
 */
function Edge({ body }: { readonly body: PlayerSeasonBody }) {
  const { adp } = body.player;
  const gap = adp === null || body.expertRank === null ? null : adp - body.expertRank;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`${MICRO_LABEL} text-text-faint`}>Experts vs market</span>
      <EdgeCell gap={gap} against="the draft market" />
    </div>
  );
}
