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
const OWNER: Readonly<Record<AuditEventType, "plan-a" | "plan-b" | "plan-c" | "plan-d">> = {
  league_created: "plan-a",
  member_joined: "plan-a",
  draft_pick: "plan-a",
  draft_completed: "plan-a",
  lineup_change: "plan-a",
  session_started: "plan-a",
  profile_updated: "plan-a",
  review_removed: "plan-a",
  system_action: "plan-a",
  roster_move: "plan-c",
  trade_proposed: "plan-c",
  trade_accepted: "plan-c",
  trade_rejected: "plan-c",
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
});
