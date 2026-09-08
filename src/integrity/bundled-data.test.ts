import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * Data files the server reads from disk at request time must be traced into every serverless
 * bundle. The play-callers file was not, and production threw ENOENT on the team page and on
 * the capsule sweep the job tick runs (2026-09-08). This pins the include so a config edit
 * cannot silently drop it, and names the reader so the next disk read joins the list.
 */
const DISK_READ_DATA = ["./data/play-callers/**/*"] as const;

describe("data read from disk at request time is traced into every route's bundle", () => {
  it("includes each disk-read data glob for every route", () => {
    const includes = nextConfig.outputFileTracingIncludes ?? {};
    const everyRoute = includes["/**/*"] ?? [];
    for (const glob of DISK_READ_DATA) expect(everyRoute).toContain(glob);
  });
});
