import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { players } from "@/db/schema";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { getSheet, listSheets } from "@/draft-hq/sheet/service";
import { boardOptionsFrom, sheetEntryViews } from "@/draft-hq/sheet/view";
import { byeStackWarning, mockHistoryInsights } from "@/draft-hq/sheet/insights";
import { MySheetClient } from "@/draft-hq/sheet/my-sheet-client";
import { DraftSubnav } from "@/draft-hq/subnav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("My Sheet");

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

/**
 * MY SHEET (spec §4) — server-fetches the caller's sheets, the selected one's entries joined to
 * real player identity and the board's own rank, the insights rail's two real inputs, and hands
 * all of it to the client half for editing. Every mutation (reorder, notes, tags, remove, seed,
 * CSV import, sheet management) posts through `/api/draft/sheets/**` and then asks Next to
 * refresh this server render — one source of truth, never a client-only cache that could drift
 * from what the room's own SHEET tab reads.
 */
export default async function MySheetPage({ searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const db = getDb();
  const params = await searchParams;
  const sheetParam = typeof params.sheet === "string" ? params.sheet : undefined;

  const sheets = await listSheets(db, user.id);
  const selectedId = sheetParam ?? sheets[0]?.id ?? null;
  const selected = selectedId === null ? null : await getSheet(db, user.id, selectedId);

  const [{ entries, board }, mockHistory] = await Promise.all([
    selected === null ? Promise.resolve({ entries: [], board: [] }) : sheetEntryViews(db, selected, null),
    mockHistoryInsights(db, user.id),
  ]);
  const byeStack = entries.length === 0 ? null : await byeStackWarning(db, entries);

  const mostDraftedIds = mockHistory.mostDrafted.map((row) => row.playerId);
  const mostDraftedNames =
    mostDraftedIds.length === 0
      ? new Map<string, string>()
      : new Map((await db.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, mostDraftedIds))).map((row) => [row.id, row.name]));
  const mostDraftedWithNames = mockHistory.mostDrafted.map((row) => ({ ...row, name: mostDraftedNames.get(row.playerId) ?? "Unknown player" }));

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <DraftSubnav current="sheet" />
      </div>
      <MySheetClient
        sheets={sheets}
        selectedSheetId={selected?.id ?? null}
        selectedSheetName={selected?.name ?? null}
        entries={entries}
        boardOptions={boardOptionsFrom(board)}
        insights={{ mockHistory: { ...mockHistory, mostDrafted: mostDraftedWithNames }, byeStack }}
      />
    </div>
  );
}
