import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, teams } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlotConfig } from "@/domain/roster";
import { SCORING_PRESETS, type ScoringPresetName } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import type { ExperienceTier } from "@/domain/user";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { LEAGUE_CONFIG } from "@/league";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { MS_PER_DAY } from "./config";
import { ENFORCEMENT_REFUSALS, tierJoinPrecondition } from "./enforcement";

/** No Redis connection needed: every existing caller of `createLeague` keeps working untouched. */
const NOOP_REFERENCE_CACHE: Pick<ReferenceCache, "invalidateScoringSettings"> = {
  invalidateScoringSettings: async () => {},
};

export interface LeagueWriteDeps {
  readonly db: Db;
  readonly clock: Clock;
  /** Injected so ids are deterministic in a test and in the seed. `crypto.randomUUID` at the edge. */
  readonly newId: () => string;
  /**
   * Invalidates this new league's cached scoring settings after they're written, no-op by
   * default. `createLeague` is one of two writers of `scoring_settings` today (the other is the
   * seed) — the day a settings-edit route exists, it must call `invalidateScoringSettings` too,
   * and that is the day this becomes a shared helper both call, rather than two call sites that
   * can silently drift apart.
   */
  readonly cache?: Pick<ReferenceCache, "invalidateScoringSettings">;
  /** Defaults to the process-wide logger (`getAuditLogger()`), the same way every other writer here defaults its collaborators. */
  readonly audit?: AuditLogger;
}

export interface CreateLeagueInput {
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly scoringPreset: ScoringPresetName;
  /** Stored as null for a snake league, whatever the caller passes. */
  readonly auctionBudget: number | null;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly commissionerUserId: string;
  readonly teamName: string;
  /** Who the league is advertised for on public browse. Defaults from the creator at the route. */
  readonly experienceTier: ExperienceTier;
  /** Cosmetic tier index only — no entry fee is charged and no balance exists in this phase. */
  readonly stakeTier: number;
  /** Opt-in. A league is invite-only and unlisted unless its creator chose otherwise. */
  readonly isPublicMatchmade: boolean;
  /**
   * ISO instant. Optional: the creation form itself never collects this (Task 6 only wires the
   * schedule PANEL, reachable after a league exists, not a creation-time field), but a caller
   * who already has a real chosen time — a seed, a fixture, a future creation flow — should not
   * have to create the league blind and immediately follow with `setDraftKickoff`. Omitted, the
   * SAME `LEAGUE_CONFIG.defaults.draftDaysFromCreation` arithmetic this function has used since
   * Phase 1 still runs, so every existing caller is unaffected.
   */
  readonly kickoffAt?: string;
}

export type CreateLeagueResult =
  | { readonly ok: true; readonly leagueId: string; readonly teamId: string; readonly draftId: string }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * A league is never half-created: the league row, its scoring settings, the commissioner's own
 * team and the scheduled draft all land in ONE transaction. A commissioner left holding a
 * league they have no team in — or a league with no draft to open — is exactly the dead end
 * the UX review's C5 finding is about.
 *
 * The draft is scheduled `LEAGUE_CONFIG.defaults.draftDaysFromCreation` out so the
 * auto-tightening clock starts in a slow tier rather than at the 60-second floor.
 *
 * THE CREATION-SIDE GATE (Task 3, ruling 6). `publicJoinPrecondition` (`@/league-service/join`)
 * never runs for a league's OWN creator — a creator does not join their own league through the
 * public door, so the join gate alone leaves the exact hole the segregation exists to prevent: a
 * veteran declares their own public league `beginner` and simply waits for it to fill. This reads
 * the SAME `tierJoinPrecondition` (`@/league-service/enforcement`) the join gate reads, against
 * the fields THIS request is asking to create rather than a row already in `leagues` — the one
 * predicate, asked before either league exists, the other before a caller may enter one.
 *
 * NO-WRITE-BEFORE-COMMITTED-REFUSAL: this check runs BEFORE `db.transaction(...)` is ever opened,
 * not inside it and rolled back — a refused creation writes nothing, ever, not even inside a
 * transaction nobody sees commit.
 */
export async function createLeague(
  { db, clock, newId, cache = NOOP_REFERENCE_CACHE, audit = getAuditLogger() }: LeagueWriteDeps,
  input: CreateLeagueInput,
): Promise<CreateLeagueResult> {
  if (await tierJoinPrecondition(db, { isPublicMatchmade: input.isPublicMatchmade, experienceTier: input.experienceTier }, input.commissionerUserId)) {
    return { ok: false, status: 409, reason: ENFORCEMENT_REFUSALS.create };
  }

  const leagueId = newId();
  const teamId = newId();
  const draftId = newId();
  const kickoffAt =
    input.kickoffAt !== undefined
      ? new Date(input.kickoffAt)
      : new Date(Date.parse(clock.now()) + LEAGUE_CONFIG.defaults.draftDaysFromCreation * MS_PER_DAY);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(leagues).values({
        id: leagueId,
        name: input.name,
        format: input.format,
        teamCount: input.teamCount,
        commissionerUserId: input.commissionerUserId,
        rosterSlots: [...input.rosterSlots],
        experienceTier: input.experienceTier,
        stakeTier: input.stakeTier,
        isPublicMatchmade: input.isPublicMatchmade,
      });
      await tx.insert(scoringSettings).values({ leagueId, ...SCORING_PRESETS[input.scoringPreset] });
      await tx.insert(teams).values({ id: teamId, leagueId, userId: input.commissionerUserId, name: input.teamName });
      await tx.insert(drafts).values({
        id: draftId,
        leagueId,
        format: input.format,
        status: "scheduled",
        kickoffAt,
        auctionBudget: input.format === "auction" ? input.auctionBudget : null,
      });
      await audit.record(tx, {
        eventType: "league_created",
        actorId: input.commissionerUserId,
        actorType: "user",
        leagueId,
        payload: {
          name: input.name,
          format: input.format,
          teamCount: input.teamCount,
          stakeTier: input.stakeTier,
          isPublicMatchmade: input.isPublicMatchmade,
          experienceTier: input.experienceTier,
          scoringPreset: input.scoringPreset,
        },
        occurredAt: clock.now(),
      });
    });
  } catch (error: unknown) {
    // Plain language out, real detail into the logs — never raw driver text to a user.
    console.error("[league] create failed", { commissionerUserId: input.commissionerUserId }, error);
    return { ok: false, status: 500, reason: "We couldn't create that league. Please try again." };
  }

  // After the transaction commits, never inside it — the same reason `setLineup` invalidates
  // post-commit (`lineups.ts`): an eviction for a write that then rolls back is worse than a
  // brief stale read. Awaited and caught rather than fire-and-forget, so the response cannot
  // outrun the DEL, and a failure is surfaced in the log instead of vanishing into a floating
  // promise.
  try {
    await cache.invalidateScoringSettings(leagueId);
  } catch (error: unknown) {
    console.error("[league] scoring settings cache invalidation failed", { leagueId }, error);
  }

  return { ok: true, leagueId, teamId, draftId };
}
