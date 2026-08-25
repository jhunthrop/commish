/**
 * The audit vocabulary, as a runtime array with the union derived from it — the same shape
 * `REALTIME_EVENT_TYPES` uses, and for the same reason: the pg enum, the visibility record and
 * the reserved-consumer test all iterate it, and a union declared separately from its list is
 * two things to keep in step.
 *
 * SPELLING. The spec (`plans/phase-3-trust-and-integrity.md` Step 1) writes these in
 * SCREAMING_SNAKE. Every enum shipped in `src/db/schema.ts` is lowercase snake_case, and the
 * phase overview already ruled the same way once ("the shipped spelling wins", on
 * beginner/experienced vs NEW/EXPERIENCED). The mapping is one-to-one and mechanical.
 */
export const AUDIT_EVENT_TYPES = [
  /** Published by Plan A. */
  "league_created",
  /** Published by Plan A, from BOTH doors into a league (invite accept and public join). */
  "member_joined",
  /** Published by Plan A. `actorType: "system"` when the clock ran out and the queue picked. */
  "draft_pick",
  /** Published by Plan A, at the transaction that turns a finished draft into a season. */
  "draft_completed",
  /** Published by Plan A, from `setLineup` — the product's only member-facing roster write. */
  "lineup_change",
  /**
   * A roster change that is NEITHER a draft pick NOR a lineup change. Today that means exactly
   * one thing: the player transfer a trade performs. There is no free agency in this product,
   * no waivers and no add/drop, so nothing else can produce one. PUBLISHED by Plan C, from
   * `acceptTrade`'s own transfer and from `reverseTradeInTx`'s compensating one.
   */
  "roster_move",
  /** PUBLISHED by Plan C, from the trade lifecycle it built. `trade_rejected` carries a
   *  withdrawal too — `payload.outcome` tells the two apart, because this list is frozen. */
  "trade_proposed",
  "trade_accepted",
  "trade_rejected",
  /** RESERVED — Plan B publishes these two, from its detector and its resolution action. */
  "flag_raised",
  "flag_resolved",
  /** Published by Plan B (Task 1), from `grantAdmin`'s transaction (`@/integrity-service/flags`). */
  "admin_action",
  /**
   * The platform acting on its own. Plan A publishes exactly one kind (a failed chain
   * verification); Plan D's enforcement policy is what makes it common.
   */
  "system_action",
  /** Published by Plan A, at `/callback`. Carries no IP and no device signal — see ruling 20. */
  "session_started",
  /** Published by Plan A, from the profile write path. */
  "profile_updated",
  /** Published by Plan A, from the review removal stamp. */
  "review_removed",
  /*
   * Phase 4 (money foundations), ruling 2: the ten money events. Phase 3 froze this list and
   * Phase 3.6 honored the freeze via payload outcomes; money is the one addition that clears the
   * bar for growing it — a new event CLASS, not an outcome of an existing type, and the class an
   * auditor of a real-money book reads FIRST. Shipped in their own migration
   * (`drizzle/0036_money_audit_events.sql`, `ALTER TYPE … ADD VALUE`), separate from the tables'
   * `0035` because an added enum value must not be used by the migration that adds it.
   *
   * The dossier named eight; the shipped list is ten. `deposit_returned` and
   * `withdrawal_returned` are added because the ACH return is this plan's mandatory failure
   * model, and a reversal riding a `*_completed` payload would hide the one event an auditor
   * most wants to find behind the event that says the opposite.
   *
   * PLATFORM-SCOPED (the deposit/withdrawal five): a member's own money motion is nobody else's
   * feed. LEAGUE-SCOPED (the entry-fee/prize/payout five): they ride the league chain, beside
   * the joins and trades they pay for.
   */
  /** Published by Task 6 (`@/money-service/deposits`), when the provider settles a deposit. */
  "deposit_completed",
  /** Published by Task 6 (`@/money-service/deposits`), from the ACH-return posting — including
   *  ruling 5's shortfall path to `platform_receivable`. Platform-scoped. */
  "deposit_returned",
  /** Published by Task 6 (`@/money-service/withdrawals`), at the member's own request. */
  "withdrawal_requested",
  /** Published by Task 6 (`@/money-service/withdrawals`), when the provider settles it. */
  "withdrawal_completed",
  /** Published by Task 6 (`@/money-service/withdrawals`), when a sent withdrawal comes back. */
  "withdrawal_returned",
  /** Published by Task 8 (`@/money-service/entry-fee`), inside `joinLeagueInTx`'s own
   *  transaction. League-scoped: the fee is the league's own record of who paid in. */
  "entry_fee_collected",
  /** Published by Task 8 (`@/money-service/entry-fee`, seat release) and Task 9
   *  (`@/money-service/dissolution`, every seat at once). League-scoped. */
  "entry_fee_refunded",
  /** Published by Task 10 (`@/money-service/settlement`), one per prize-table row paid. */
  "prize_paid",
  /** Published by Task 10 (`@/money-service/settlement`), when an open integrity flag moves a
   *  winner's payout to `held_for_review` instead of `user_available`. League-scoped. */
  "payout_held",
  /** Published by Task 10 (`@/money-service/settlement`'s `releaseHold`), when the flag resolves
   *  in the member's favor. Confiscation is the same writer's other arm, recorded on the flag's
   *  own resolution — the hold's release is the event the LEAGUE is owed sight of. */
  "payout_released",
  /**
   * Task 7's fix round: three more events, the phase's SECOND vocabulary growth (ruling 2 again —
   * a person's own compliance history is exactly the class of fact ruling 2 already carved out an
   * exception for, and it is auditable the same way a dollar is). Own migration
   * (`drizzle/0039_kyc_and_exclusion_audit_events.sql`, `ALTER TYPE … ADD VALUE`), for the same
   * reason 0036 is its own migration: an added enum value must not be used by a statement inside
   * the migration that adds it. All three are PLATFORM-SCOPED and HIDDEN from every member-facing
   * activity feed (`src/integrity/activity-view.ts`'s `ACTIVITY_VISIBILITY`, controller ruling):
   * whether and how a person verified their identity, and whether they closed their own account to
   * paid play, are that person's own private facts — nobody's league feed, operator console only.
   */
  /** Published by `setSelfExclusion` (`@/money-service/exclusion`), ONLY on the branch that
   *  actually stamps `self_excluded_at` — the idempotent already-set repeat call stays audit-free
   *  (`grantAdmin`'s own "no event for a no-op" precedent). */
  "self_exclusion_set",
  /** Published by `clearSelfExclusion` (`@/money-service/exclusion`), operator-only from the admin
   *  room. REPLACES the `admin_action` event this writer used to append before this fix round — no
   *  prior `admin_action` row from this writer exists in any real data, so the replacement is
   *  clean, and a clear now reads as its own named fact on the chain rather than a generic one. */
  "self_exclusion_cleared",
  /** Published by `submitKycVerification` (`@/money-service/kyc`), ONLY when the write actually
   *  changes `users.kyc_status` — a re-submission that lands on the SAME status (or one the
   *  guarded write refuses because the member is already `verified`) appends nothing. */
  "kyc_status_changed",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Who did it. `system` means the platform, and the audit row looks otherwise identical. */
export type AuditActorType = "user" | "system";

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** One row of the chain, exactly as it is stored and exactly as it is hashed. */
export interface AuditEvent {
  readonly eventId: string;
  /** Which chain this row belongs to: a league id, or `INTEGRITY_CONFIG.chain.platformScope`. */
  readonly chainScope: string;
  /** 1-based position in this chain. Unique per scope at the database level. */
  readonly sequence: number;
  readonly eventType: AuditEventType;
  /** Null only when `actorType` is `"system"`. */
  readonly actorId: string | null;
  readonly actorType: AuditActorType;
  /** Null for a platform-scoped event. Never a foreign key — see ruling 7. */
  readonly leagueId: string | null;
  readonly payload: JsonObject;
  /** ISO-8601, normalized to UTC milliseconds by `normalizeInstant` before it is hashed. */
  readonly occurredAt: string;
  readonly previousEventHash: string;
  readonly eventHash: string;
  readonly hashVersion: number;
}

/**
 * What a caller supplies. `chainScope`, `sequence`, `previousEventHash`, `eventHash`,
 * `hashVersion` and `eventId` are all decided by `AuditLogger` — a caller that could choose its
 * own scope could put a league's event on the platform chain by accident, and a caller that
 * could choose its own hash could put anything anywhere.
 */
export interface AuditEventInput {
  readonly eventType: AuditEventType;
  readonly actorId: string | null;
  readonly actorType: AuditActorType;
  readonly leagueId: string | null;
  readonly payload: JsonObject;
  readonly occurredAt: string;
}
