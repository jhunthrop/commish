import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { replaceEntries } from "@/draft-hq/sheet/service";
import { replaceEntriesSchema } from "@/draft-hq/sheet/schemas";
import type { SheetWithEntries } from "@/draft-hq/sheet/types";
import { withCurrentUser, type SheetRouteContext } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replaces a sheet's entire entry list, in the order given — CSV import and a "seed/re-seed"
 *  verb both post here with the proposed rows once the caller has seen and accepted them. */
export async function PUT(request: Request, context: SheetRouteContext) {
  return withCurrentUser(request, async (userId, req) => {
    const { sheetId } = await context.params;
    const parsed = await parseJson(req, replaceEntriesSchema);
    if (!parsed.ok) return parsed.response;
    const sheet = await replaceEntries(getDb(), userId, sheetId, parsed.value.entries);
    if (sheet === null) return fail("That sheet does not exist.", 404);
    return ok<SheetWithEntries>(sheet);
  });
}
