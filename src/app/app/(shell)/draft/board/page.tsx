import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { drafts } from "@/db/schema";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { Card, PageTitle, type SegmentOption } from "@/components/ui";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { registry } from "@/projections/laws/registry";
import { boardRows } from "@/draft-hq/board/service";
import { BoardView } from "@/draft-hq/board/board-view";
import { LeaguePicker } from "@/draft-hq/board/league-picker";
import { myDraftLeagues, nextDraftingLeague, type DraftLeagueRow } from "@/draft-hq/league-context";
import { DraftSubnav } from "@/draft-hq/subnav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("The Board");

const GENERIC_BUDGET = 200;

function rosterSpotsOf(rosterSlots: readonly RosterSlotConfig[]): number {
  return rosterSlots.reduce((sum, slot) => sum + slot.count, 0);
}

/** The picker's own options: one per real league the caller drafts in, plus the explicit
 *  "generic" default-settings board. `"next"` (the default when no `?league=` is given) is its
 *  own value only when the caller HAS an upcoming draft to default to. */
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
 * THE BOARD (spec §3) — league context picker (defaulting to the caller's next-drafting real
 * league; "generic" is the explicit default-settings option with its own banner), the evidence
 * table, tier bands, the evidence drawer, CSV export and the auction $ toggle.
 *
 * LEAGUE SELECTION IS A SERVER RE-RENDER (a plain link to `?league=`), because it changes the
 * RECOMPUTED value-over-replacement/tier numbers (`boardRows`'s own docblock) — position tabs,
 * search, the rookie filter and the $ toggle are client state over rows already in hand
 * (`BoardView`), since none of them change what was computed, only what is shown.
 */
export default async function BoardPage({ searchParams }: PageProps) {
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
      if (selected === null) isGeneric = true; // an unknown/stale id degrades to the honest generic default rather than a 404
    } else {
      selected = await nextDraftingLeague(db, user.id);
      if (selected === null) isGeneric = true;
    }
  }

  const shape = selected === null ? { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } : { teamCount: selected.teamCount, rosterSlots: selected.rosterSlots };

  const [rows, auctionBudget] = await Promise.all([
    boardRows(db, { shape }),
    selected === null
      ? Promise.resolve(null)
      : db
          .select({ auctionBudget: drafts.auctionBudget, format: drafts.format })
          .from(drafts)
          .where(eq(drafts.leagueId, selected.leagueId))
          .then((found) => found[0] ?? null),
  ]);

  const auctionShape = {
    teamCount: shape.teamCount,
    rosterSpots: rosterSpotsOf(shape.rosterSlots),
    budget: auctionBudget?.auctionBudget ?? GENERIC_BUDGET,
  };

  const laws = registry();

  return (
    <div className="flex flex-col gap-6">
      <DraftSubnav current="board" />
      <div className="flex flex-col gap-1">
        <PageTitle>The Board</PageTitle>
        <p className="text-sm text-text-muted">Rankings measured from evidence, not averaged from experts. Every row shows its receipts.</p>
      </div>

      <LeaguePicker options={leaguePickerOptions(leagues)} value={isGeneric ? "generic" : leagueParam !== undefined ? (selected?.leagueId ?? "next") : "next"} />

      {isGeneric ? (
        <Card className="text-sm text-text-muted">
          {"This is the default board: PPR scoring, a 12-team standard roster. Pick a league above to see it computed under that league's exact rules."}
        </Card>
      ) : selected !== null ? (
        <Card className="text-sm text-text-muted">
          {`Computed under ${selected.leagueName}'s rules: ${selected.teamCount} teams, its own roster shape.`}
        </Card>
      ) : null}

      <BoardView rows={rows} laws={laws} auctionShape={auctionShape} exportFilename={`board-${selected?.leagueId ?? "generic"}.csv`} />
    </div>
  );
}
