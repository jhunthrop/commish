import { copyFileSync, utimesSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPlayCallerTable } from "./depth-reads";

const COMMITTED = "data/play-callers/play-callers.csv";

describe("readPlayCallerTable", () => {
  /**
   * IDENTITY IS THE PROOF, not a spy. `parsePlayCallers` builds a fresh array on every call, so two
   * calls returning the SAME array reference can only mean the second one never parsed. A spy on
   * `readFileSync` cannot be installed at all: an ESM module namespace is frozen.
   */
  it("parses the committed table once per process rather than once per collect", () => {
    const first = readPlayCallerTable();
    const second = readPlayCallerTable();
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(900);
  });

  it("re-parses when the file itself changes, so an edit in a long-lived dev process is seen", () => {
    const directory = mkdtempSync(join(tmpdir(), "play-callers-"));
    const path = join(directory, "play-callers.csv");
    copyFileSync(COMMITTED, path);

    const first = readPlayCallerTable(path);
    expect(readPlayCallerTable(path)).toBe(first);

    const later = new Date(Date.now() + 60_000);
    utimesSync(path, later, later);
    expect(readPlayCallerTable(path)).not.toBe(first);
  });

  it("still fails loudly for a path that does not exist, rather than caching an absence", () => {
    expect(() => readPlayCallerTable(join(tmpdir(), "no-such-play-callers.csv"))).toThrow();
  });
});
