import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, teams } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlotConfig } from "@/domain/roster";
import { SCORING_PRESETS, type ScoringPresetName } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { LEAGUE_CONFIG } from "@/league";
import { MS_PER_DAY } from "./config";

export interface LeagueWriteDeps {
  readonly db: Db;
  readonly clock: Clock;
  /** Injected so ids are deterministic in a test and in the seed. `crypto.randomUUID` at the edge. */
  readonly newId: () => string;
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
  { db, clock, newId }: LeagueWriteDeps,
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

  return { ok: true, leagueId, teamId, draftId };
}
