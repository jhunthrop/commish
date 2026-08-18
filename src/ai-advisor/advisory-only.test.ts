import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  "scoreWeek",
  "applyAction",
  "commitDraft",
  "acceptInvite",
] as const;

function sourceFiles(): readonly string[] {
  return readdirSync(ADVISOR_DIR).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "test-support.ts");
}

describe("the advisor is advisory-only", () => {
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
