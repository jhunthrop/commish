import { getDb } from "@research-ts/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { duplicateSheet } from "@/draft-hq/sheet/service";
import { duplicateSheetSchema } from "@/draft-hq/sheet/schemas";
import type { Sheet } from "@/draft-hq/sheet/types";
import { withCurrentUser, type SheetRouteContext } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A full copy of one of the caller's own sheets: fresh id, same league scope, same entries. */
export async function POST(request: Request, context: SheetRouteContext) {
  return withCurrentUser(request, async (userId, req) => {
    const { sheetId } = await context.params;
    const parsed = await parseJson(req, duplicateSheetSchema);
    if (!parsed.ok) return parsed.response;
    const sheet = await duplicateSheet(getDb(), userId, sheetId, parsed.value.name);
    if (sheet === null) return fail("That sheet does not exist.", 404);
    return ok<Sheet>(sheet);
  });
}
