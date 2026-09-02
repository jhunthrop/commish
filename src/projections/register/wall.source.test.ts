import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFilesIn } from "@/design/test-support";

/**
 * THE WALL — the quarantine the 2026 data year rests on, asserted structurally rather than
 * promised in prose.
 *
 * THE REGISTER IS A ONE-WAY VALVE. It READS the engine: the served board through the product's own
 * read path, the published benchmark rankings, the props archive, the weekly stat lines, the
 * schedule's kickoffs. Nothing reads it BACK. The moment a fitting module, a law measurement or a
 * pricing blend could see a register row, this season's own prospective record would become an
 * input to the thing it exists to judge, and every number the register later reports would be a
 * measurement of a model that had already been shown the answer. That is not a risk this engine
 * has been theoretical about — two silent leakage defects have been found here by audit, and
 * neither had a failing test.
 *
 * WHY A SOURCE SWEEP RATHER THAN A LINT RULE. The rule is one sentence and the enforcement should
 * be one file a reader can check in ten seconds. A dependency-cruiser config would say the same
 * thing further away from the thing it protects, and the failure message would name a graph edge
 * rather than the file that crossed the line.
 *
 * `sourceFilesIn` is imported from `@/design/test-support` rather than copied a third time (the
 * repository already carries two copies of this walker). It is a generic recursive walker with no
 * design-token knowledge in it at all; the module it lives in is merely where it landed first.
 */

const REPO_ROOT = process.cwd();

/** Every engine directory the register may never be read from. The register READS several of
 *  these; the ban is on the arrow pointing back. */
const QUARANTINED_DIRS = [
  "src/projections/market",
  "src/projections/laws",
  "src/projections/model",
  "src/projections/preseason",
  "src/projections/nflverse",
  "src/projections/odds",
] as const;

/**
 * The register's own operator scripts, which necessarily import it. Everything else under
 * `scripts/` — every fit, every measurement, every persist — is swept, because a fit script that
 * read a frozen row would leak this season's prospective record into next season's constants just
 * as surely as a module would.
 */
const REGISTER_SCRIPTS: readonly string[] = ["scripts/register-freeze.ts", "scripts/register-grade.ts"];

/** Every spelling a TypeScript import of the register can take, from anywhere in the tree. */
const REGISTER_IMPORT = /from\s+["'](?:@\/projections\/register|[./]+\/register)(?:\/[\w./-]*)?["']/;

interface Offender {
  readonly file: string;
  readonly line: string;
}

function offendersIn(files: readonly string[]): readonly Offender[] {
  return files.flatMap((file) => {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    return source
      .split("\n")
      .filter((line) => REGISTER_IMPORT.test(line))
      .map((line) => ({ file, line: line.trim() }));
  });
}

const quarantinedFiles = sourceFilesIn(QUARANTINED_DIRS, ".ts");
const scriptFiles = sourceFilesIn(["scripts"], ".ts").filter((file) => !REGISTER_SCRIPTS.includes(file));

describe("THE WALL: nothing in the engine imports the register", () => {
  it("finds the engine files to sweep, so an empty scan can never pass silently", () => {
    expect(quarantinedFiles.length).toBeGreaterThanOrEqual(40);
    // Every quarantined directory is pinned by name, LITERALLY, so a typo in the constant above
    // cannot quietly shrink the sweep to nothing.
    expect(quarantinedFiles.some((file) => file.startsWith("src/projections/market/"))).toBe(true);
    expect(quarantinedFiles.some((file) => file.startsWith("src/projections/laws/"))).toBe(true);
    expect(quarantinedFiles.some((file) => file.startsWith("src/projections/model/"))).toBe(true);
    expect(quarantinedFiles.some((file) => file.startsWith("src/projections/preseason/"))).toBe(true);
    expect(quarantinedFiles.some((file) => file.startsWith("src/projections/nflverse/"))).toBe(true);
    expect(quarantinedFiles.some((file) => file.startsWith("src/projections/odds/"))).toBe(true);
  });

  it("no market, laws, model, preseason, nflverse or odds module imports src/projections/register", () => {
    expect(offendersIn(quarantinedFiles)).toEqual([]);
  });

  it("finds the operator scripts to sweep, so an empty scan can never pass silently", () => {
    expect(scriptFiles.length).toBeGreaterThanOrEqual(30);
    expect(scriptFiles.some((file) => file === "scripts/blend-fit.ts")).toBe(true);
    expect(scriptFiles.some((file) => file === "scripts/measure-laws.ts")).toBe(true);
    expect(scriptFiles.some((file) => file === "scripts/preseason-persist.ts")).toBe(true);
  });

  it("no fit or measurement script imports the register — only the register's own scripts may", () => {
    expect(offendersIn(scriptFiles)).toEqual([]);
  });

  it("recognises a register import when it sees one, so the sweep cannot pass by failing to match", () => {
    for (const line of [
      'import { takeFreeze } from "@/projections/register/freeze";',
      'import { gradeWeek } from "../register/grade";',
      'import type { RegisterFreezeRow } from "./register/store";',
      'export { takeFreeze } from "@/projections/register";',
    ]) {
      expect(REGISTER_IMPORT.test(line)).toBe(true);
    }
    // And it does not fire on a module whose name merely contains the word.
    expect(REGISTER_IMPORT.test('import { registry } from "@/projections/laws/registry";')).toBe(false);
  });
});
