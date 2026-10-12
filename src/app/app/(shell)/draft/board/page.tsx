import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@research-ts/db/client";
import { drafts } from "@/db/schema";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import type { SelectOption } from "@/components/ui";
import type { RosterSlotConfig } from "@research-ts/domain/roster";
import { registry } from "@research-ts/projections/laws/registry";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { boardRows } from "@research-ts/board/service";
import { BoardView } from "@/draft-hq/board/board-view";
import { basisSentence, boardOptionsFor, draftAreaContext } from "@/draft-hq/board/context";
import { ScoringFormatPicker } from "@/draft-hq/board/scoring-format-picker";
import { LeaguePicker } from "@/draft-hq/league-picker";
import { draftDoorFor, type DraftLeagueRow } from "@/draft-hq/league-context";
import { DraftHeader } from "@/draft-hq/draft-header";
import { ScheduledLine } from "@/draft-hq/scheduled-line";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Draft");

const GENERIC_BUDGET = 200;

function rosterSpotsOf(rosterSlots: readonly RosterSlotConfig[]): number {
  return rosterSlots.reduce((sum, slot) => sum + slot.count, 0);
}

/** The picker's own options: one per real league the caller drafts in, plus the explicit
 *  "generic" default-settings board. `"next"` (the default when no `?league=` is given) is its
 *  own value only when the caller HAS an upcoming draft to default to. */
function leaguePickerOptions(leagues: readonly DraftLeagueRow[]): readonly SelectOption[] {
  const options: SelectOption[] = [];
  if (leagues.length > 0) options.push({ value: "next", label: "Next draft" });
  for (const league of leagues) options.push({ value: league.leagueId, label: league.leagueName });
  options.push({ value: "generic", label: "Generic (12-team)" });
  return options;
}

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

/**
 * THE BOARD, the Draft area's first stop — the league and scoring context, the evidence table,
 * tier bands on every tab, the evidence drawer, CSV export and the auction $ toggle.
 *
 * LEAGUE AND SCORING ARE SERVER RE-RENDERS (plain links to `?league=`/`?format=`), because they
 * change the RECOMPUTED value-over-replacement and tier numbers — position tabs, search, the
 * rookie filter and the $ toggle are client state over rows already in hand (`BoardView`), since
 * none of them change what was computed, only what is shown.
 *
 * WHOSE RULES IS RESOLVED ONCE, for this stop and for Your sheet (`draftAreaContext`), so the two
 * stops under one heading can never print two different numbers for the same player.
 */
export default async function BoardPage({ searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const db = getDb();
  const params = await searchParams;

  const context = await draftAreaContext(db, user.id, params);
  const [rows, door, auctionBudget] = await Promise.all([
    boardRows(db, boardOptionsFor(context)),
    draftDoorFor(db, user.id, context.selected?.leagueId),
    context.selected === null
      ? Promise.resolve(null)
      : db
          .select({ auctionBudget: drafts.auctionBudget, format: drafts.format })
          .from(drafts)
          .where(eq(drafts.leagueId, context.selected.leagueId))
          .then((found) => found[0] ?? null),
  ]);

  const auctionShape = {
    teamCount: context.shape.teamCount,
    rosterSpots: rosterSpotsOf(context.shape.rosterSlots),
    budget: auctionBudget?.auctionBudget ?? GENERIC_BUDGET,
  };

  // THE CONTEXT CONTROLS RIDE THE FILTER BAR (the Draft area round): the league and the scoring
  // decide what every number below means, so they sweep with the position tabs rather than
  // standing on a row of their own above them. Both are server navigations, which is why the page
  // builds them and the client view only places them.
  const contextControls = (
    <>
      <LeaguePicker options={leaguePickerOptions(context.leagues)} value={context.pickerValue} basePath="/app/draft/board" />
      {context.isGeneric ? (
        <div className="shrink-0 pb-2">
          <ScoringFormatPicker value={context.format} explicit={context.explicitFormat} basePath="/app/draft/board" extraQuery={{ league: "generic" }} />
        </div>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <DraftHeader stop="board" query={context.query} />
      <ScheduledLine draft={door} />

      <BoardView
        rows={rows}
        laws={registry()}
        auctionShape={auctionShape}
        context={contextControls}
        scoringLabel={context.resolved.label}
        openOn={typeof params.q === "string" ? params.q : ""}
        exportFilename={`board-${context.selected?.leagueId ?? `generic-${context.resolved.format}`}.csv`}
        basis={basisSentence(context, PRODUCT_SEASON)}
      />
    </div>
  );
}
