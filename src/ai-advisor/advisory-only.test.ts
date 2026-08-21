import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ReadonlyDb } from "@/db/client";

const ADVISOR_DIR = join(process.cwd(), "src", "ai-advisor");

/**
 * Every way a module in this repo mutates roster, lineup, trade or scoring state. If the
 * advisor ever acquires one of these, this test fails — which is the point.
 */
const WRITE_PATTERNS = [
  ".insert(",
  ".update(",
  ".delete(",
  ".transaction(",
  "setLineup",
  "finalizeWeek",
  "applyAction",
  "commitDraft",
  "acceptInvite",
  // Phase 3 Plan C: a trade EXISTS now. The advisor assembles both sides of one and returns a
  // verdict about it, which is exactly one import away from executing it, and this list is what
  // keeps that import from compiling unnoticed. `setLineup`, `commitDraft` and `acceptInvite`
  // were added for the same reason when each of those became reachable.
  "acceptTrade",
  "executeTrade",
  "applyTradeInTx",
] as const;

/**
 * Every source file under `src/ai-advisor`, RECURSIVELY and with no name carve-outs — the two
 * holes this scan used to have. A non-recursive `readdirSync` left any future
 * `src/ai-advisor/<subdir>/` unscanned, and excluding `test-support.ts` by name was a hole any
 * file could be renamed into. Test files are excluded because they are the thing doing the
 * checking; nothing else is, which is why the advisor's DB fixture now lives with the
 * league-service fixtures it is built from rather than inside the directory under audit.
 *
 * Paths are returned relative to the advisor directory so an offender names its subdirectory.
 */
function sourceFiles(dir: string = ADVISOR_DIR): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [relative(ADVISOR_DIR, full)];
  });
}

describe("the advisor is advisory-only", () => {
  /**
   * The PRIMARY guard is the type, not this file: `assembleAdvisorContext` takes a
   * `ReadonlyDb`, so a write anywhere down its call path fails to compile. This line pins that
   * — if `ReadonlyDb` ever grows a write verb, the `@ts-expect-error` becomes unused and `tsc`
   * fails. Everything below it is defense in depth.
   */
  it("cannot be typed with a write verb at all", () => {
    // @ts-expect-error `insert` does not exist on `ReadonlyDb`, which is the whole point.
    const write = (db: ReadonlyDb) => db.insert;
    expect(typeof write).toBe("function");
  });

  it("has source files to check — the guard is never vacuous", () => {
    expect(sourceFiles().length).toBeGreaterThan(3);
  });

  it("contains no code path that writes roster, lineup or trade state", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(join(ADVISOR_DIR, file), "utf8");
      for (const pattern of WRITE_PATTERNS) {
        if (source.includes(pattern)) offenders.push(`${file}: ${pattern}`);
      }
    }
    // Advisory-only is a LEGAL constraint (strategy doc §4.2), not a UX preference: no code
    // path may let the AI submit a lineup or accept a trade. Adding a write here is not a
    // refactor — it needs a human confirmation action and a different plan.
    expect(offenders).toEqual([]);
  });

  it("never reaches for an API key of its own — enablement is decided at the route edge", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(join(ADVISOR_DIR, file), "utf8");
      expect(source).not.toContain("process.env");
      expect(source).not.toContain("isLLMEnabled");
    }
  });
});
