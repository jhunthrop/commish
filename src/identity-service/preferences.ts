import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@research/db/client";
import { userPreferences, users } from "@/db/schema";
import type { Clock } from "@research/domain/timing";
import type { ExperienceTier } from "@/domain/user";
import { defaultPreferences, type HelpLevel, type PreferenceState } from "@/identity";

const systemClock: Clock = { now: () => new Date().toISOString() };

/** What `updatePreferences` accepts. `userId` never comes from a request body — see the route handler. */
export interface UpdatePreferencesParams {
  readonly userId: string;
  /** Omit to leave the stored help level alone. */
  readonly helpLevel?: HelpLevel;
  /** `true` stamps `draftTourDismissedAt` with the clock's current time. Omit or `false` to leave it alone. */
  readonly dismissDraftTour?: boolean;
}

type PreferencesRow = Pick<typeof userPreferences.$inferSelect, "helpLevel" | "draftTourDismissedAt">;

function toPreferenceState(row: PreferencesRow): PreferenceState {
  return {
    helpLevel: row.helpLevel,
    draftTourDismissedAt: row.draftTourDismissedAt === null ? null : row.draftTourDismissedAt.toISOString(),
  };
}

/**
 * Inserts the row if it's missing, seeded from `defaultPreferences({ experienceTier })` — the
 * one seeding idiom, shared by `readPreferences` and `updatePreferences` so there is exactly
 * one place that decides what a brand-new row looks like. `onConflictDoNothing`, not a plain
 * `INSERT ... RETURNING`: two concurrent first touches for the same user (a read and a write, or
 * two writes) race safely, because whichever insert loses the race does nothing and both callers
 * go on to see the one row that won.
 */
async function seedIfMissing(db: Db | DbTx, userId: string, experienceTier: ExperienceTier): Promise<void> {
  const seed = defaultPreferences({ experienceTier });
  await db
    .insert(userPreferences)
    .values({ userId, helpLevel: seed.helpLevel })
    .onConflictDoNothing({ target: userPreferences.userId });
}

/**
 * Re-derives `helpLevel` from a NEWLY CHOSEN `experienceTier` — the coarse knob moving the fine
 * one. Called by `updateProfile` inside its own transaction (hence `DbTx`, and hence `now`
 * passed in rather than read here: the clock is evaluated before the transaction opens, the
 * PgBouncer transaction-mode discipline this codebase holds everywhere).
 *
 * Seeded once and never re-derived is what pinned every user to `guided` forever: `users`
 * defaults `experience_tier` to `beginner`, so every account seeded `guided` and nothing in
 * production ever wrote the column again. The tier is the coarse control and the profile's
 * explicit "How much help" the fine one; both are visible on one page and LAST WRITE WINS, so
 * an explicit choice stands until the tier changes again, and vice versa.
 */
export async function applyTierDefaultHelpLevel(tx: DbTx, userId: string, experienceTier: ExperienceTier, now: Date): Promise<void> {
  await seedIfMissing(tx, userId, experienceTier);
  await tx
    .update(userPreferences)
    .set({ helpLevel: defaultPreferences({ experienceTier }).helpLevel, updatedAt: now })
    .where(eq(userPreferences.userId, userId));
}

/**
 * The caller's own preferences, seeding the row on first read rather than at sign-up
 * (`userPreferences`'s own docblock in `@research/db/schema`).
 *
 * READ FIRST, seed only on a miss. This used to run `seedIfMissing` unconditionally, which made
 * every read a write: `GET /api/home` calls it, `HomeBoard` polls that route every 30 seconds,
 * so every open tab took a `RowExclusiveLock` on `user_preferences` twice a minute forever, for
 * a row that already existed. The steady state is now a plain `SELECT`. The seed path still uses
 * `INSERT ... ON CONFLICT DO NOTHING`, so the read-then-insert below is not a race: two
 * concurrent first touches still both end up seeing the one row that won.
 */
export async function readPreferences(db: Db, user: { readonly id: string; readonly experienceTier: ExperienceTier }): Promise<PreferenceState> {
  const [existing] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id));
  if (existing !== undefined) return toPreferenceState(existing);

  await seedIfMissing(db, user.id, user.experienceTier);
  const [seeded] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id));
  if (seeded === undefined) throw new Error(`No preferences row for user ${user.id} after seeding.`);
  return toPreferenceState(seeded);
}

/**
 * Writes `helpLevel` and/or stamps `draftTourDismissedAt` from `clock`, never `Date.now()`
 * directly (`@research/domain/timing`'s `Clock` convention).
 *
 * Self-sufficient: a bare `PATCH /api/preferences` from a user who has never opened anything
 * that calls `readPreferences` first must still succeed, not 500. So this looks up the caller's
 * own `experienceTier`, seeds the row if it's missing (the same `seedIfMissing` idiom
 * `readPreferences` uses), and applies the write — all inside one transaction, so a concurrent
 * caller never observes the seed without the write or the write without the seed.
 */
export async function updatePreferences(db: Db, input: UpdatePreferencesParams, clock: Clock = systemClock): Promise<PreferenceState> {
  const now = new Date(clock.now());
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ experienceTier: users.experienceTier }).from(users).where(eq(users.id, input.userId));
    if (user === undefined) throw new Error(`No user row for id ${input.userId}.`);
    await seedIfMissing(tx, input.userId, user.experienceTier);

    const [row] = await tx
      .update(userPreferences)
      .set({
        helpLevel: input.helpLevel,
        draftTourDismissedAt: input.dismissDraftTour === true ? now : undefined,
        updatedAt: now,
      })
      .where(eq(userPreferences.userId, input.userId))
      .returning();
    if (row === undefined) throw new Error(`No preferences row for user ${input.userId} after seeding.`);
    return toPreferenceState(row);
  });
}
