import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { deleteSheet, getSheet, renameSheet } from "@/draft-hq/sheet/service";
import { renameSheetSchema } from "@/draft-hq/sheet/schemas";
import type { Sheet, SheetWithEntries } from "@/draft-hq/sheet/types";
import { assertLeagueAccessible, withCurrentUser, type SheetRouteContext } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One sheet with every entry, in rank order. 404 for a sheet that does not exist OR belongs to
 *  somebody else — the one non-oracle answer for both (`getSheet`'s own docblock). */
export async function GET(request: Request, context: SheetRouteContext) {
  return withCurrentUser(request, async (userId) => {
    const { sheetId } = await context.params;
    const sheet = await getSheet(getDb(), userId, sheetId);
    if (sheet === null) return fail("That sheet does not exist.", 404);
    const refused = await assertLeagueAccessible(userId, sheet.leagueId);
    if (refused !== null) return refused;
    return ok<SheetWithEntries>(sheet);
  });
}

export async function PATCH(request: Request, context: SheetRouteContext) {
  return withCurrentUser(request, async (userId, req) => {
    const { sheetId } = await context.params;
    const parsed = await parseJson(req, renameSheetSchema);
    if (!parsed.ok) return parsed.response;
    const sheet = await renameSheet(getDb(), userId, sheetId, parsed.value.name);
    if (sheet === null) return fail("That sheet does not exist.", 404);
    return ok<Sheet>(sheet);
  });
}

export async function DELETE(request: Request, context: SheetRouteContext) {
  return withCurrentUser(request, async (userId) => {
    const { sheetId } = await context.params;
    const removed = await deleteSheet(getDb(), userId, sheetId);
    if (!removed) return fail("That sheet does not exist.", 404);
    return ok<{ readonly deleted: true }>({ deleted: true });
  });
}
