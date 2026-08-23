import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Every service-module directory Task 15's walk covered, named literally rather than discovered
 * by a filesystem heuristic: `src` holds directories that are NOT backend service modules by the
 * same naming convention a service module uses (`src/league-room`, `src/design`, `src/lib`,
 * `src/domain`, `src/db`, `src/data`, `src/integrity` itself, `src/app`...), so there is no single
 * mechanical rule — "ends in -service", "has an index.ts", "is imported by a route" — that both
 * catches every module on this list and excludes every one of those. The enforcement this test
 * gives instead: whoever adds a fifteenth service module updates this array as part of that work
 * (the same way `ROOM_DIRS` in `room-copy.source.test.ts` is a named, not derived, list), and if
 * they forget to add its row to `docs/backend-surface-map.md` in the same commit, THIS test is
 * what turns that omission into a failure instead of a silent gap.
 */
const SERVICE_DIRECTORIES = [
  "src/league-service",
  "src/draft-service",
  "src/chat-service",
  "src/review-service",
  "src/identity-service",
  "src/integrity-service",
  "src/trades",
  "src/participation",
  "src/moderation",
  "src/ai-advisor",
  "src/stats",
  "src/stats-pipeline",
  "src/help",
  "src/matchmaking",
  "src/chat",
  "src/identity",
  "src/reviews",
  "src/gifs",
] as const;

describe("the backend surface map names every service module", () => {
  it("names every service module in the surface map, so a new one cannot ship unlisted", () => {
    // Deliberately MODULE-level, not export-level. A test that parses a markdown table of 300
    // exports is a test that breaks on a typo and teaches nobody anything; a test that fails the
    // day a fifteenth service directory appears with no row is the one that actually protects the
    // founder's directive.
    const documented = readFileSync("docs/backend-surface-map.md", "utf8");
    for (const dir of SERVICE_DIRECTORIES) expect(documented).toContain(dir);
  });

  it("lists every directory exactly once, so the walk is not silently double-counting a module", () => {
    expect(new Set(SERVICE_DIRECTORIES).size).toBe(SERVICE_DIRECTORIES.length);
  });
});
