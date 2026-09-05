import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import Link from "next/link";
import { Card, EdgeCell, PlayerObject, SeasonBars, SourceStrip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { parseSeasonParam, playerSeason, type PlayerSeasonBody } from "@/league-service/player";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PlayerPageSeasonSwitcher } from "@/league-room/components/season-switcher";
import { Outlook } from "@/league-room/outlook/outlook";
import { sourcesFor, weeksFor } from "@/league-room/lib/player-season-view";

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
 * THE OBJECT, THE STRIP, THE SEASON — AND THE OUTLOOK (widened 2026-09-04; this page carried only
 * the first three until the founder's Outlook redesign gave the full page the same evidence
 * section the bottom-sheet peek already had, in the SAME component (`league-room/outlook/
 * outlook.tsx`) so the two surfaces can never drift apart on grouping or wording).
 *
 * THE ONE DELIBERATE SENTENCE ON THIS PAGE is the Outlook's own verdict line
 * (`outlook/verdict.ts`) — every other rule below about "no prose" still governs the object, the
 * strip and the season chart exactly as it always has. The reference product the founder named
 * reads SIMPLE while being denser than us, and the reason is exactly this: its player panel wastes
 * no element on an explanatory sentence. The chips carry the facts we would otherwise write out,
 * the source names are their own legend, and the week numbers are their own axis. The Outlook's
 * verdict is not an explanation of another element — it IS the evidence, stated as a conclusion
 * rather than left for a reader to add up himself, which is what a diagnostic engine's own
 * "product and diagnostics are the same artifact" principle has always meant for this section
 * (`reason-chip.tsx`'s own docblock). Everything a screen reader needs is on the elements
 * themselves.
 *
 * THE ONE NEW LABEL (2026-09-04 widening) is the season itself. `playerSeason` can now answer for a
 * season other than the one a manager assumes he opened — a card viewed in August, before this
 * year's first snap, defaults to LAST year's real season — and silence about which year the numbers
 * below it belong to would read as a bug, not as simplicity. The label is a fact stamp in the same
 * micro-label register `Edge`'s "Experts vs market" already uses, never a sentence explaining
 * anything; the switcher beside it (when there is more than one season to choose from) is the same
 * segmented rail every other "pick one of a few" surface in this product uses, and needs no caption
 * of its own — the years printed on it are the caption.
 *
 * WHY THE PAGE IS UNDER A LEAGUE. A fantasy point is not a property of a player, it is a property
 * of a player inside a rule set — see `playerSeason`. There is no honest league-free version of
 * this screen, so there is no league-free route to it.
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
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <SourceStrip label={`Where ${body.player.name} is ranked, by source`} sources={sourcesFor(body)} />
          <Edge body={body} />
        </div>

        <Outlook reasons={body.reasons} laws={body.laws} position={body.player.position} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`${MICRO_LABEL} text-text-faint`}>{body.season} season</span>
          {body.availableSeasons.length > 1 ? (
            <PlayerPageSeasonSwitcher leagueId={leagueId} playerId={playerId} seasons={body.availableSeasons} season={body.season} />
          ) : null}
        </div>

        {body.isRookie ? (
          // A CONFIRMED rookie (`isRookie`, never inferred from `availableSeasons` alone — see
          // `PlayerSeasonBody`'s own docblock): nothing anywhere to chart, so one honest sentence
          // stands in for it, the same "state the absence, draw no chart" discipline LAW 7 already
          // established below.
          <p className="text-sm text-text-muted">His first NFL season.</p>
        ) : body.availableSeasons.length === 0 ? (
          // THE THIRD STATE (fix round 1, CRITICAL): not a confirmed rookie, and no season on
          // record either — a crosswalk miss, or a placed veteran the store has no weeks for.
          // This sentence claims only what is known; it must never be the rookie one, which would
          // assert a biography fact this state is defined by not having.
          <p className="text-sm text-text-muted">No prior seasons on record.</p>
        ) : played ? (
          <SeasonBars label={`${body.player.name}, points by week`} weeks={weeksFor(body)} />
        ) : (
          // LAW 7. `SeasonBars` draws nothing at all for a season with no points in it, which is
          // right — thirteen empty columns under thirteen week numbers read as a rendering fault
          // rather than as an absence — but a card that then just ends leaves the reader to guess
          // whether the chart failed. One line, stating the absence, and no chart.
          <p className="text-sm text-text-muted">No scored week for him in the {body.season} season.</p>
        )}
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
