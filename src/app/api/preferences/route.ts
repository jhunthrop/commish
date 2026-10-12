import { getDb } from "@research/db/client";
import type { PreferenceState } from "@/identity";
import { updatePreferences, type UpdatePreferencesParams } from "@/identity-service/preferences";
import { updatePreferencesSchema } from "@/identity-service/schemas";
import { ok, parseJson } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { preferencesRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Writes the caller's own preferences: a help level and/or the draft-room tour's dismissal.
 * Two callers today — the draft-room tour (`RoomTour`), whose write is deliberately
 * fire-and-forget because a rejection here must never keep a manager out of a live draft (see
 * its own docblock), and the profile's "How much help" control (`HelpLevelForm`), which states
 * a refusal rather than swallowing it.
 *
 * `updatePreferences` is SELF-SUFFICIENT: it seeds the row from the caller's own
 * `experienceTier` when none exists, so a bare PATCH from a user who has never opened a surface
 * that reads preferences first succeeds rather than 500s. (The docblock here used to claim the
 * opposite; Task 4's own fix round made it self-sufficient and this line was never updated.)
 *
 * Rate-limited per user (`preferencesRateLimited`), sibling parity with `PATCH /api/profile`:
 * both are authenticated per-user writes, and this one opens a three-statement transaction
 * per call.
 */
export async function PATCH(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = preferencesRateLimited(userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, updatePreferencesSchema);
    if (!parsed.ok) return parsed.response;

    const params: UpdatePreferencesParams = { userId, ...parsed.value };
    const preferences = await updatePreferences(getDb(), params);
    return ok<PreferenceState>(preferences);
  });
}
