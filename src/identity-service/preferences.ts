import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { userPreferences, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
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
 * The caller's own preferences, seeding the row on first read rather than at sign-up
 * (`userPreferences`'s own docblock in `@/db/schema`).
 */
export async function readPreferences(db: Db, user: { readonly id: string; readonly experienceTier: ExperienceTier }): Promise<PreferenceState> {
  await seedIfMissing(db, user.id, user.experienceTier);
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id));
  if (row === undefined) throw new Error(`No preferences row for user ${user.id} after seeding.`);
  return toPreferenceState(row);
}

/**
 * Writes `helpLevel` and/or stamps `draftTourDismissedAt` from `clock`, never `Date.now()`
 * directly (`@/domain/timing`'s `Clock` convention).
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
