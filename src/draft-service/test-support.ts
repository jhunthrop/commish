import type { Db } from "@/db/client";
import { drafts, leagues, teams, users } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlotConfig } from "@/domain/roster";

/** Three roster spots — enough to exercise every rule, short enough that a 12-team draft is fast. */
export const SPRINT_ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
];

/** Module-private: only the parameter/return type of `seedDraftFixture` below — no caller
 *  imports this by name, they let it infer structurally. */
interface SeedDraftInput {
  readonly draftId: string;
  readonly leagueId: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly kickoffAt: Date;
  readonly auctionBudget: number | null;
  /** Defaults to `false` (a private league) — matches `leagues.is_public_matchmade`'s own
   *  default, so every existing caller keeps seeding a private league without change. Task 7's
   *  own tests are the first to pass `true`. */
  readonly isPublicMatchmade?: boolean;
  /**
   * Phase 3.6, Task 7: how many of `teamCount` seats are actually FILLED with a real `teams`
   * row — defaults to `teamCount` itself, so every existing caller keeps seeding a fully-seated
   * league unchanged. Task 7's own bug-report test is the first to seed a league whose room is
   * short, because that is the exact shape the founder's "roll until full" ruling exists for.
   */
  readonly filledTeams?: number;
  /** Defaults to `"scheduled"` — `leagues.start_trigger`'s own default, so every existing caller
   *  keeps seeding a commissioner-timed draft unchanged. */
  readonly startTrigger?: "scheduled" | "when_full";
}

/** Module-private — see `SeedDraftInput` above. */
interface DraftFixture {
  readonly draftId: string;
  readonly leagueId: string;
  readonly teamIds: readonly string[];
  readonly userIds: readonly string[];
}

/** Inserts users, a league, its teams and a scheduled draft. Test-only. */
export async function seedDraftFixture(db: Db, input: SeedDraftInput): Promise<DraftFixture> {
  const filledTeams = input.filledTeams ?? input.teamCount;
  const userIds = Array.from({ length: input.teamCount }, (_, i) => `${input.leagueId}_user_${i + 1}`);
  const teamIds = Array.from({ length: filledTeams }, (_, i) => `${input.leagueId}_team_${i + 1}`);

  await db.insert(users).values(userIds.map((id) => ({ id, email: `${id}@test.local`, displayName: id })));
  await db.insert(leagues).values({
    id: input.leagueId,
    name: input.leagueId,
    format: input.format,
    teamCount: input.teamCount,
    commissionerUserId: userIds[0]!,
    rosterSlots: [...input.slotConfig],
    isPublicMatchmade: input.isPublicMatchmade ?? false,
  });
  await db.insert(teams).values(
    teamIds.map((id, i) => ({ id, leagueId: input.leagueId, userId: userIds[i]!, name: `Team ${i + 1}` })),
  );
  await db.insert(drafts).values({
    id: input.draftId,
    leagueId: input.leagueId,
    format: input.format,
    status: "scheduled",
    kickoffAt: input.kickoffAt,
    auctionBudget: input.auctionBudget,
    startTrigger: input.startTrigger ?? "scheduled",
  });

  return { draftId: input.draftId, leagueId: input.leagueId, teamIds, userIds };
}
