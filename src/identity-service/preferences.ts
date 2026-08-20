import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { userPreferences } from "@/db/schema";
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
 * The caller's own preferences, seeding the row on first read rather than at sign-up
 * (`userPreferences`'s own docblock in `@/db/schema`). `onConflictDoNothing` then a separate
 * select — not a single `INSERT ... RETURNING` — so two concurrent first reads for the same
 * user race safely under the connection pooler: whichever insert loses the race does nothing,
 * and both reads then see the one row that won.
 */
export async function readPreferences(db: Db, user: { readonly id: string; readonly experienceTier: ExperienceTier }): Promise<PreferenceState> {
  const seed = defaultPreferences(user);
  await db
    .insert(userPreferences)
    .values({ userId: user.id, helpLevel: seed.helpLevel })
    .onConflictDoNothing({ target: userPreferences.userId });
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id));
  if (row === undefined) throw new Error(`No preferences row for user ${user.id} after seeding.`);
  return toPreferenceState(row);
}

/**
 * Writes `helpLevel` and/or stamps `draftTourDismissedAt` from `clock`, never `Date.now()`
 * directly (`@/domain/timing`'s `Clock` convention). Requires the row to already exist —
 * `readPreferences` is what seeds it — so a write before any read fails loudly rather than
 * silently seeding the wrong default (a write path doesn't know the caller's `experienceTier`).
 */
export async function updatePreferences(db: Db, input: UpdatePreferencesParams, clock: Clock = systemClock): Promise<PreferenceState> {
  const now = new Date(clock.now());
  const [row] = await db
    .update(userPreferences)
    .set({
      helpLevel: input.helpLevel,
      draftTourDismissedAt: input.dismissDraftTour === true ? now : undefined,
      updatedAt: now,
    })
    .where(eq(userPreferences.userId, input.userId))
    .returning();
  if (row === undefined) throw new Error(`No preferences row for user ${input.userId}. Read preferences before writing them.`);
  return toPreferenceState(row);
}
