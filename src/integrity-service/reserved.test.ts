import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_EVENT_TYPES, type AuditEventType } from "@/domain/audit";

/**
 * Every event type is either published by this plan or reserved with a named consumer. A type in
 * neither column is the inert-deliverable class this loop keeps catching: a name in an enum with
 * no writer and no plan that will ever write one.
 *
 * `Record<AuditEventType, …>` and not a partial map: adding a type to the vocabulary without
 * deciding this is a TYPE ERROR, which is a better reminder than a review comment.
 */
const OWNER: Readonly<Record<AuditEventType, "plan-a" | "plan-b" | "plan-c" | "plan-d" | "phase-4">> = {
  league_created: "plan-a",
  member_joined: "plan-a",
  draft_pick: "plan-a",
  draft_completed: "plan-a",
  lineup_change: "plan-a",
  session_started: "plan-a",
  profile_updated: "plan-a",
  review_removed: "plan-a",
  system_action: "plan-a",
  // Task 5 lands the first (and, per this plan, the only) publisher: `acceptTrade`
  // (`src/league-service/trades.ts`), one `roster_move` event per accepted trade, batched
  // alongside `trade_accepted` on the league chain. Moved to "plan-a" territory the same way
  // `flag_raised`/`flag_resolved`/`admin_action` were — the value marks PUBLISHED, not "written
  // by Plan A" specifically.
  roster_move: "plan-a",
  // Task 3 lands the first publishers: `proposeTrade` and `settleProposal` (the shared
  // implementation behind `rejectTrade`/`withdrawTrade`), both in `src/league-service/trades.ts`.
  // Moved to "plan-a" territory the same way `flag_raised`/`flag_resolved`/`admin_action` were —
  // the value marks PUBLISHED, not "written by Plan A" specifically. Task 5 lands `trade_accepted`'s
  // own publisher, `acceptTrade`: `settleProposal` writes `trade_rejected` for BOTH the reject and
  // the withdraw outcome (`payload.outcome` tells them apart — `AUDIT_EVENT_TYPES` is frozen, so
  // there is no `trade_withdrawn` event type to reserve), and acceptance is `acceptTrade`'s own
  // event entirely.
  trade_proposed: "plan-a",
  trade_accepted: "plan-a",
  trade_rejected: "plan-a",
  // Task 2 lands the first publisher: `raiseFlag` (`src/integrity-service/flags.ts`), called from
  // system paths only (ruling 12) — Tasks 4, 6 and 9 are its three callers, and Plan C's
  // `TradeFairnessFlagService` on `TRADE_ACCEPTED`
  // (`docs/superpowers/plans/2026-08-20-phase3-overview.md`) is the fourth, into this same queue,
  // not a second one. Moved to "plan-a" territory the same way `admin_action` was in Task 1 — the
  // value marks PUBLISHED, not "written by Plan A" specifically.
  flag_raised: "plan-a",
  // Task 3 resolves what Task 2 raises and lands `flag_resolved`'s first (and only) publisher:
  // `resolveFlag` (`src/integrity-service/flags.ts`). Moved to "plan-a" territory the same way
  // `flag_raised` was in Task 2 — the value marks PUBLISHED, not "written by Plan A" specifically.
  flag_resolved: "plan-a",
  // Task 1 lands the first (and, per ruling 15, the ONLY) publisher: `grantAdmin`
  // (`src/integrity-service/flags.ts`), called exclusively from `scripts/grant-admin.ts` and from
  // the seed's own bootstrap grant. Moved to "plan-a" territory the same way this comment block
  // describes for `flag_raised` above — the value marks PUBLISHED, not "written by Plan A"
  // specifically, so the two checks below now hold this type to the same bar as every other
  // published type: a real writer must exist, and no OTHER reserved type may gain one by accident.
  admin_action: "plan-a",
  // Phase 4 (money foundations), ruling 2: the ten money events, RESERVED with named consumers —
  // Task 2 grows the vocabulary (migration 0036) and the publishers land later in the same plan.
  // Each moves to "plan-a" territory in the task that lands its writer, exactly the way
  // `flag_raised`/`roster_move` did above — the value marks PUBLISHED, not which phase wrote it.
  // The "no publisher anywhere" check below is what keeps these honest in the meantime: a money
  // writer landing without flipping its row here reddens this file, not just a review comment.
  // Task 5 landed both deposit publishers (`recordDepositCompleted`/`recordDepositReturned`,
  // `@/money-service/deposits`) — flipped exactly as the block comment above prescribes: the
  // value marks PUBLISHED, and the writer's landing is what reddened this row until it moved.
  deposit_completed: "plan-a", // Task 5, `@/money-service/deposits`
  deposit_returned: "plan-a", // Task 5, `@/money-service/deposits` (the ACH-return posting)
  // Task 6 landed all three withdrawal publishers (`@/money-service/withdrawals`) but this row was
  // never flipped from "phase-4" — found and fixed here, in Task 7's fix round, while this file's
  // own "no publisher anywhere" check was made to actually run again (it had gone unexercised for
  // these three the same way an unflipped row always does: silently, since the check only fires
  // for rows NOT marked "plan-a").
  withdrawal_requested: "plan-a", // Task 6, `@/money-service/withdrawals`
  withdrawal_completed: "plan-a", // Task 6, `@/money-service/withdrawals`
  withdrawal_returned: "plan-a", // Task 6, `@/money-service/withdrawals`
  entry_fee_collected: "phase-4", // Task 8, `@/money-service/entry-fee`, inside joinLeagueInTx
  entry_fee_refunded: "phase-4", // Task 8 (seat release) and Task 9 (`@/money-service/dissolution`)
  prize_paid: "phase-4", // Task 10, `@/money-service/settlement`
  payout_held: "phase-4", // Task 10, `@/money-service/settlement`
  payout_released: "phase-4", // Task 10, `@/money-service/settlement`'s releaseHold
  // Task 7's fix round: the same T2 pattern above (grow the enum, name the plan), except the
  // publisher lands in the SAME pass as the growth — migration 0039 and these three writers ship
  // together, so each moves straight to "plan-a" (PUBLISHED) rather than sitting at "phase-4"
  // first. `has NO publisher anywhere` below would fail these entries "phase-4" the moment the
  // writer landed, exactly the mechanism the block comment above describes.
  self_exclusion_set: "plan-a", // Task 7, `@/money-service/exclusion` (`setSelfExclusion`)
  self_exclusion_cleared: "plan-a", // Task 7, `@/money-service/exclusion` (`clearSelfExclusion`)
  kyc_status_changed: "plan-a", // Task 7, `@/money-service/kyc` (`submitKycVerification`)
};

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/**
 * Files this scan must not read as production, whatever their extension.
 *
 * `*.test.ts` was the only exclusion, which let about twenty-two TEST-SUPPORT files count as
 * evidence of production publishing — `src/integrity-service/test-support.ts` among them, whose
 * own docblock reads "Test-only: nothing under `src/**` outside a `*.test.ts` may import this".
 * Both halves of this file's claim were exposed by that: a Plan C seed helper naming a reserved
 * type would fail the reserved check for the wrong reason, and a Plan A fixture would satisfy the
 * publisher check without a real publisher existing anywhere.
 */
const NOT_PRODUCTION = [/\.test\.tsx?$/, /(?:^|[.-])test-support\.tsx?$/, /(?:^|[.-])test-fixtures\.tsx?$/, /(?:^|[.-])test-db\.tsx?$/, /(?:^|[.-])test-utils\.tsx?$/];

/**
 * Every `.ts`/`.tsx` file under `dir`, RECURSIVELY, production only — the same shape as
 * `advisory-only.test.ts`'s `sourceFiles` (`@/ai-advisor/advisory-only.test.ts`). Test and
 * test-support files are excluded because a type "published" only by a fixture is not published:
 * the grep below is what tells a real writer apart from a lone assertion pinning the string.
 */
function walk(dir: string): readonly SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.tsx?$/.test(entry.name) || NOT_PRODUCTION.some((pattern) => pattern.test(entry.name))) return [];
    return [{ path: full, text: readFileSync(full, "utf8") }];
  });
}

/**
 * Reads every non-test source file under the given repo-root-relative directories. Two
 * directories, not one: `system_action`'s one real publisher is `scripts/verify-audit-chain.ts`
 * (Task 3/4's operator script, `recordDetection`) — it is genuinely this repo's production code,
 * it is just outside `src/` because it is a CLI entry point rather than an importable module, the
 * same reason `scripts/remove-review.ts` sits next to it. A grep that only looked in `src` would
 * make this test assert a falsehood about the one Plan-A-owned type that isn't part of the eight
 * wired in the ordinary write path.
 */
async function readAllSource(...dirs: readonly string[]): Promise<readonly SourceFile[]> {
  return dirs.flatMap((dir) => walk(join(process.cwd(), dir)));
}

describe("the audit vocabulary", () => {
  it("assigns every declared type to a plan", () => {
    expect(Object.keys(OWNER).sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
  });

  it("has a real publisher in this repo for every type Plan A owns", async () => {
    // Greps the source rather than the tests: a type "published" only by a test is not published.
    const source = await readAllSource("src", "scripts");
    for (const [type, owner] of Object.entries(OWNER)) {
      if (owner !== "plan-a") continue;
      expect(source.filter((file) => file.text.includes(`eventType: "${type}"`)).length).toBeGreaterThan(0);
    }
  });

  it("reserves every type Plan A does not publish, and reserves nothing it does", () => {
    // The count this used to assert was a hardcoded 7 compared against the table two lines above,
    // which could only ever fail when somebody edited that table by hand — a test named for a
    // property about PUBLISHERS that asserted nothing about publishers. Derived instead: the
    // reserved set is exactly the vocabulary minus the types Plan A owns, so Plan B landing
    // `flag_raised` moves one name across and needs no number edited anywhere.
    const planA = (Object.keys(OWNER) as readonly AuditEventType[]).filter((type) => OWNER[type] === "plan-a");
    const reserved = (Object.keys(OWNER) as readonly AuditEventType[]).filter((type) => OWNER[type] !== "plan-a");
    expect([...planA, ...reserved].sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
    expect(reserved.filter((type) => planA.includes(type))).toEqual([]);
    expect(reserved.length).toBe(AUDIT_EVENT_TYPES.length - planA.length);
  });

  it("reads no test-support file as production evidence, in either direction", async () => {
    // The exclusion above, asserted rather than trusted: this file's whole claim rests on the
    // scan seeing production and only production.
    const scanned = await readAllSource("src", "scripts");
    expect(scanned.length).toBeGreaterThan(0);
    for (const file of scanned) {
      expect(file.path).not.toMatch(/test-support|test-fixtures|test-db|test-utils|\.test\./);
    }
    // And the exclusion is not vacuous: these files really are there, and really do sit under a
    // directory the scan walks.
    expect(existsSync(join(process.cwd(), "src/integrity-service/test-support.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src/db/test-db.ts"))).toBe(true);
  });

  it("has NO publisher anywhere in this repo for a type reserved to another plan", async () => {
    // The mirror of the Plan A check above: a reserved name showing up in a real `eventType: "…"`
    // write is a later plan's publisher landing here, which means this table (and the count
    // above) is stale, not that the guard is broken.
    const source = await readAllSource("src", "scripts");
    for (const [type, owner] of Object.entries(OWNER)) {
      if (owner === "plan-a") continue;
      expect(source.filter((file) => file.text.includes(`eventType: "${type}"`)).length).toBe(0);
    }
  });

  // Phase 3 Plan D, Task 11, Step 5. Phase 3 ends here. A reserved audit event type with a named
  // owner is honest while the owner is coming; after the last plan it is a name with no writer
  // and no plan that will ever write one. Every one of Phase 3's sixteen `AUDIT_EVENT_TYPES` is
  // published (their `OWNER` values above are all "plan-a" — Plan D adds no new event TYPE,
  // ruling 7: `SYSTEM_ACTION_CODES` is the vocabulary this plan grows instead, a plain array with
  // no database representation), and this assertion is what keeps a future reader from adding a
  // seventeenth "for Plan D". Phase 4's ten money events reserve to "phase-4" (its ruling 2, a
  // phase-level decision with its own migration), which leaves this assertion exactly as true.
  it("leaves the plan-d arm of OWNER unused, because there is no plan after this one", () => {
    expect(Object.values(OWNER)).not.toContain("plan-d");
  });
});
