import { z } from "zod";
import { getDb } from "@research/db/client";
import { fail, ok, parseJson, parseQuery } from "@/lib/api/respond";
import { removeEntry, reorderEntries, upsertEntry } from "@/draft-hq/sheet/service";
import { reorderSchema, upsertEntrySchema } from "@/draft-hq/sheet/schemas";
import type { SheetWithEntries } from "@/draft-hq/sheet/types";
import { withCurrentUser, type SheetRouteContext } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const removeQuerySchema = z.object({ playerId: z.string().min(1) });

/** Adds one player at the bottom of the sheet, or edits his tier/note/tag if he is already on
 *  it — "Add to my sheet" (spec §3) and the room's per-pick edits both land here. */
export async function POST(request: Request, context: SheetRouteContext) {
  return withCurrentUser(request, async (userId, req) => {
    const { sheetId } = await context.params;
    const parsed = await parseJson(req, upsertEntrySchema);
    if (!parsed.ok) return parsed.response;
    const { playerId, ...patch } = parsed.value;
    const sheet = await upsertEntry(getDb(), userId, sheetId, playerId, patch);
    if (sheet === null) return fail("That sheet does not exist.", 404);
    return ok<SheetWithEntries>(sheet);
  });
}

/** Re-ranks the sheet to a new player-id order — the drag/keyboard reorder's own write. */
export async function PUT(request: Request, context: SheetRouteContext) {
  return withCurrentUser(request, async (userId, req) => {
    const { sheetId } = await context.params;
    const parsed = await parseJson(req, reorderSchema);
    if (!parsed.ok) return parsed.response;
    const sheet = await reorderEntries(getDb(), userId, sheetId, parsed.value.order);
    if (sheet === null) return fail("That sheet does not exist.", 404);
    return ok<SheetWithEntries>(sheet);
  });
}

/** Drops one player from the sheet: `DELETE .../entries?playerId=…`. */
export async function DELETE(request: Request, context: SheetRouteContext) {
  return withCurrentUser(request, async (userId) => {
    const { sheetId } = await context.params;
    const url = new URL(request.url);
    const parsedQuery = parseQuery({ playerId: url.searchParams.get("playerId") ?? undefined }, removeQuerySchema);
    if (!parsedQuery.ok) return parsedQuery.response;
    const sheet = await removeEntry(getDb(), userId, sheetId, parsedQuery.value.playerId);
    if (sheet === null) return fail("That sheet does not exist.", 404);
    return ok<SheetWithEntries>(sheet);
  });
}
