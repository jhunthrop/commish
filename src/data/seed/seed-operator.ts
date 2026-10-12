import type { Db } from "@research/db/client";
import type { Clock } from "@research/domain/timing";
import { BOOTSTRAP_ACTOR, grantAdmin, type GrantAdminResult } from "@/integrity-service/grant-admin";
import { DEV_SEED } from "./config";

/**
 * Grants team 1's owner (`claimUserId` if the developer has claimed one, else the first dev
 * placeholder `ensureDevUsers` always creates) operator access — the SAME account
 * `seedDevLeagues`/`seedSeasonLeague` hand the commissioner's chair to, so `npm run seed &&
 * npm run dev` lands a working dispute queue with no manual step.
 *
 * Not mock data (founder rule): this calls `grantAdmin`, the one real writer of
 * `users.isAdmin`, so a real audit event and a real notice land — exactly what a grant through
 * `scripts/grant-admin.ts` would produce. `--by bootstrap`, because a fresh database has no
 * operator yet to name; on a database that already has one (a reseed, or a developer who ran
 * `scripts/grant-admin.ts` by hand first), `grantAdmin`'s own bootstrap check refuses this call
 * exactly like it would refuse a second `--by bootstrap` from the script — reported by the
 * caller, not thrown, because a reseed is not an error.
 *
 * Must run AFTER `ensureDevUsers` has already inserted the fallback `dev_user_01` row (via
 * `seedDevLeagues` or `seedSeasonLeague`): `grantAdmin`'s own UPDATE only ever matches an
 * EXISTING user, by the same design that keeps this the one and only writer of the column.
 */
export async function seedOperator(db: Db, clock: Clock, claimUserId?: string): Promise<GrantAdminResult> {
  const operatorId = claimUserId ?? `${DEV_SEED.userIdPrefix}01`;
  return grantAdmin(db, { userId: operatorId, grant: true, grantedBy: BOOTSTRAP_ACTOR, clock });
}
