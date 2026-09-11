import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { drafts } from "@/db/schema";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PageTitle, type SelectOption } from "@/components/ui";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { registry } from "@/projections/laws/registry";
import { DEFAULT_BOARD_FORMAT, isBoardFormat, type BoardFormat } from "@/projections/preseason/board-formats";
import { boardRows, resolveBoardFormat } from "@/draft-hq/board/service";
import { BoardView } from "@/draft-hq/board/board-view";
import { BOARD_FORMAT_QUERY_KEY, ScoringFormatPicker } from "@/draft-hq/board/scoring-format-picker";
import { LeaguePicker } from "@/draft-hq/league-picker";
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
function leaguePickerOptions(leagues: readonly DraftLeagueRow[]): readonly SelectOption[] {
  const options: SelectOption[] = [];
  if (leagues.length > 0) options.push({ value: "next", label: "Next draft" });
  for (const league of leagues) options.push({ value: league.leagueId, label: league.leagueName });
  options.push({ value: "generic", label: "Generic (12-team)" });
  return options;
}

/** `?format=` on a league-free board: the named format, or the default with `explicit: false` so
 *  the picker may apply the browser's remembered choice. A value that is not one of the three
 *  reads as the default rather than a 404. */
function requestedFormat(params: Record<string, string | readonly string[] | undefined>): { readonly format: BoardFormat; readonly explicit: boolean } {
  const raw = params[BOARD_FORMAT_QUERY_KEY];
  if (typeof raw === "string" && isBoardFormat(raw)) return { format: raw, explicit: true };
  return { format: DEFAULT_BOARD_FORMAT, explicit: false };
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
 *
 * SCORING FORMAT IS A SERVER RE-RENDER TOO (`?format=`, the scoring-formats round, 2026-09-08),
 * and only on the league-free board: it changes WHICH stored board is read. Inside a league the
 * league's own rules decide and there is no selector; the basis card says which board and why.
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

  const requested = requestedFormat(params);
  const boardOptions = { leagueId: selected?.leagueId, format: isGeneric ? requested.format : undefined };
  const [rows, resolved, auctionBudget] = await Promise.all([
    // `leagueId` decides the board and the LAST SEASON column's rules; the generic board reads the
    // format the selector names, exactly as its own basis card says.
    boardRows(db, { shape, ...boardOptions }),
    resolveBoardFormat(db, boardOptions),
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
      <PageTitle>The Board</PageTitle>

      {/* THE CONTEXT, IN ONE BAR (Sideline research round). The league and the scoring are the two
          things that decide what every number below means, so they sit on one line with the basis
          stated under them in the same breath — not in a card of their own, which on a phone put
          three bands of chrome between the reader and the first player row. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-4">
          <LeaguePicker options={leaguePickerOptions(leagues)} value={isGeneric ? "generic" : leagueParam !== undefined ? (selected?.leagueId ?? "next") : "next"} basePath="/app/draft/board" />
          {isGeneric ? <ScoringFormatPicker value={requested.format} explicit={requested.explicit} basePath="/app/draft/board" extraQuery={{ league: "generic" }} /> : null}
        </div>
        {/* THE BASIS, IN ONE LINE. It states what rules produced every number below (P11) and
            nothing else: the sentence that used to follow it ("Pick a league above to see it
            computed under that league's exact rules") explained the control an inch to its left,
            which is exactly the explainer text P7 rules out. The control says it by being there. */}
        {/* One line, or no line at all. An empty paragraph is furniture with nothing inside it, and
            this one used to render for a reader whose league we could not name (fix round 1, LOW). */}
        {isGeneric ? (
          <p className="text-sm text-text-muted">{`${resolved.basisLine}, a 12-team standard roster.`}</p>
        ) : selected === null ? null : (
          <p className="text-sm text-text-muted">
            {`Under ${selected.leagueName}'s rules: ${selected.teamCount} teams, its own roster shape. ${resolved.basisLine}.${resolved.note === null ? "" : ` ${resolved.note}`}`}
          </p>
        )}
      </div>

      <BoardView
        rows={rows}
        laws={laws}
        auctionShape={auctionShape}
        scoringLabel={resolved.label}
        openOn={typeof params.q === "string" ? params.q : ""}
        exportFilename={`board-${selected?.leagueId ?? `generic-${resolved.format}`}.csv`}
      />
    </div>
  );
}
