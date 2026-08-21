import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copyViolations } from "./copy-rules";
import { candidateCopyIn, sourceFilesIn } from "./test-support";

/**
 * `src/league-service` differs from `src/participation` in one way this sweep has to account for:
 * it is a Postgres-backed service directory, not a pure vocabulary one, so it also carries plenty
 * of text that is candidate copy by shape (a string literal) but developer prose by AUDIENCE — a
 * thrown invariant's own message (`assertNoPlayerOnTwoRosters`, `trade-transfer.ts`: caught,
 * logged with real detail, and answered to the actual caller with a SEPARATE plain-language
 * string, per this directory's own repeated "plain language out, real detail into the logs, never
 * raw driver text to a user" convention) and a `console.error` call's own arguments (an operator's
 * server log, not a member's screen — the opposite case from `script-copy.source.test.ts`'s
 * `consoleCopyIn`, whose whole premise is that a SCRIPT's stdout is the one thing a human operator
 * reads as their UI; an application service's `console.error` is not that).
 *
 * Stripped BEFORE the sweep runs, not filtered out of its findings afterward, so a real product
 * string that happens to sit inside one of these two constructs is still swept — see the two
 * `it.each` proofs below for exactly that shape.
 */
function stripDeveloperOnlyProse(source: string): string {
  return source
    .replace(/throw new Error\([\s\S]*?\);/g, "throw new Error();")
    .replace(/console\.(?:error|warn|log|info)\([\s\S]*?\);/g, "");
}

/**
 * A FOURTH directory this house-voice discipline reaches, beside `room-copy.source.test.ts`
 * (`.tsx` in `ROOM_DIRS`), `script-copy.source.test.ts` (`.ts` in `scripts`, `console.*` arguments
 * only) and `participation-copy.source.test.ts` (`.ts` in `src/participation`).
 *
 * Phase 3 Plan D, Task 3 review fix round F2. `src/league-service` is where every plain-language
 * refusal this product's league doors can answer with is DECLARED — `NOT_PUBLIC`, `LEAGUE_FULL`,
 * `DRAFT_ALREADY_STARTED` (`join.ts`), `INVALID`/`EXPIRED`/`EXHAUSTED` (`invites.ts`), and
 * `ENFORCEMENT_REFUSALS.join`/`.create` (`enforcement.ts`, Task 3's own new strings) — and NONE of
 * it is JSX, so all of it sits outside `room-copy.source.test.ts` exactly the way
 * `src/participation`'s copy did before Task 2's own F2 closed that gap. `enforcement.test.ts`'s
 * hand-written assertion covers two of these eight strings; this sweep covers every string this
 * directory declares today AND every one a future writer adds here, the same "a file nobody
 * remembered is swept by nothing" property `sourceFilesIn` gives every directory it walks.
 *
 * `candidateCopyIn` (not `consoleCopyIn`): these are exported string constants read back by a
 * caller (an API route, a UI component), never terminal output. It also over-collects — SQL
 * fragments, drizzle column literals, log-message templates passed to `console.error` alongside
 * their own structured context object — the same "cheap, because the rules only fire on a dash, an
 * accusatory term or a passive construction, none of which belong in an identifier either" trade
 * `participation-copy.source.test.ts` already makes for its own directory.
 */
const REPO_ROOT = process.cwd();

const files = sourceFilesIn(["src/league-service"], ".ts");

describe("src/league-service writes its user-facing refusals in the house voice", () => {
  it("finds the files to sweep, so an empty scan can never pass silently", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files).toContain(join("src", "league-service", "enforcement.ts"));
    expect(files).toContain(join("src", "league-service", "join.ts"));
    expect(files).toContain(join("src", "league-service", "invites.ts"));
    expect(files.some((file) => file.includes(".test."))).toBe(false);
  });

  it("answers empty for a directory that is not there", () => {
    expect(sourceFilesIn(["src/no-such-league-service"], ".ts")).toEqual([]);
  });

  it.each(files)("%s says nothing that breaks the copy rules", (file) => {
    const source = stripDeveloperOnlyProse(readFileSync(join(REPO_ROOT, file), "utf8"));
    const offenders = candidateCopyIn(source).flatMap((text) => copyViolations(text).map((violation) => ({ text, ...violation })));
    expect(offenders).toEqual([]);
  });

  it("still sweeps a real string sitting beside a stripped throw/console call, not just the ones outside them", () => {
    const source = [
      'export const REAL_COPY = "This has a bad dash — right here.";',
      'function guard() { throw new Error("internal only — never shown"); }',
      'console.error("[league] internal log — never shown", {});',
    ].join("\n");
    const offenders = candidateCopyIn(stripDeveloperOnlyProse(source)).flatMap((text) => copyViolations(text).map((v) => ({ text, ...v })));
    expect(offenders).toEqual([{ text: "This has a bad dash — right here.", rule: "dash", found: "—" }]);
  });

  /**
   * THE PROOF OF BITE, so this scan can never become a green test over an extractor that stopped
   * extracting. Reproduces the shape an em dash would actually ship in: a plain string-literal
   * export, the exact shape `ENFORCEMENT_REFUSALS`/`NOT_PUBLIC` already use.
   *
   * Verified live against the real files (reverted before this commit): injected an em dash into
   * `ENFORCEMENT_REFUSALS.join` (`"...level footing — browse the open leagues..."`), re-ran this
   * file, watched `%s says nothing that breaks the copy rules` for `enforcement.ts` redden with a
   * `dash` violation naming the injected text, then reverted and re-ran green.
   */
  it("catches a dash injected into a string-literal export, the shape a real violation would ship in", () => {
    const source = 'export const ENFORCEMENT_REFUSALS = {\n  join: "This league is reserved — for newer players.",\n};';
    expect(candidateCopyIn(source).flatMap(copyViolations)).toContainEqual({ rule: "dash", found: "—" });
  });
});
