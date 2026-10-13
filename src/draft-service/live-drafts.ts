import { eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { drafts } from "@/db/schema";
import { DRAFT_SERVICE_CONFIG } from "./config";

/**
 * The live scan: every in-progress draft whose clock a sweep has to check. `drafts_status_idx`'s
 * FIRST reader, and the one whose plan `dueDraftsQuery`'s own widening to `(status, kickoff_at)`
 * had to leave undisturbed (migration 0029). Lived in the dev ticker until the batched bots
 * round (2026-09-25) retired it; the minute sweep (`@/jobs/defs/draft-sweep-job`) is its one
 * caller now, on every host alike.
 *
 * Exported as the query BUILDER (not yet awaited), the shape `dueDraftsQuery`/`browseQuery`/
 * `openQuestionsQuery` already use, for the reason final review F16 named: the schema comment and
 * the decision doc both said "TWO READERS, MEASURED" while only ONE of the two had an EXPLAIN
 * assertion behind it. This is the seam that lets the second one be measured rather than argued
 * (`src/db/index-plans.test.ts`, "the ticker's expiry scan"), against the real query rather than a
 * hand copy (F9's lesson).
 *
 * Equality on the index's leading column, bounded by `maxDraftsPerTick` and ordered by `id` for
 * the same determinism the due-kickoff scan keeps.
 */
export function liveDraftsQuery(db: Db) {
  return db
    .select({ id: drafts.id })
    .from(drafts)
    .where(eq(drafts.status, "in_progress"))
    .orderBy(drafts.id)
    .limit(DRAFT_SERVICE_CONFIG.maxDraftsPerTick);
}
