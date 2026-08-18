import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { leagueInvites, leagues, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { generateInviteCode, LEAGUE_CONFIG } from "@/league";
import { MS_PER_DAY } from "./config";
import type { LeagueWriteDeps } from "./creation";

/** The unique index that backstops "the same person joined twice" — see `schema.ts`. */
const TEAM_MEMBERSHIP_UNIQUE_INDEX = "teams_league_user_idx";
const INVALID = "That invite link isn't valid. Ask your commissioner for a new one.";

export interface InviteDeps {
  readonly db: Db;
  readonly clock: Clock;
  /** Injected so the minted code is reproducible in a test. The edge is `crypto.getRandomValues`
   *  (see `src/app/api/leagues/[leagueId]/invites/route.ts`) — invite codes are membership
   *  capabilities, so `Math.random` (seedable/observable) is not an option here. */
  readonly random: () => number;
}

export interface CreateInviteInput {
  readonly leagueId: string;
  readonly createdByUserId: string;
  readonly maxUses?: number;
}

export type CreateInviteResult =
  | { readonly ok: true; readonly code: string; readonly expiresAt: string; readonly maxUses: number }
  | { readonly ok: false; readonly reason: string };

export interface AcceptInviteInput {
  readonly code: string;
  readonly userId: string;
  readonly teamName?: string;
}

export type AcceptInviteResult =
  | { readonly ok: true; readonly leagueId: string; readonly teamId: string; readonly alreadyMember: boolean }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Mints a bounded invite. The code IS the primary key, so the shareable link
 * (`/app/join/<code>`) and the short code a commissioner reads out are the same artifact —
 * one thing to expire, one thing to revoke.
 */
export async function createInvite(
  { db, clock, random }: InviteDeps,
  input: CreateInviteInput,
): Promise<CreateInviteResult> {
  const maxUses = input.maxUses ?? LEAGUE_CONFIG.invite.maxUses;
  const expiresAt = new Date(Date.parse(clock.now()) + LEAGUE_CONFIG.invite.expiryDays * MS_PER_DAY);

  for (let attempt = 0; attempt < LEAGUE_CONFIG.invite.maxCodeAttempts; attempt++) {
    const code = generateInviteCode(random);
    const inserted = await db
      .insert(leagueInvites)
      .values({ code, leagueId: input.leagueId, createdByUserId: input.createdByUserId, expiresAt, maxUses })
      .onConflictDoNothing({ target: leagueInvites.code })
      .returning({ code: leagueInvites.code });
    if (inserted.length > 0) return { ok: true, code, expiresAt: expiresAt.toISOString(), maxUses };
  }
  return { ok: false, reason: "We couldn't create an invite just now. Please try again." };
}

/**
 * Joins the caller to the invite's league.
 *
 * Two locks, taken in a fixed order (invite, then league) so no two accepts can deadlock.
 *
 * The **league** lock is what bounds `teamCount`: two people redeeming two DIFFERENT codes for
 * the same league share no invite row, so they would otherwise both read "11 of 12" and both
 * insert. Locking the league serializes every accept for that league whatever code it arrived
 * on. The **invite** lock is what bounds `maxUses`: without it, a second accept on the SAME
 * code reads the pre-increment `uses` before it blocks on the league lock, then resumes with a
 * stale count in memory and passes the cap check anyway — so a `maxUses: 1` invite minted for
 * one specific person could be redeemed by k concurrent people.
 *
 * `teams_league_user_idx` remains the backstop for the narrower "same person twice" race — a
 * violation of THAT index means they are already a member, which is a success, not an error.
 */
export async function acceptInvite(
  { db, clock, newId }: LeagueWriteDeps,
  input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
  try {
    return await db.transaction(async (tx) => {
      // `for update`: the cap check at the bottom reads `invite.uses`, so this row must be
      // held until the matching increment commits.
      const [invite] = await tx.select().from(leagueInvites).where(eq(leagueInvites.code, input.code)).for("update");
      if (invite === undefined) return { ok: false as const, status: 404, reason: INVALID };

      // Serializes every accept for this league, whatever code it came from.
      const [league] = await tx
        .select({ id: leagues.id, teamCount: leagues.teamCount })
        .from(leagues)
        .where(eq(leagues.id, invite.leagueId))
        .for("update");
      if (league === undefined) return { ok: false as const, status: 404, reason: INVALID };

      const [existing] = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.leagueId, league.id), eq(teams.userId, input.userId)));
      // Re-opening your own invite link is not an error, and costs nobody a use.
      if (existing !== undefined) {
        return { ok: true as const, leagueId: league.id, teamId: existing.id, alreadyMember: true };
      }

      if (Date.parse(clock.now()) >= invite.expiresAt.getTime()) {
        return { ok: false as const, status: 410, reason: "That invite link has expired. Ask your commissioner for a new one." };
      }
      if (invite.uses >= invite.maxUses) {
        return {
          ok: false as const,
          status: 410,
          reason: "That invite link has already been used up. Ask your commissioner for a new one.",
        };
      }

      const filled = await tx.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, league.id));
      if (filled.length >= league.teamCount) {
        return { ok: false as const, status: 409, reason: "That league is already full." };
      }

      const [profile] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.userId));
      const teamId = newId();
      await tx.insert(teams).values({
        id: teamId,
        leagueId: league.id,
        userId: input.userId,
        name: input.teamName ?? profile?.displayName ?? "New team",
      });
      await tx.update(leagueInvites).set({ uses: sql`${leagueInvites.uses} + 1` }).where(eq(leagueInvites.code, input.code));

      return { ok: true as const, leagueId: league.id, teamId, alreadyMember: false };
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error, TEAM_MEMBERSHIP_UNIQUE_INDEX)) {
      // The unique-index backstop fired: a concurrent accept created this user's team first.
      // Scoped through the invite to THIS league — a manager who fields teams in several
      // leagues must not be handed whichever one the database happened to return.
      const [existing] = await db
        .select({ id: teams.id, leagueId: teams.leagueId })
        .from(teams)
        .innerJoin(leagueInvites, eq(leagueInvites.leagueId, teams.leagueId))
        .where(and(eq(leagueInvites.code, input.code), eq(teams.userId, input.userId)));
      if (existing !== undefined) {
        return { ok: true, leagueId: existing.leagueId, teamId: existing.id, alreadyMember: true };
      }
    }
    // The code is a membership capability — never write it to a log.
    console.error("[league] accept invite failed", { league: "redacted-code" }, error);
    return { ok: false, status: 500, reason: "We couldn't join that league just now. Please try again." };
  }
}
