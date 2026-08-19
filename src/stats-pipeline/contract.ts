/**
 * The client boundary for live scoring. `Task 8`'s realtime hook imports these two types ONLY
 * (`import type`), never a value from this module — nothing here is a function a client could
 * call, which is what makes that boundary real rather than a naming convention.
 */

/** Mirrors `stat_weeks.status` (`src/db/schema.ts`'s `weekStatusEnum`) — kept as a hand-declared
 *  literal union rather than derived from the Drizzle enum, the same convention `DraftStatus`
 *  (`src/domain/draft.ts`) already uses for its table. */
export type WeekStatus = "scheduled" | "in_progress" | "final";

/** One team's current total for the week the payload names. */
export interface TeamScore {
  readonly teamId: string;
  readonly points: number;
}

/**
 * What one `score.update` realtime event carries. `version` is `stat_weeks.version` — the
 * cache-freshness signal Task 3 built `statLineDigest`/`diffStatLines` around — so a client can
 * tell a stale push from a fresh one without re-deriving it from the scores array.
 */
export interface ScoreUpdatePayload {
  readonly week: number;
  readonly status: WeekStatus;
  readonly version: number;
  readonly gamesFinal: number;
  readonly gamesTotal: number;
  readonly scores: readonly TeamScore[];
}
