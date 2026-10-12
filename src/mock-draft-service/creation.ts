import { eq } from "drizzle-orm";
import { ensureMockBotRoster } from "@/data/seed/bot-roster";
import type { Db, DbTx } from "@research/db/client";
import { draftSlotPreferences, mockRooms, users } from "@/db/schema";
import type { AuditEvent, AuditEventInput } from "@/domain/audit";
import type { RosterShapeName } from "@research/domain/roster";
import type { ScoringPresetName } from "@research/domain/scoring";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import { generateInviteCode, LEAGUE_CONFIG } from "@/league";
import { writeLeagueInTx } from "@/league-service/creation";
import { MOCK_CONFIG, MOCK_COPY, type MockMode } from "@/mock-draft/config";
import type { MockLifecycleDeps } from "./claim";
import { seatBotsInTx, startMockDraft } from "./start";

/**
 * RULING 2's ONE SANCTIONED NO-OP — the only `AuditLogger` in this codebase that records
 * nothing, exported so a grep for `MOCK_NOOP_AUDIT` finds its every consumer (today: exactly
 * one, `createMockRoom`'s `writeLeagueInTx` call below).
 *
 * A mock league writes NOTHING to the audit chain, ever: no notice, no money, no anchor. That
 * carve-out is not a convenience — it is what makes the retention sweep's `DELETE FROM leagues`
 * (Task 6) legal against an audit spine whose `BEFORE DELETE` triggers refuse to lose a row,
 * because a mock never gives those triggers a row to defend. With no append there is no anchor
 * lock, so the anchor-last law is satisfied vacuously for every transaction this logger rides in.
 *
 * The synthetic `AuditEvent` it answers with is never persisted and never read —
 * `writeLeagueInTx` discards `record`'s return — it exists only to satisfy the interface without
 * a single database statement, proven by `creation.test.ts` handing it a transaction that throws
 * on any touch.
 */
export const MOCK_NOOP_AUDIT: AuditLogger = {
  record: async (_tx, input) => syntheticEvent(input),
  recordAll: async (_tx, inputs) => inputs.map(syntheticEvent),
};

function syntheticEvent(input: AuditEventInput): AuditEvent {
  return {
    ...input,
    eventId: "mock_noop",
    chainScope: input.leagueId ?? "",
    sequence: 0,
    previousEventHash: "",
    eventHash: "",
    hashVersion: 0,
  };
}

export interface CreateMockRoomInput {
  readonly hostUserId: string;
  readonly mode: MockMode;
  readonly teamCount: number;
  readonly pickSeconds: number;
  readonly scoringPreset: ScoringPresetName;
  readonly rosterShape: RosterShapeName;
  /** The host's team name; their profile display name when omitted, the join door's own rule. */
  readonly teamName?: string;
  /**
   * The host's own draft-position pick (founder directive 2026-08-26). `undefined` means
   * random — the same silence a member who never opens the real slot-preference panel leaves.
   * `createMockRoomSchema` (`./schemas`) already bounds this to `[1, teamCount]`, so this
   * function trusts it: a single-entry ranking, `[draftSlot]`, written for the host's team in
   * the SAME transaction that seats them, feeding the Kentucky Derby draw
   * (`assignDraftSlots`, `@/draft-service/order`) every draft's start already reads from.
   */
  readonly draftSlot?: number;
}

export type CreateMockRoomResult =
  | {
      readonly ok: true;
      readonly leagueId: string;
      /** The host's own team — seated in the creation transaction, `writeLeagueInTx`'s member-owner rule. */
      readonly teamId: string;
      readonly draftId: string;
      readonly shareCode: string;
      /** ISO instant the fill window fires (`now` for solo — it starts itself). */
      readonly startsAt: string;
    }
  | { readonly ok: false; readonly status: number; readonly reason: string };

const CREATE_FAILED = "We could not create that mock draft. Please try again.";

/**
 * The front door of the mock lane: one transaction that makes a practice room WHOLE — the bot
 * roster ensured, the league row (via the one league write shape this codebase has,
 * `writeLeagueInTx`, never a fork of it), the host's seat, the scheduled draft, the `mock_rooms`
 * sidecar, and (solo) every bot seat — or nothing at all.
 *
 * **How mock creation composes with `writeLeagueInTx`:** `isMock: true` with
 * `isPublicMatchmade: false` BY THE CHECK's law (`leagues_mock_private_ck` refuses any other
 * pairing at the database, which is what keeps every `ENFORCED_LEAGUE_SQL` consumer mock-free by
 * construction); free by construction (every fee field left to its zero default, so
 * `leagueMoneyOrRefuse` passes with no money read); snake-only this phase (the founder
 * self-ruling — auction practice waits for a phase that ships it); the tier gate never asked
 * (`tierJoinPrecondition` is `createLeague`'s door, guarding self-declared PUBLIC tiers — a
 * private practice room has no tier to abuse, the same reason the house factory walks past it);
 * and `MOCK_NOOP_AUDIT` above in the audit seat, ruling 2's carve-out. The host is the league's
 * commissioner by construction, so the existing manual-start door stays honest for `link` mode.
 *
 * **`botSeed` is drawn once and stored, never re-drawn** — `deps.newSeed()` at the edge — so the
 * room's entire bot behavior (which bots seat, their archetype deal, every pick) replays from
 * one stored number for a bug report or a test.
 *
 * **After commit, solo starts itself** through `startMockDraft` — and a failure there is NOT an
 * error surface: the transaction above already committed a coherent `'scheduled'` room, which is
 * exactly the shape the ticker's due scan (Task 6) exists to finish (`startsAt = now` for solo,
 * so the very next tick retries). Logged, swallowed, `ok: true` — status never lies, so the scan
 * always finds unfinished work.
 *
 * **Lock order:** `writeLeagueInTx`'s inserts create brand-new rows (a fresh UUID cannot be
 * contended); the only pre-existing rows touched are the `users` upserts (`ON CONFLICT DO
 * NOTHING`, a row nothing locks `FOR UPDATE`) and the host's `users` row via FK `KEY SHARE` —
 * no `leagues`/`drafts` lock on any row another transaction can hold, so this transaction
 * cannot join a cycle. The anchor law: vacuous, per `MOCK_NOOP_AUDIT` above.
 */
export async function createMockRoom(db: Db, input: CreateMockRoomInput, deps: MockLifecycleDeps): Promise<CreateMockRoomResult> {
  const now = deps.clock.now();
  const botSeed = deps.newSeed();
  const leagueId = deps.newId();
  const teamId = deps.newId();
  const draftId = deps.newId();
  // Solo starts NOW (it fills and fires in this same call); lobby and link open a fill window
  // the ticker's due scan will close. The draft's own kickoff is the same instant — invented
  // scheduling a mock's single-tier clock never reads (`loadDraftConfig`'s mock lane).
  const startsAt = new Date(Date.parse(now) + (input.mode === "solo" ? 0 : MOCK_CONFIG.fillWindowSeconds * 1000));
  let shareCode = "";

  try {
    await db.transaction(async (tx) => {
      // A fresh production database has never run `npm run seed` — the roster rides this same
      // transaction, so a room can never commit whose bots do not exist (Task 2's carry).
      await ensureMockBotRoster(tx);
      const [host] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.hostUserId));
      const outcome = await writeLeagueInTx(
        tx,
        { leagueId, teamId, draftId },
        {
          name: MOCK_COPY.roomName,
          format: "snake",
          teamCount: input.teamCount,
          scoringPreset: input.scoringPreset,
          auctionBudget: null,
          rosterShape: input.rosterShape,
          owner: { kind: "member", userId: input.hostUserId, teamName: input.teamName ?? host?.displayName ?? "New team" },
          // Never read for a mock: a private room is invisible to browse and exempt from the
          // tier wall (`enforcementAppliesTo` is public-only), so the declared tier can never
          // even in principle turn a claimant away.
          experienceTier: "experienced",
          stakeTier: 0,
          isPublicMatchmade: false,
          isMock: true,
        },
        startsAt,
        deps.clock,
        MOCK_NOOP_AUDIT,
      );
      // Unreachable for a fresh UUID (`createLeague`'s own reasoning for the same branch) —
      // thrown so an injected-id collision rolls the WHOLE room back rather than half-creating.
      if (!outcome.claimed) throw new Error(`createMockRoom: league id "${leagueId}" already exists.`);
      // Founder directive 2026-08-26: "users should be able to select their draft position."
      // The ONE preference row `assignDraftSlots` (`@/draft-service/order`) reads at start —
      // the same Kentucky Derby machinery a real league's `setSlotPreference`
      // (`@/draft-service/slot-preference`) writes, never a second mechanism. Written directly
      // here (not through `setSlotPreference` itself) because that function opens its OWN
      // transaction and re-derives `teamId`/`draftId` through a league-membership join this
      // creation transaction already holds as plain locals — calling it here would either nest
      // a transaction or read this not-yet-committed league back out through a second
      // connection. `setSlotPreference` remains the ONLY writer for every post-creation
      // re-pick (a real league's own panel); this is creation-time only, one ranking entry,
      // for the host's own fresh team, and holds for all three modes — the host picked their
      // own seat regardless of who else joins later.
      if (input.draftSlot !== undefined) {
        await tx.insert(draftSlotPreferences).values({ draftId, teamId, ranking: [input.draftSlot], updatedAt: new Date() });
      }
      shareCode = await insertRoomWithFreshCode(
        tx,
        { leagueId, hostUserId: input.hostUserId, mode: input.mode, pickSeconds: input.pickSeconds, botSeed, startsAt },
        deps.random,
      );
      if (input.mode === "solo") {
        await seatBotsInTx(tx, { leagueId, teamCount: input.teamCount, botSeed, newId: deps.newId });
      }
    });
  } catch (error: unknown) {
    // Plain language out, real detail into the logs — never raw driver text to a member.
    console.error("[mock-draft] create failed", { hostUserId: input.hostUserId, mode: input.mode }, error);
    return { ok: false, status: 500, reason: CREATE_FAILED };
  }

  if (input.mode === "solo") {
    try {
      const started = await startMockDraft(db, leagueId, deps);
      if (!started.ok) {
        console.error("[mock-draft] solo start deferred to the ticker", { leagueId, reason: started.reason });
      }
    } catch (error: unknown) {
      console.error("[mock-draft] solo start deferred to the ticker", { leagueId }, error);
    }
  }

  return { ok: true, leagueId, teamId, draftId, shareCode, startsAt: startsAt.toISOString() };
}

/**
 * Mints the room's share code the way `createInvite` mints an invite: `generateInviteCode`'s
 * short, unambiguous alphabet (no I, L, O, 0 or 1 — a code a person reads aloud), `ON CONFLICT
 * DO NOTHING` against the unique index, a bounded retry, and a loud failure that rolls the
 * caller's transaction back rather than committing a room nobody can reach.
 */
async function insertRoomWithFreshCode(
  tx: DbTx,
  room: {
    readonly leagueId: string;
    readonly hostUserId: string;
    readonly mode: MockMode;
    readonly pickSeconds: number;
    readonly botSeed: number;
    readonly startsAt: Date;
  },
  random: () => number,
): Promise<string> {
  for (let attempt = 0; attempt < LEAGUE_CONFIG.invite.maxCodeAttempts; attempt++) {
    const code = generateInviteCode(random);
    const inserted = await tx
      .insert(mockRooms)
      .values({ ...room, shareCode: code })
      .onConflictDoNothing({ target: mockRooms.shareCode })
      .returning({ leagueId: mockRooms.leagueId });
    if (inserted.length > 0) return code;
  }
  throw new Error("createMockRoom: could not mint an unused share code.");
}
