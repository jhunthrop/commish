import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * NOTHING ON A REQUEST PATH READS THE FILESYSTEM (coaches-table round, 2026-09-08). The depth
 * reads run inside the team page and the capsule sweep the job tick runs, both serverless, and
 * a serverless bundle carries traced modules rather than data files: the play-caller CSV read
 * that used to live here threw ENOENT in production. The table replaced it; this pins the
 * module to the store so the read cannot quietly come back.
 */
describe("depth-reads", () => {
  it("imports nothing from node:fs", () => {
    // Vitest runs from the repo root, the same root every `data/...` path in this repo assumes.
    const source = readFileSync("src/capsules/facts/depth-reads.ts", "utf8");
    expect(source).not.toMatch(/from "node:fs"|from "fs"|require\("fs"\)/);
    expect(source).not.toMatch(/readFileSync|statSync/);
  });
});
