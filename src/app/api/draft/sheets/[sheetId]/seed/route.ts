import { eq } from "drizzle-orm";
import { getDb } from "@research/db/client";
import { leagues } from "@/db/schema";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { STANDARD_ROSTER_SLOTS } from "@research/domain/roster";
import { boardRows } from "@research/board/service";
import { getSheet, replaceEntries } from "@/draft-hq/sheet/service";
import { seedFromBoard, seedFromMockHistory } from "@/draft-hq/sheet/seed";
import { seedSheetSchema } from "@/draft-hq/sheet/schemas";
import type { SheetWithEntries } from "@/draft-hq/sheet/types";
import { withCurrentUser, type SheetRouteContext } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SEED_LIMIT = 200;

/**
 * Replaces a sheet's whole order from one of two real sources (spec §4): the evidence board
 * (under the SHEET'S OWN league shape when it is league-scoped, the generic default otherwise),
 * or the caller's own mock history via the existing `sheet-seed` logic (`@/draft-room/quilt`).
 * A sheet with no mock history to seed from answers 422 naming the honest reason, rather than
 * silently seeding nothing.
 */
export async function POST(request: Request, context: SheetRouteContext) {
  return withCurrentUser(request, async (userId, req) => {
    const { sheetId } = await context.params;
    const parsed = await parseJson(req, seedSheetSchema);
    if (!parsed.ok) return parsed.response;

    const db = getDb();
    const sheet = await getSheet(db, userId, sheetId);
    if (sheet === null) return fail("That sheet does not exist.", 404);

    if (parsed.value.source === "mocks") {
      const seeded = await seedFromMockHistory(db, userId);
      if (seeded === null) return fail("You have no completed mock draft yet to seed a sheet from.", 422);
      const result = await replaceEntries(db, userId, sheetId, seeded);
      return ok<SheetWithEntries>(result!);
    }

    const limit = parsed.value.limit ?? DEFAULT_SEED_LIMIT;

    if (sheet.leagueId === null) {
      const entries = await seedFromBoard(db, limit);
      const result = await replaceEntries(db, userId, sheetId, entries);
      return ok<SheetWithEntries>(result!);
    }

    const [leagueRow] = await db.select({ teamCount: leagues.teamCount, rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, sheet.leagueId));
    const shape = leagueRow ?? { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };
    const rows = await boardRows(db, { shape });
    const entries = rows.slice(0, limit).map((row) => ({ playerId: row.playerId }));
    const result = await replaceEntries(db, userId, sheetId, entries);
    return ok<SheetWithEntries>(result!);
  });
}
