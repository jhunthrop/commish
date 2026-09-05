import type { Metadata } from "next";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { leagues, players } from "@/db/schema";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { getSheet, listSheets } from "@/draft-hq/sheet/service";
import { boardOptionsFrom, sheetEntryViews } from "@/draft-hq/sheet/view";
import { byeStackWarning, mockHistoryInsights } from "@/draft-hq/sheet/insights";
import { sheetHealth } from "@/draft-hq/sheet/health";
import { canonicalSimFor } from "@/draft-hq/playbook/service";
import { MySheetClient } from "@/draft-hq/sheet/my-sheet-client";
import { DraftSubnav } from "@/draft-hq/subnav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("My Sheet");

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

/** The sheet's own league shape, if it has one — the exact `{teamCount, rosterSlots}` pair a sim
 *  needs, resolved from `leagues` directly rather than through `league-context.ts` (which answers
 *  "which league is this ABOUT", a question a sheet's own `leagueId` has already settled). */
async function shapeFor(db: ReturnType<typeof getDb>, leagueId: string | null): Promise<{ readonly teamCount: number; readonly rosterSlots: readonly RosterSlotConfig[] }> {
  if (leagueId === null) return { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };
  const [league] = await db.select({ teamCount: leagues.teamCount, rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  return league === undefined ? { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } : league;
}

/**
 * MY SHEET (spec §4) — server-fetches the caller's sheets, the selected one's entries joined to
 * real player identity and the board's own rank, the insights rail's real inputs (including, as
 * of Task 5, sheet health against a real canonical sim), and hands all of it to the client half
 * for editing. Every mutation (reorder, notes, tags, remove, seed, CSV import, sheet management)
 * posts through `/api/draft/sheets/**` and then asks Next to refresh this server render — one
 * source of truth, never a client-only cache that could drift from what the room's own SHEET tab
 * reads.
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

  // Task 5's own unblocking: sheet health needs a real canonical sim for this sheet's own league
  // (or the generic default) at a slot. No sheet carries a stored draft slot today, so this reads
  // slot 1 — the identical, documented default the Playbook itself falls back to — rather than
  // inventing a per-sheet slot concept this phase has no real data for.
  const shape = await shapeFor(db, selected?.leagueId ?? null);
  const canonicalSim = entries.length === 0 ? null : await canonicalSimFor(db, user.id, { leagueId: selected?.leagueId ?? null, shape, slot: 1 });
  const health =
    canonicalSim === null || canonicalSim.outcome !== "ready"
      ? null
      : sheetHealth(
          entries.map((entry) => ({ playerId: entry.playerId, name: entry.name, position: entry.position, tag: entry.tag, boardRank: entry.boardRank })),
          canonicalSim.summary!,
          shape.teamCount,
        );

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
        insights={{ mockHistory: { ...mockHistory, mostDrafted: mostDraftedWithNames }, byeStack, sheetHealth: health }}
      />
    </div>
  );
}
