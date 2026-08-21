import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { RaiseFlagInput } from "@/integrity-service/flags";

/**
 * The FLAGS-ONLY contract, in the same shape `src/ai-advisor/advisory-only.test.ts` already
 * proved for the advisor: no code path under `@/integrity`/`@/integrity-service` may take an
 * action against an account, and the one function that CAN (`grantAdmin`) must be structurally
 * unreachable from the detector's own import graph, not merely un-called-today.
 *
 * `sourceFiles`/`read`/`importClosureOf` below are written fresh rather than imported from
 * `advisory-only.test.ts`: that file's own `sourceFiles` is a private, single-directory helper
 * (no export, one `ADVISOR_DIR` baked in) and this guard needs two directories and an import-
 * graph walk `advisory-only.test.ts` has no use for. Extracting a shared helper would mean
 * editing `advisory-only.test.ts` to consume it, which is out of scope here — this file mirrors
 * that one's SHAPE (the same four kinds of property, the same "collect every offender" style)
 * without touching it.
 */
const INTEGRITY_DIRS = ["src/integrity", "src/integrity-service"];

/** Every `isAdmin`/suspend/ban-shaped verb this plan forbids the detector from reaching. */
const ACCOUNT_ACTION_PATTERNS = ["isAdmin", "suspend", "ban", "restrict", "disable", "lock", "deactivate"] as const;

const REPO_ROOT = process.cwd();

/** Every `.ts` file under a repo-root-relative directory, RECURSIVELY, test files excluded —
 *  they are the thing doing the checking, not the thing being checked (same reasoning
 *  `advisory-only.test.ts`'s own `sourceFiles` and `reserved.test.ts`'s `walk` both use). Paths
 *  are returned repo-root-relative, so an offender names its own directory. */
function sourceFiles(dirs: readonly string[]): readonly string[] {
  function walk(dir: string): readonly string[] {
    const full = join(REPO_ROOT, dir);
    if (!existsSync(full)) return [];
    return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const entryRelPath = join(dir, entry.name);
      if (entry.isDirectory()) return walk(entryRelPath);
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
      return [entryRelPath];
    });
  }
  return dirs.flatMap(walk);
}

function read(repoRelativePath: string): string {
  return readFileSync(join(REPO_ROOT, repoRelativePath), "utf8");
}

/**
 * `source` with every comment and every string/template literal's CONTENTS blanked out —
 * quote characters kept, so a genuine code offender adjacent to a stripped string still lines
 * up. The grep below wants a CODE PATH, and this codebase's own prose collides with the pattern
 * list constantly and legitimately: `Clock`/`systemClock`/a `"clock"` icon name all contain
 * "lock" as a bare substring, "LOCK ORDER" is this repo's own docblock convention for a
 * database row lock (`audit-logger.ts`, `session-signals.ts`, this very file's sibling
 * `multi-account.ts`), and "bans"/"forbids…restrict" show up in ordinary sentences about what a
 * RULE disallows. None of that is an account-action code path; all of it is comment or copy.
 * Verified empirically against every file this scan reads today: stripped this way, the offender
 * list is empty everywhere except the one excluded file (`grantAdmin`'s home) — so this is not a
 * hole punched to make the test pass, it is what makes the test test the right thing.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/** Every name in one `import { a, b as c, type d } from "..."` (or `import type { ... }`)
 *  clause — the `type`-only variant included, since a name imported ONLY as a type still names
 *  something this test cares about seeing (or not seeing) in the graph. */
function namedImportsIn(clause: string): readonly string[] {
  return clause
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .map((piece) => piece.replace(/^type\s+/, ""))
    .map((piece) => {
      const asIndex = piece.indexOf(" as ");
      return asIndex === -1 ? piece : piece.slice(0, asIndex).trim();
    });
}

const IMPORT_LINE = /import\s+(?:type\s+)?(?:\{([^}]*)\}|(\*\s+as\s+\w+)|(\w+))?\s*(?:,\s*\{([^}]*)\})?\s*from\s+["']([^"']+)["']/g;

/** Every name a file's own `import` statements bring into scope, paired with the module
 *  specifier each came from — `importClosureOf` walks the specifiers and collects the names. */
function importsIn(source: string): ReadonlyArray<{ readonly names: readonly string[]; readonly specifier: string }> {
  const results: Array<{ names: readonly string[]; specifier: string }> = [];
  for (const match of source.matchAll(IMPORT_LINE)) {
    const [, braced, namespaceClause, defaultClause, secondBraced, specifier] = match;
    const names = [
      ...(braced === undefined ? [] : namedImportsIn(braced)),
      ...(secondBraced === undefined ? [] : namedImportsIn(secondBraced)),
      ...(defaultClause === undefined ? [] : [defaultClause]),
      ...(namespaceClause === undefined ? [] : [namespaceClause.replace(/^\*\s+as\s+/, "")]),
    ];
    results.push({ names, specifier: specifier! });
  }
  return results;
}

/** A module specifier resolved to a real repo-root-relative `.ts`/`.tsx` file, or `null` for
 *  anything that isn't one of this repo's own modules (a package import, or a specifier that
 *  resolves to nothing on disk) — the boundary that keeps the walk from wandering into
 *  `node_modules`. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/") ? join("src", specifier.slice(2)) : specifier.startsWith(".") ? join(dirname(fromFile), specifier) : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(join(REPO_ROOT, candidate))) return relative(REPO_ROOT, join(REPO_ROOT, candidate));
  }
  return null;
}

/**
 * Every name reachable by following `entryFile`'s own imports, transitively, through this
 * repo's OWN modules only (never into `node_modules`) — an import-graph fact, not a grep. The
 * claim `flag-only.test.ts` needs is exactly "is `grantAdmin` a name this walk ever collects
 * starting from the detector", which is what `.not.toContain("grantAdmin")` below checks.
 */
function importClosureOf(entryFile: string): readonly string[] {
  const visited = new Set<string>();
  const names = new Set<string>();
  const queue = [entryFile];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file) || !existsSync(join(REPO_ROOT, file))) continue;
    visited.add(file);

    for (const { names: importedNames, specifier } of importsIn(read(file))) {
      for (const name of importedNames) names.add(name);
      const resolved = resolveSpecifier(specifier, file);
      if (resolved !== null && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return [...names];
}

describe("the detector is flags-only", () => {
  it("has files to check, so the guard is never vacuous", () => {
    expect(sourceFiles(INTEGRITY_DIRS).length).toBeGreaterThan(10);
  });

  it("contains no code path that takes an action against an account", () => {
    // Collect every offender rather than failing on the first, so the failure names the file AND
    // the pattern instead of sending the next reader hunting.
    const offenders: string[] = [];
    for (const file of sourceFiles(INTEGRITY_DIRS)) {
      if (file === "src/integrity-service/flags.ts") continue; // grantAdmin lives here — see below
      const code = codeOnly(read(file));
      for (const pattern of ACCOUNT_ACTION_PATTERNS) {
        // "lock" alone is word-boundaried — `Clock`/`systemClock`/an icon named `"clock"` (already
        // blanked above, but the identifiers survive) contain it as a bare substring, and this
        // repo's own `Clock` (`@/domain/timing`) is the injected-time convention every service
        // uses, not an account action. Every other pattern stays a plain substring, on purpose:
        // a real offender is more likely spelled `suspendAccount`/`banUser` (camelCase, no word
        // boundary at all) than as its own bare word, and a substring is what still catches that.
        const found = pattern === "lock" ? new RegExp(`\\b${pattern}\\b`).test(code) : code.includes(pattern);
        if (found) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the one account-touching function unreachable from the detector", () => {
    // `grantAdmin` is the single exception and it is an exception in the opposite direction: it
    // GIVES authority and only the operator script calls it. The claim that matters is that
    // nothing in the detection path can reach it, which is an import-graph fact, not a grep.
    expect(importClosureOf("src/integrity-service/multi-account.ts")).not.toContain("grantAdmin");
  });

  it("can only ever write a flag at pending, never at resolved", () => {
    const validInput: RaiseFlagInput = {
      flagType: "multi_account",
      subjectId: "u_a:u_b",
      leagueId: "league_1",
      evidence: {},
      raisedByUserId: null,
      occurredAt: "2026-08-20T00:00:00.000Z",
      newId: () => "flag_1",
    };
    // A detector that could write `resolution` would be a detector that decides. The type says
    // no: `RaiseFlagInput` has no resolution field, and this @ts-expect-error is what keeps it
    // saying no.
    // @ts-expect-error `resolution` is not part of RaiseFlagInput, which is the whole point.
    const bad: RaiseFlagInput = { ...validInput, resolution: "warned_user" };
    expect(bad).toBeDefined();
  });
});
