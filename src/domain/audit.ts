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
   * no waivers and no add/drop, so nothing else can produce one. RESERVED — Plan C publishes it.
   */
  "roster_move",
  /** RESERVED — Plan C publishes these three, from the trade lifecycle it builds. */
  "trade_proposed",
  "trade_accepted",
  "trade_rejected",
  /** RESERVED — Plan B publishes these two, from its detector and its resolution action. */
  "flag_raised",
  "flag_resolved",
  /** RESERVED — Plan B publishes this, from the admin surface it builds. */
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
