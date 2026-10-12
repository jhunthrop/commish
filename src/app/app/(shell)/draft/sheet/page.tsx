import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import { getDb } from "@research/db/client";
import { players } from "@research/db/schema";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import { getSheet, listSheets } from "@/draft-hq/sheet/service";
import { boardOptionsFrom, sheetEntryViews } from "@/draft-hq/sheet/view";
import { sheetColumnsPayload } from "@/draft-hq/sheet/columns-payload";
import { byeStackWarning, mockHistoryInsights } from "@/draft-hq/sheet/insights";
import { sheetHealth } from "@/draft-hq/sheet/health";
import { canonicalSimFor } from "@/draft-hq/playbook/service";
import { MySheetClient } from "@/draft-hq/sheet/my-sheet-client";
import { basisSentence, boardOptionsFor, draftAreaContext } from "@/draft-hq/board/context";
import { draftDoorFor } from "@/draft-hq/league-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Draft");

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

/**
 * YOUR SHEET, the Draft area's second stop — the caller's own order over the same board the first
 * stop shows, edited in place and written straight to the server.
 *
 * IT READS THE SAME LEAGUE CONTEXT THE BOARD DOES (fix round 1, H3). It used to hard-wire the
 * league-free board while the Board stop defaulted to the caller's next-drafting league, so one
 * tap on the switch changed every number under an unchanged heading. `draftAreaContext` is the one
 * resolver and `?league=`/`?format=` ride the switch, so a stop change moves the view alone.
 *
 * Every mutation posts through `/api/draft/sheets/**` and then asks Next to refresh this server
 * render — one source of truth, never a client cache that could drift from what the room's own
 * sheet reads off the same store.
 */
export default async function MySheetPage({ searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const db = getDb();
  const params = await searchParams;
  const sheetParam = typeof params.sheet === "string" ? params.sheet : undefined;

  const [sheets, context] = await Promise.all([listSheets(db, user.id), draftAreaContext(db, user.id, params)]);
  const selectedId = sheetParam ?? sheets[0]?.id ?? null;
  const selected = selectedId === null ? null : await getSheet(db, user.id, selectedId);

  const [{ entries, board }, mockHistory, door] = await Promise.all([
    selected === null ? Promise.resolve({ entries: [], board: [] }) : sheetEntryViews(db, selected, boardOptionsFor(context)),
    mockHistoryInsights(db, user.id),
    draftDoorFor(db, user.id, context.selected?.leagueId),
  ]);
  const byeStack = entries.length === 0 ? null : await byeStackWarning(db, entries);

  // Sheet health needs a real canonical sim for this context's own league (or the generic default)
  // at a slot. No sheet carries a stored draft slot today, so this reads slot 1 — the identical,
  // documented default the playbook's own read falls back to — rather than inventing a per-sheet
  // slot concept this phase has no real data for.
  const canonicalSim = entries.length === 0 ? null : await canonicalSimFor(db, user.id, { leagueId: context.selected?.leagueId ?? null, shape: context.shape, slot: 1 });
  const health =
    canonicalSim === null || canonicalSim.outcome !== "ready"
      ? null
      : sheetHealth(
          entries.map((entry) => ({ playerId: entry.playerId, name: entry.name, position: entry.position, tag: entry.tag, boardRank: entry.boardRank })),
          canonicalSim.summary!,
          context.shape.teamCount,
        );

  const mostDraftedIds = mockHistory.mostDrafted.map((row) => row.playerId);
  const mostDraftedNames =
    mostDraftedIds.length === 0
      ? new Map<string, string>()
      : new Map((await db.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, mostDraftedIds))).map((row) => [row.id, row.name]));
  const mostDraftedWithNames = mockHistory.mostDrafted.map((row) => ({ ...row, name: mostDraftedNames.get(row.playerId) ?? "Unknown player" }));

  return (
    <div className="flex flex-col gap-4">
      <MySheetClient
        sheets={sheets}
        selectedSheetId={selected?.id ?? null}
        selectedSheetName={selected?.name ?? null}
        entries={entries}
        boardOptions={boardOptionsFrom(board)}
        columns={sheetColumnsPayload(entries, board)}
        basis={basisSentence(context, PRODUCT_SEASON)}
        headerQuery={context.query}
        scheduled={door}
        insights={{ mockHistory: { ...mockHistory, mostDrafted: mostDraftedWithNames }, byeStack, sheetHealth: health }}
      />
    </div>
  );
}
