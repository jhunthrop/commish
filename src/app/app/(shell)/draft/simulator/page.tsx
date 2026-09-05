import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { Card, PageTitle, type SegmentOption } from "@/components/ui";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { totalRosterSlots } from "@/draft-engine";
import { LeaguePicker } from "@/draft-hq/league-picker";
import { myDraftLeagues, nextDraftingLeague, type DraftLeagueRow } from "@/draft-hq/league-context";
import { DraftSubnav } from "@/draft-hq/subnav";
import { SimulatorClient } from "@/draft-hq/simulator/simulator-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Simulator");

function leaguePickerOptions(leagues: readonly DraftLeagueRow[]): readonly SegmentOption[] {
  const options: SegmentOption[] = [];
  if (leagues.length > 0) options.push({ value: "next", label: "Next draft" });
  for (const league of leagues) options.push({ value: league.leagueId, label: league.leagueName });
  options.push({ value: "generic", label: "Generic (PPR, 12-team)" });
  return options;
}

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

/**
 * THE SIMULATOR (spec §5, marquee) — headless Monte Carlo over the real draft engine
 * (`@/draft-service/sim`), league context resolved server-side exactly like The Board
 * (`board/page.tsx`'s own pattern: a real navigation on league change, since it changes the
 * evidence pool and roster shape the sim runs against), the interactive config/results split off
 * into a client component so it can adopt TanStack Query (`DraftQueryProvider`, this segment's
 * own `layout.tsx`) for the run mutation and the pending-run poll.
 */
export default async function DraftSimulatorPage({ searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const db = getDb();
  const params = await searchParams;
  const leagueParam = typeof params.league === "string" ? params.league : undefined;

  const leagues = await myDraftLeagues(db, user.id);

  let selected: DraftLeagueRow | null = null;
  let isGeneric = leagueParam === "generic";
  if (!isGeneric) {
    if (leagueParam !== undefined) {
      selected = leagues.find((league) => league.leagueId === leagueParam) ?? null;
      if (selected === null) isGeneric = true;
    } else {
      selected = await nextDraftingLeague(db, user.id);
      if (selected === null) isGeneric = true;
    }
  }

  const shape = selected === null ? { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } : { teamCount: selected.teamCount, rosterSlots: selected.rosterSlots };

  return (
    <div className="flex flex-col gap-6">
      <DraftSubnav current="simulator" />
      <div className="flex flex-col gap-1">
        <PageTitle>Simulator</PageTitle>
        <p className="text-sm text-text-muted">Draft the room a thousand times before it counts once.</p>
      </div>

      <LeaguePicker
        options={leaguePickerOptions(leagues)}
        value={isGeneric ? "generic" : leagueParam !== undefined ? (selected?.leagueId ?? "next") : "next"}
        basePath="/app/draft/simulator"
      />

      {isGeneric ? (
        <Card className="text-sm text-text-muted">
          {"This sims the default room: PPR scoring, a 12-team standard roster. Pick a league above to sim it under that league's exact rules."}
        </Card>
      ) : selected !== null ? (
        <Card className="text-sm text-text-muted">{`Simming under ${selected.leagueName}'s rules: ${selected.teamCount} teams, its own roster shape.`}</Card>
      ) : null}

      <SimulatorClient
        leagueId={isGeneric ? null : (selected?.leagueId ?? null)}
        leagueLabel={isGeneric ? "Generic (PPR, 12-team)" : (selected?.leagueName ?? "Generic (PPR, 12-team)")}
        teamCount={shape.teamCount}
        rounds={totalRosterSlots(shape.rosterSlots)}
      />
    </div>
  );
}
