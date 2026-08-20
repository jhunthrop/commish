import { getDb } from "@/db/client";
import type { PreferenceState } from "@/identity";
import { updatePreferences, type UpdatePreferencesParams } from "@/identity-service/preferences";
import { updatePreferencesSchema } from "@/identity-service/schemas";
import { ok, parseJson } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Writes the caller's own preferences: a help level and/or the draft-room tour's dismissal.
 * The draft-room tour (`RoomTour`) is this route's one caller today — the write is
 * fire-and-forget from the client, and a rejection here must never keep a manager out of a
 * live draft (see `RoomTour`'s own docblock).
 *
 * `updatePreferences` requires the row to already exist (`readPreferences` seeds it), which is
 * true by construction here: every surface that renders a control backed by this route has
 * already read preferences server-side first (the draft room page calls `readPreferences`
 * before it ever renders `RoomTour`).
 */
export async function PATCH(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const parsed = await parseJson(req, updatePreferencesSchema);
    if (!parsed.ok) return parsed.response;

    const params: UpdatePreferencesParams = { userId, ...parsed.value };
    const preferences = await updatePreferences(getDb(), params);
    return ok<PreferenceState>(preferences);
  });
}
