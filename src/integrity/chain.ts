import { createHash } from "node:crypto";
import type { AuditEvent, AuditEventInput } from "@/domain/audit";
import { canonicalSerialize } from "./canonical";
import { INTEGRITY_CONFIG } from "./config";

export const GENESIS_HASH = INTEGRITY_CONFIG.chain.genesisHash;

/** The head of one chain: what the next event links to. Stored as the `audit_chains` row. */
export interface ChainAnchor {
  readonly headSequence: number;
  readonly headHash: string;
}

/** Exactly the fields that go into the digest. Nothing else about an event is hashed. */
export type HashableEvent = Omit<AuditEvent, "eventHash">;
export type HashFn = (event: HashableEvent) => string;

/**
 * Which chain an event belongs to. Derived from the league id and never passed in, so a caller
 * cannot put a league's event on the platform chain (or a stranger's league's chain) by accident.
 */
export function scopeFor(leagueId: string | null): string {
  return leagueId ?? INTEGRITY_CONFIG.chain.platformScope;
}

/**
 * The RFC 3339 / ISO-8601 instant shapes this system accepts: a date, a time, optional
 * fractional seconds, and either `Z` or a numeric offset. Anything else — "last tuesday", a bare
 * date, a duration — is rejected before any calendar arithmetic runs.
 */
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The instant, spelled the one way a `timestamptz` read back from Postgres spells it: UTC, three
 * fractional digits, `Z`. The hash is taken over this, so a caller passing `+02:00` or
 * microseconds produces a row that still verifies. Without it, verification would fail on a row
 * nobody could explain, weeks after the write.
 *
 * `Date.parse` alone is not enough: it silently rolls a calendar-invalid date forward (2026-02-30
 * becomes 2026-03-02) instead of rejecting it, which would hash a timestamp that differs from
 * what the caller actually stated — the exact failure ruling 25 exists to prevent. This function
 * re-derives the year/month/day/hour/minute/second the caller literally wrote and checks they
 * round-trip through `Date.UTC` unchanged; a date that overflows in that round trip (a 30th of
 * February, a 24th hour) never comes back out the same, so it throws instead of silently hashing
 * the rolled-forward instant.
 */
export function normalizeInstant(iso: string): string {
  const match = INSTANT_PATTERN.exec(iso);
  if (!match) throw new Error(`Audit event time "${iso}" is not a valid instant.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const roundTripped = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const isCalendarValid =
    roundTripped.getUTCFullYear() === year &&
    roundTripped.getUTCMonth() === month - 1 &&
    roundTripped.getUTCDate() === day &&
    roundTripped.getUTCHours() === hour &&
    roundTripped.getUTCMinutes() === minute &&
    roundTripped.getUTCSeconds() === second;
  if (!isCalendarValid) throw new Error(`Audit event time "${iso}" is not a valid instant.`);
  return new Date(Date.parse(iso)).toISOString();
}

export function computeEventHash(event: HashableEvent): string {
  const canonical = canonicalSerialize({
    actorId: event.actorId,
    actorType: event.actorType,
    chainScope: event.chainScope,
    eventId: event.eventId,
    eventType: event.eventType,
    hashVersion: event.hashVersion,
    leagueId: event.leagueId,
    occurredAt: event.occurredAt,
    payload: event.payload,
    previousEventHash: event.previousEventHash,
    sequence: event.sequence,
  });
  return createHash(INTEGRITY_CONFIG.chain.hashAlgorithm).update(canonical, "utf8").digest("hex");
}

/** Turns an input plus a chain head into the row that will be stored. The only writer's helper. */
export function linkEvent(input: AuditEventInput, anchor: ChainAnchor, eventId: string): AuditEvent {
  const hashable: HashableEvent = {
    eventId,
    chainScope: scopeFor(input.leagueId),
    sequence: anchor.headSequence + 1,
    eventType: input.eventType,
    actorId: input.actorId,
    actorType: input.actorType,
    leagueId: input.leagueId,
    payload: input.payload,
    occurredAt: normalizeInstant(input.occurredAt),
    previousEventHash: anchor.headHash,
    hashVersion: INTEGRITY_CONFIG.chain.hashVersion,
  };
  return { ...hashable, eventHash: computeEventHash(hashable) };
}

/**
 * `checkpoint_mismatch` is never returned by `verifyLinkedRun` — it is emitted by Task 4's
 * service-level verifier when the row a checkpoint claims to have verified no longer hashes to
 * what the checkpoint recorded. It lives in this union so there is one vocabulary for "how the
 * chain is broken" rather than two.
 */
export type ChainBreakReason = "sequence_gap" | "link_mismatch" | "hash_mismatch" | "version_mismatch" | "checkpoint_mismatch";

export interface ChainBreak {
  readonly reason: ChainBreakReason;
  readonly eventId: string;
  readonly sequence: number;
}

export type RunVerification =
  | { readonly valid: true; readonly hashed: number; readonly through: ChainAnchor }
  | { readonly valid: false; readonly hashed: number; readonly break: ChainBreak };

/**
 * Walks a contiguous run of events forward from a known-good anchor. Pure: the caller decides
 * where the run came from (a checkpoint, or genesis) and how big it is.
 *
 * `hash` is injected so the incremental-verification test can COUNT the work (Task 4's spec
 * requirement). It defaults to the real function, so no production call site passes it.
 */
export function verifyLinkedRun(events: readonly AuditEvent[], from: ChainAnchor, hash: HashFn = computeEventHash): RunVerification {
  let anchor = from;
  let hashed = 0;
  for (const event of events) {
    if (event.hashVersion !== INTEGRITY_CONFIG.chain.hashVersion) {
      return { valid: false, hashed, break: { reason: "version_mismatch", eventId: event.eventId, sequence: event.sequence } };
    }
    if (event.sequence !== anchor.headSequence + 1) {
      return { valid: false, hashed, break: { reason: "sequence_gap", eventId: event.eventId, sequence: event.sequence } };
    }
    if (event.previousEventHash !== anchor.headHash) {
      return { valid: false, hashed, break: { reason: "link_mismatch", eventId: event.eventId, sequence: event.sequence } };
    }
    const recomputed = hash(event);
    hashed += 1;
    if (recomputed !== event.eventHash) {
      return { valid: false, hashed, break: { reason: "hash_mismatch", eventId: event.eventId, sequence: event.sequence } };
    }
    anchor = { headSequence: event.sequence, headHash: event.eventHash };
  }
  return { valid: true, hashed, through: anchor };
}
