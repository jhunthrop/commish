import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copyViolations } from "./copy-rules";
import { consoleCopyIn, sourceFilesIn } from "./test-support";

/**
 * WHAT AN OPERATOR READS ON A TERMINAL, swept by the same rulebook as what a member reads in the
 * product. Final review, MEDIUM 7(c): `scripts/*` stdout had no harness in the repo at all. It
 * happened to be nearly clean, which is not the same as being kept clean — the four scripts this
 * branch added are the operator's whole interface to the integrity spine, and their output is
 * written in the product's voice, not in a stack trace's.
 *
 * Scoped to `console.*` ARGUMENTS and nothing else, which is what makes this cheap enough to be
 * worth having. A script's `throw`s and `Error` messages are developer-facing — the final review
 * read all of them by hand and accepted them as such — and sweeping those under the product's
 * copy rules would be a gate firing on prose it has no claim over. See `consoleCopyIn`.
 */
const REPO_ROOT = process.cwd();

const files = sourceFilesIn(["scripts"], ".ts");

describe("operator scripts print in the house voice", () => {
  it("finds the scripts to sweep, so an empty scan can never pass silently", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toContain(join("scripts", "sweep-multi-account.ts"));
  });

  it.each(files)("%s prints nothing that breaks the copy rules", (file) => {
    const offenders = consoleCopyIn(readFileSync(join(REPO_ROOT, file), "utf8")).flatMap((text) =>
      copyViolations(text).map((violation) => ({ text, ...violation })),
    );
    expect(offenders).toEqual([]);
  });

  it("reads a script's printed words and leaves its developer-facing throws alone", () => {
    const source = [
      `console.log("nothing to ingest — every examined week is already final");`,
      `throw new Error("boom — a developer reads this one");`,
    ].join("\n");
    expect(consoleCopyIn(source)).toEqual(["nothing to ingest — every examined week is already final"]);
    expect(consoleCopyIn(source).flatMap(copyViolations)).toContainEqual({ rule: "dash", found: "—" });
  });
});
