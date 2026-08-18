import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leagues, teams, users } from "@/db/schema";
import { DEV_SEED } from "./config";

/** Matches a `DEV_SEED.userIdPrefix`-prefixed placeholder id, in a Postgres `LIKE` pattern. */
const DEV_PLACEHOLDER_PATTERN = `${DEV_SEED.userIdPrefix}%`;

/**
 * Inserts the fixed set of placeholder dev users (idempotent — `onConflictDoNothing`), then
 * returns the owner id for each of a league's `DEV_SEED.teamCount` teams: a dev placeholder
 * for every slot except the first, which is `claimUserId` when the caller has one — the "hand
 * the founder team 1 and the commissioner's chair" behavior both dev-league seeders share.
 *
 * Extracted from `seedDevLeagues` and `seedSeasonLeague`, which used to duplicate this block
 * verbatim.
 */
export async function ensureDevUsers(db: Db, claimUserId?: string): Promise<readonly string[]> {
  const devUserIds = Array.from({ length: DEV_SEED.teamCount }, (_, i) => `${DEV_SEED.userIdPrefix}${String(i + 1).padStart(2, "0")}`);
  await db
    .insert(users)
    .values(devUserIds.map((id) => ({ id, email: `${id}@${DEV_SEED.emailDomain}`, displayName: `Dev Manager ${id.slice(-2)}` })))
    .onConflictDoNothing({ target: users.id });

  return devUserIds.map((id, index) => (index === 0 && claimUserId !== undefined ? claimUserId : id));
}

/**
 * An `onConflictDoUpdate` `set` fragment for `teams.userId`: refreshes it to the incoming
 * value only while it is STILL a dev placeholder, and leaves it alone once a real user has
 * claimed the team. Without this, re-running `npm run seed` unconditionally overwrote the
 * owner on every run — un-claiming the founder's own dev team unless
 * `DEV_SEED_CLAIM_USER_ID` happened to be exported for that particular run.
 *
 * Idempotency is preserved: a still-placeholder-owned team is still rewritten to the same
 * (or a newly claimed) value every time.
 */
export function preserveRealTeamOwner(): SQL {
  return sql`case when ${teams.userId} like ${DEV_PLACEHOLDER_PATTERN} then excluded.user_id else ${teams.userId} end`;
}

/**
 * The same protection as `preserveRealTeamOwner`, for `leagues.commissionerUserId`. Needed
 * for the same reason and by the same class of bug: without it, a reseed that un-claims team 1
 * (were that not itself fixed) but leaves the commissioner's chair reset to a placeholder would
 * produce a WORSE inconsistency than before — a real owner sitting in a league whose
 * commissioner is a dev placeholder.
 */
export function preserveRealCommissioner(): SQL {
  return sql`case when ${leagues.commissionerUserId} like ${DEV_PLACEHOLDER_PATTERN} then excluded.commissioner_user_id else ${leagues.commissionerUserId} end`;
}
