import { describe, expect, it, vi } from "vitest";
import type { AuditEvent, AuditEventInput } from "@/domain/audit";
import { INTEGRITY_CONFIG } from "./config";
import { GENESIS_HASH, computeEventHash, linkEvent, normalizeInstant, scopeFor, verifyLinkedRun } from "./chain";

const AT = "2026-08-20T17:00:00.000Z";

const input = (over: Partial<AuditEventInput> = {}): AuditEventInput => ({
  eventType: "league_created",
  actorId: "user_alice",
  actorType: "user",
  leagueId: "league_1",
  payload: { name: "Sunday Money", teamCount: 12 },
  occurredAt: AT,
  ...over,
});

describe("scopeFor", () => {
  it("is the league for a league event and the reserved platform id otherwise", () => {
    expect(scopeFor("league_1")).toBe("league_1");
    expect(scopeFor(null)).toBe(INTEGRITY_CONFIG.chain.platformScope);
  });
});

describe("normalizeInstant", () => {
  it("normalizes to UTC milliseconds, which is exactly what timestamptz gives back", () => {
    // The hash is taken over the NORMALIZED string, so `occurred_at` read back out of Postgres
    // re-hashes to the stored digest. An offset spelling or microsecond precision would not.
    expect(normalizeInstant("2026-08-20T19:00:00+02:00")).toBe("2026-08-20T17:00:00.000Z");
    expect(normalizeInstant("2026-08-20T17:00:00.123456Z")).toBe("2026-08-20T17:00:00.123Z");
    expect(normalizeInstant(AT)).toBe(AT);
  });

  it("refuses a string that is not an instant, rather than hashing Invalid Date", () => {
    expect(() => normalizeInstant("last tuesday")).toThrow(/not a valid instant/);
  });

  it("refuses a calendar-invalid date rather than silently rolling it forward", () => {
    // The JS `Date` constructor rolls 2026-02-30 forward into 2026-03-02 rather than rejecting
    // it (2026 is not a leap year, so February has 28 days). Hashing that silent roll-forward
    // would store a timestamp the caller never stated — ruling 25 exists to prevent exactly this.
    expect(() => normalizeInstant("2026-02-30T00:00:00.000Z")).toThrow(/not a valid instant/);
  });

  it("accepts a genuine leap day", () => {
    // 2028 IS a leap year (divisible by 4, not by 100), so February 29th is a real calendar date
    // and must round-trip unchanged rather than being caught by the same guard as 2026-02-30.
    expect(normalizeInstant("2028-02-29T00:00:00.000Z")).toBe("2028-02-29T00:00:00.000Z");
  });
});

describe("computeEventHash", () => {
  it("matches a pinned vector, so a refactor cannot silently change the canonical form", () => {
    // Pinned, not computed by the test: if this value changes, every chain in every database
    // stops verifying, and that has to be a deliberate `hashVersion` bump rather than a diff
    // nobody noticed. Recomputed from the documented canonical form in the plan.
    expect(
      computeEventHash({
        eventId: "evt_1",
        chainScope: "league_1",
        sequence: 1,
        eventType: "league_created",
        actorId: "user_alice",
        actorType: "user",
        leagueId: "league_1",
        payload: { name: "Sunday Money", teamCount: 12 },
        occurredAt: AT,
        previousEventHash: GENESIS_HASH,
        hashVersion: INTEGRITY_CONFIG.chain.hashVersion,
      }),
    ).toBe("8be562573461ecdf41a002e65a8096536f813d05c0a779a0bef462575ce1ccfd");
  });

  it("changes when any hashed field changes", () => {
    const base = linkEvent(input(), { headSequence: 0, headHash: GENESIS_HASH }, "evt_1");
    for (const mutated of [
      // Every field HashableEvent carries, so this test's claim ("any hashed field") is complete
      // rather than a subset a future field could silently fall outside of.
      { ...base, actorId: "user_mallory" },
      { ...base, actorType: "system" as const },
      { ...base, chainScope: "league_2" },
      { ...base, eventId: "evt_2" },
      { ...base, eventType: "member_joined" as const },
      { ...base, hashVersion: 2 },
      { ...base, leagueId: "league_2" },
      { ...base, occurredAt: "2026-08-20T17:00:00.001Z" },
      { ...base, payload: { name: "Sunday Money", teamCount: 13 } },
      { ...base, previousEventHash: GENESIS_HASH.replace("3", "4") },
      { ...base, sequence: 2 },
    ]) {
      expect(computeEventHash(mutated)).not.toBe(base.eventHash);
    }
  });
});

describe("linkEvent", () => {
  it("starts a chain at sequence 1 with the genesis hash behind it", () => {
    const first = linkEvent(input(), { headSequence: 0, headHash: GENESIS_HASH }, "evt_1");
    expect(first.sequence).toBe(1);
    expect(first.previousEventHash).toBe(GENESIS_HASH);
    expect(first.chainScope).toBe("league_1");
    expect(first.hashVersion).toBe(INTEGRITY_CONFIG.chain.hashVersion);
  });

  it("links the next event to the one before it", () => {
    const first = linkEvent(input(), { headSequence: 0, headHash: GENESIS_HASH }, "evt_1");
    const second = linkEvent(input({ eventType: "member_joined" }), { headSequence: first.sequence, headHash: first.eventHash }, "evt_2");
    expect(second.sequence).toBe(2);
    expect(second.previousEventHash).toBe(first.eventHash);
  });

  it("normalizes the instant it was given, so what is hashed is what is stored", () => {
    const event = linkEvent(input({ occurredAt: "2026-08-20T19:00:00+02:00" }), { headSequence: 0, headHash: GENESIS_HASH }, "evt_1");
    expect(event.occurredAt).toBe(AT);
  });
});

describe("verifyLinkedRun", () => {
  const chain = (count: number): readonly AuditEvent[] => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < count; i += 1) {
      const head = events[i - 1];
      events.push(linkEvent(input(), { headSequence: head?.sequence ?? 0, headHash: head?.eventHash ?? GENESIS_HASH }, `evt_${i + 1}`));
    }
    return events;
  };

  it("accepts an empty run and reports the anchor unchanged", () => {
    const result = verifyLinkedRun([], { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toEqual({ valid: true, hashed: 0, through: { headSequence: 0, headHash: GENESIS_HASH } });
  });

  it("accepts an honest run and reports its new head", () => {
    const events = chain(3);
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toEqual({ valid: true, hashed: 3, through: { headSequence: 3, headHash: events[2]!.eventHash } });
  });

  it("catches an edited payload at the row it was edited on", () => {
    const events = [...chain(3)];
    events[1] = { ...events[1]!, payload: { name: "Sunday Money", teamCount: 99 } };
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toEqual({
      valid: false,
      hashed: 2,
      break: { reason: "hash_mismatch", eventId: "evt_2", sequence: 2 },
    });
  });

  it("catches a row whose stored hash was rewritten to match its edited payload", () => {
    // The interesting tamper: the attacker recomputed the row's OWN hash, so `hash_mismatch`
    // passes. The link to the next row is what fails, which is the entire point of a chain.
    const events = [...chain(3)];
    const forged = { ...events[1]!, payload: { name: "Sunday Money", teamCount: 99 } };
    events[1] = { ...forged, eventHash: computeEventHash(forged) };
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH });
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ break: { reason: "link_mismatch", eventId: "evt_3", sequence: 3 } });
  });

  it("catches a deleted row as a sequence gap", () => {
    const events = chain(3);
    const result = verifyLinkedRun([events[0]!, events[2]!], { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toMatchObject({ break: { reason: "sequence_gap", eventId: "evt_3", sequence: 3 } });
  });

  it("catches a row written under a hash version this build does not implement", () => {
    const events = [...chain(1)];
    events[0] = { ...events[0]!, hashVersion: 99 };
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toMatchObject({ break: { reason: "version_mismatch", eventId: "evt_1", sequence: 1 } });
  });

  it("stops hashing at the first break instead of walking the rest", () => {
    const events = [...chain(5)];
    events[1] = { ...events[1]!, payload: { tampered: true } };
    const hash = vi.fn(computeEventHash);
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH }, hash);
    expect(result.valid).toBe(false);
    expect(hash).toHaveBeenCalledTimes(2);
  });
});
