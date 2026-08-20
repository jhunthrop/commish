import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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
  flag_raised: "plan-b",
  flag_resolved: "plan-b",
  admin_action: "plan-b",
};

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/**
 * Every `.ts`/`.tsx` file under `dir`, RECURSIVELY, non-test — the same shape as
 * `advisory-only.test.ts`'s `sourceFiles` (`@/ai-advisor/advisory-only.test.ts`). Test files are
 * excluded because a type "published" only inside a `*.test.ts` is not published — the grep
 * below is what tells a real writer apart from a lone assertion pinning the string.
 */
function walk(dir: string): readonly SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
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

  it("has NO publisher yet for a reserved type, which is the point of reserving it", () => {
    // If this fails, a later plan landed its publisher here and this table needs updating —
    // the same shape `score.update` had while it sat reserved through Phase 1.
    expect(Object.values(OWNER).filter((owner) => owner !== "plan-a").length).toBe(7);
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
