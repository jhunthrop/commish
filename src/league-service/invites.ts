import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { drafts, leagueInvites, leagues, scoringSettings, teams, users } from "@/db/schema";
import { PPR_SCORING } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { generateInviteCode, leagueTerms, LEAGUE_CONFIG, type LeagueTerms } from "@/league";
import { leagueAuthority } from "./authority";
import { MS_PER_DAY } from "./config";
import type { LeagueWriteDeps } from "./creation";
import { joinLeagueInTx, triggerMultiAccountSweep, type JoinLeagueOutcome, type JoinPrecondition } from "./join";

/** The unique index that backstops "the same person joined twice" — see `schema.ts`. */
const TEAM_MEMBERSHIP_UNIQUE_INDEX = "teams_league_user_idx";

/**
 * The three plain-language refusals a dead or invalid invite code can answer with — named here
 * once so `acceptInvite`'s precondition and the read-only `invitePreview` below say EXACTLY the
 * same sentence for the same failure, rather than two hand-typed copies that could quietly
 * diverge.
 */
const INVALID = "That invite link is not valid. Ask your commissioner for a new one.";
const EXPIRED = "That invite link has expired. Ask your commissioner for a new one.";
const EXHAUSTED = "That invite link has already been used up. Ask your commissioner for a new one.";

/** The outermost edge is the only place a wall clock is allowed — see every other service
 *  module's identical constant (`creation.ts`, `read.ts`, ...). */
const systemClock: Clock = { now: () => new Date().toISOString() };

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

export type AcceptInviteResult = JoinLeagueOutcome;

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
  return { ok: false, reason: "We could not create an invite just now. Please try again." };
}

/** One invite row, exactly as `listInvites`/the invites route hand it to a commissioner — never
 *  the DB row itself (no `leagueId`, no `createdByUserId`: a commissioner reads their own
 *  league's own invites, so neither fact is news). */
export interface InviteView {
  readonly code: string;
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly uses: number;
}

/**
 * Flow analysis C-03: every invite this league holds that is still LIVE right now — not expired,
 * not used up — the same two bounds `acceptInvite`'s own `invitePrecondition` checks, read here
 * rather than written, so a commissioner reloading the page sees the code they already sent
 * instead of a panel that silently forgot it. Newest first: the code a commissioner most
 * recently minted is the one they are most likely mid-conversation about.
 *
 * A dead code (expired or exhausted) simply stops appearing — this list is never the place a
 * commissioner reviews history, only the place they find a link that still works.
 */
export async function listInvites(db: Db, leagueId: string, clock: Clock = systemClock): Promise<readonly InviteView[]> {
  const nowMs = Date.parse(clock.now());
  const rows = await db
    .select()
    .from(leagueInvites)
    .where(eq(leagueInvites.leagueId, leagueId))
    .orderBy(desc(leagueInvites.createdAt));
  return rows
    .filter((row) => row.expiresAt.getTime() > nowMs && row.uses < row.maxUses)
    .map((row) => ({ code: row.code, expiresAt: row.expiresAt.toISOString(), maxUses: row.maxUses, uses: row.uses }));
}

export type RevokeInviteResult = { readonly ok: true } | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Flow analysis C-03: the commissioner's own "never mind, that link is dead now" — kills a code
 * by walking its `expiresAt` one millisecond into the past rather than adding a new column or
 * state: every reader that already treats expiry as dead (`acceptInvite`'s own precondition,
 * `invitePreview`, `listInvites` above) refuses a revoked code the identical honest way it
 * refuses one that simply ran out the clock, with no second "why was this refused" branch
 * anywhere downstream to keep in sync.
 *
 * Scoped to `leagueId` in the WHERE, not just the code: a commissioner of one league can never
 * revoke a code that happens to belong to a different one, even by guessing — the same
 * leagueId-bound safety `revokeInvite`'s caller (`DELETE /api/leagues/[leagueId]/invites`)
 * already gets from `withCommissioner`, held here too rather than trusted to the route alone.
 */
export async function revokeInvite(
  { db, clock }: Pick<InviteDeps, "db" | "clock">,
  input: { readonly leagueId: string; readonly code: string },
): Promise<RevokeInviteResult> {
  const nowMs = Date.parse(clock.now());
  const revoked = await db
    .update(leagueInvites)
    .set({ expiresAt: new Date(nowMs - 1) })
    .where(and(eq(leagueInvites.code, input.code), eq(leagueInvites.leagueId, input.leagueId)))
    .returning({ code: leagueInvites.code });
  if (revoked.length === 0) return { ok: false, status: 404, reason: "That invite link does not exist." };
  return { ok: true };
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
  { db, clock, newId, audit }: LeagueWriteDeps,
  input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
  try {
    const outcome = await db.transaction(async (tx) => {
      // `for update`: the cap check below reads `invite.uses`, so this row must be held until
      // the matching increment commits. Invite first, THEN league (`joinLeagueInTx` takes the
      // league lock) — one fixed order, so no two accepts can deadlock.
      const [invite] = await tx.select().from(leagueInvites).where(eq(leagueInvites.code, input.code)).for("update");
      if (invite === undefined) return { ok: false as const, status: 404, reason: INVALID };

      /**
       * The invite's own two bounds. Run through `joinLeagueInTx`'s precondition hook rather
       * than before it, so they are checked only for somebody who is NOT already a member:
       * re-opening your own invite link after it expired still returns your existing team,
       * costs no use, and mutates nothing.
       */
      const invitePrecondition: JoinPrecondition = async () => {
        if (Date.parse(clock.now()) >= invite.expiresAt.getTime()) {
          return { ok: false, status: 410, reason: EXPIRED };
        }
        if (invite.uses >= invite.maxUses) {
          return { ok: false, status: 410, reason: EXHAUSTED };
        }
        return null;
      };

      const outcome = await joinLeagueInTx(
        tx,
        { leagueId: invite.leagueId, userId: input.userId, teamName: input.teamName, newId, via: "invite", occurredAt: clock.now(), audit },
        invitePrecondition,
      );
      // A league the invite points at but that no longer exists reads as an invalid invite,
      // not as a missing league a stranger was never told about.
      if (!outcome.ok) return outcome.status === 404 ? { ok: false as const, status: 404, reason: INVALID } : outcome;
      // Re-arriving costs nobody a use.
      if (outcome.alreadyMember) return outcome;

      await tx.update(leagueInvites).set({ uses: sql`${leagueInvites.uses} + 1` }).where(eq(leagueInvites.code, input.code));
      return outcome;
    });
    // AFTER the transaction above has committed, never inside it — see `triggerMultiAccountSweep`
    // (`@/league-service/join`)'s own docblock for the lock-order reasoning (this door is the one
    // holding `league_invites` `FOR UPDATE` it was written to describe).
    await triggerMultiAccountSweep(db, outcome);
    return outcome;
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
    return { ok: false, status: 500, reason: "We could not join that league just now. Please try again." };
  }
}

export type InvitePreviewResult = { readonly ok: true; readonly terms: LeagueTerms } | { readonly ok: false; readonly reason: string };

/**
 * Read-only counterpart to `acceptInvite`: the SAME three validity checks (exists, not expired,
 * uses remaining), answered with the SAME constants above, so a dead link reads identically
 * here and at accept time — but this function never writes anything, and never takes a lock,
 * because previewing an invite is not spending it.
 *
 * An invalid code returns the refusal and NOTHING else: no league id, no name, not even whether
 * the code was well-formed. A preview endpoint that leaked a league's name for any guessed code
 * would be an enumeration oracle over every private league in the product, and the one thing
 * that makes that impossible is that every failing branch below returns before a single league
 * row is read.
 *
 * A valid code discloses the league's terms to WHOEVER holds it, no membership check beyond
 * that — exactly like `acceptInvite` itself, the code is the capability. This is a read, not a
 * write, so it deliberately does not run inside `acceptInvite`'s transaction or its row locks.
 */
export async function invitePreview(db: Db, code: string, clock: Clock = systemClock): Promise<InvitePreviewResult> {
  const [invite] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, code));
  if (invite === undefined) return { ok: false, reason: INVALID };
  if (Date.parse(clock.now()) >= invite.expiresAt.getTime()) return { ok: false, reason: EXPIRED };
  if (invite.uses >= invite.maxUses) return { ok: false, reason: EXHAUSTED };

  const [league] = await db.select().from(leagues).where(eq(leagues.id, invite.leagueId));
  // The league an otherwise-valid invite points at is gone — same collapse `acceptInvite` makes
  // (`joinLeagueInTx`'s LEAGUE_MISSING remapped to INVALID above): a stranger holding the link
  // is never told "a real league existed here", only that the link itself doesn't work.
  if (league === undefined) return { ok: false, reason: INVALID };

  // Ruling 33: a house league cannot have an invite at all — `createInvite`'s only caller
  // (`withCommissioner`) refuses a house league before an invite is ever minted, so a valid
  // invite code pointing at one is unreachable through ordinary use. Guarded here anyway, by the
  // authority union rather than assumed: under a nullable `commissioner_user_id` this function's
  // OLD lookup (`eq(users.id, league.commissionerUserId)`) no longer type-checks at all, which is
  // the compiler asking the question a reviewer might not have. Collapsed into the same INVALID
  // the `league === undefined` branch above answers with — a stranger holding the link learns
  // only that it doesn't work.
  const authority = leagueAuthority(league);
  if (authority.kind === "house") return { ok: false, reason: INVALID };

  const [commissioner] = await db.select({ displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(
    eq(users.id, authority.userId),
  );
  const [weights] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, league.id));
  const filledTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, league.id));
  const [draft] = await db
    .select({ kickoffAt: drafts.kickoffAt, startTrigger: drafts.startTrigger })
    .from(drafts)
    .where(eq(drafts.leagueId, league.id));

  return {
    ok: true,
    terms: leagueTerms({
      name: league.name,
      format: league.format,
      teamCount: league.teamCount,
      filledTeams: filledTeams.length,
      // `scoring_settings` is written in the same transaction as `leagues` (`createLeague`), so
      // a missing row here never happens in production — the PPR fallback mirrors `matchupWeek`'s
      // own defensive default (`read.ts`) rather than inventing a second convention for the same
      // never-true case.
      scoring: weights ?? PPR_SCORING,
      rosterSlots: league.rosterSlots,
      stakeTier: league.stakeTier,
      // Phase 4, Task 13: the SAME reasoning `read.ts`'s own `leagueHome` carries — straight off
      // the `league` row this function already read above, no new query.
      entryFeeCents: league.entryFeeCents,
      platformFeeCents: league.platformFeeCents,
      payoutTable: league.payoutTable,
      medianGame: league.medianGame,
      commissioner: {
        displayName: commissioner?.displayName ?? "Commissioner",
        avatarUrl: commissioner?.avatarUrl ?? null,
      },
      // Same never-true-in-production fallback as `league-service/read.ts`'s own `leagueHome`:
      // `drafts` is written in the same transaction as `leagues`.
      kickoffAt: draft?.kickoffAt.toISOString() ?? clock.now(),
      now: clock.now(),
      // Phase 3.5, Task 8 fix round 1 (review HIGH): a stranger reading the invite preview for an
      // unfilled `when_full` league must see the same fills-truth `leagueHome` shows a member,
      // never the placeholder `kickoffAt` above formatted as though it were a real time.
      startTrigger: draft?.startTrigger ?? "scheduled",
    }),
  };
}
