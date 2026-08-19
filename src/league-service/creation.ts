import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, teams } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlotConfig } from "@/domain/roster";
import { SCORING_PRESETS, type ScoringPresetName } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import type { ExperienceTier } from "@/domain/user";
import { LEAGUE_CONFIG } from "@/league";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { MS_PER_DAY } from "./config";

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
}

export type CreateLeagueResult =
  | { readonly ok: true; readonly leagueId: string; readonly teamId: string; readonly draftId: string }
  | { readonly ok: false; readonly reason: string };

/**
 * A league is never half-created: the league row, its scoring settings, the commissioner's own
 * team and the scheduled draft all land in ONE transaction. A commissioner left holding a
 * league they have no team in — or a league with no draft to open — is exactly the dead end
 * the UX review's C5 finding is about.
 *
 * The draft is scheduled `LEAGUE_CONFIG.defaults.draftDaysFromCreation` out so the
 * auto-tightening clock starts in a slow tier rather than at the 60-second floor.
 */
export async function createLeague(
  { db, clock, newId, cache = NOOP_REFERENCE_CACHE }: LeagueWriteDeps,
  input: CreateLeagueInput,
): Promise<CreateLeagueResult> {
  const leagueId = newId();
  const teamId = newId();
  const draftId = newId();
  const kickoffAt = new Date(Date.parse(clock.now()) + LEAGUE_CONFIG.defaults.draftDaysFromCreation * MS_PER_DAY);

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
    });
  } catch (error: unknown) {
    // Plain language out, real detail into the logs — never raw driver text to a user.
    console.error("[league] create failed", { commissionerUserId: input.commissionerUserId }, error);
    return { ok: false, reason: "We couldn't create that league. Please try again." };
  }

  // After the transaction commits, never inside it — the same reason `setLineup` invalidates
  // post-commit (`lineups.ts`): an eviction for a write that then rolls back is worse than a
  // brief stale read.
  void cache.invalidateScoringSettings(leagueId);

  return { ok: true, leagueId, teamId, draftId };
}
