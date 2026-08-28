import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { readFixture, readManifest } from "./fixtures";

/**
 * The manifest is the only record of WHERE these bytes came from, and a fixture whose provenance
 * has drifted is worse than no fixture — it is a test suite proving a mapper works against data
 * nobody can trace. These assertions keep the manifest and the directory honest about each other.
 */
describe("the nflverse fixture corpus", () => {
  const manifest = readManifest();

  it("was recorded from real releases, not authored", () => {
    expect(manifest.provenance).toBe("recorded-from-live-release");
    expect(manifest.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("names the upstream release and asset every slice came from", () => {
    expect(manifest.entries.length).toBeGreaterThan(0);
    for (const entry of manifest.entries) {
      expect(entry.release).not.toBe("");
      expect(entry.asset).toMatch(/\.csv$/);
      expect(entry.filtered).not.toBe("");
    }
  });

  it("every listed slice is on disk and parses", () => {
    for (const entry of manifest.entries) {
      expect(parseCsv(readFixture(entry.file)).length).toBeGreaterThan(0);
    }
  });

  it("keeps the upstream columns the mappers do not read yet, so a schema change shows up as a diff", () => {
    const snapCounts = parseCsv(readFixture("snap_counts_2024_buf_w1-3.csv"));
    expect(Object.keys(snapCounts[0]!)).toEqual(
      expect.arrayContaining(["game_id", "pfr_game_id", "pfr_player_id", "defense_snaps", "st_snaps"]),
    );
  });

  it("spans more than one week, so a rolling window and a replay have something to walk", () => {
    const weeks = new Set(parseCsv(readFixture("snap_counts_2024_buf_w1-3.csv")).map((row) => row.week));
    expect(weeks.size).toBeGreaterThanOrEqual(3);
  });
});
