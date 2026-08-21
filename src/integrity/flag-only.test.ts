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
 * FIX ROUND 1 (Task 9's review, finding HIGH). The first version of this file excluded
 * `flags.ts` from the grep wholesale, because `grantAdmin` lived there and its own body
 * legitimately contains `isAdmin`. That exclusion meant a same-file call — `raiseFlag` calling
 * `grantAdmin` needs no `import`, so `importClosureOf`'s name-collection walk could never see it
 * — would have escaped BOTH checks this file claims to provide, and the reviewer proved it by
 * mutation: inserting a same-file `grantAdmin` call into `raiseFlag` left all four tests green.
 * `grantAdmin` now lives in its own module, `src/integrity-service/grant-admin.ts` — the ONE
 * sanctioned authority-granting module, reachable only by `import` — so `flags.ts` needs no
 * exclusion at all and scans exactly like every other file below. `grant-admin.ts` itself is the
 * lone excepted file, and the import-closure test now checks the MODULE ITSELF is unreachable,
 * not merely that its export name never appears as an import specifier — see `importClosureOf`'s
 * own docblock.
 *
 * `sourceFiles`/`read`/`importClosureOf` below are written fresh rather than imported from
 * `advisory-only.test.ts`: that file's own `sourceFiles` is a private, single-directory helper
 * (no export, one `ADVISOR_DIR` baked in) and this guard needs two directories and an import-
 * graph walk `advisory-only.test.ts` has no use for. Extracting a shared helper would mean
 * editing `advisory-only.test.ts` to consume it, which is out of scope here — this file mirrors
 * that one's SHAPE (the same four kinds of property, the same "collect every offender" style)
 * without touching it.
 */
const INTEGRITY_DIRS = ["src/integrity", "src/integrity-service", "src/trades"];

/** The one file this scan does not read as a potential offender: `grantAdmin`'s own module,
 *  which legitimately writes `isAdmin` — that IS the sanctioned account action, the opposite
 *  direction from what this guard forbids (it GIVES authority, never takes one away), and only
 *  the operator script and the seed's own bootstrap grant call it (`seed-operator.test.ts`'s own
 *  tripwire). Every other file in `INTEGRITY_DIRS`, `flags.ts` included, scans clean with no
 *  carve-out. */
const AUTHORITY_GRANTING_MODULE = "src/integrity-service/grant-admin.ts";

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
 * `source` with every `/* *‍/` and `//` comment blanked out — STRING AND TEMPLATE LITERAL
 * CONTENTS STAY, on purpose (fix round 1, F2). The first version of this file also blanked
 * string contents, which was too strong a strip: a QUOTED object key (`db.update(users).set({
 * "isAdmin": true })`) is real, executable code — Drizzle reads it exactly like the unquoted
 * spelling — and blanket string-stripping made it invisible to the grep below. Comments are
 * blanked because they are the ONLY category that is never executed; a string is code the moment
 * it is a property key, a dynamic import specifier, or (less relevantly here) `eval`ed.
 *
 * This still collides with this codebase's own prose: "LOCK ORDER" is the docblock convention
 * for a database row lock (`audit-logger.ts`, `session-signals.ts`, `multi-account.ts`), and
 * `Clock`/`systemClock`/a `"clock"` icon name all contain "lock" as a bare substring — but those
 * are now handled by `lock`'s own word-boundary match below, not by erasing the text they live
 * in. The one residual hit after comment-only stripping is a single line in `audit-logger.ts`
 * — a runtime error message's own prose, not a code path — named explicitly in `ALLOWED_HITS`
 * rather than worked around with another strip.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Named, justified exceptions — NOT a blanket strip — for the one place comment-only stripping
 * still finds a bare pattern that isn't a code path. Each entry blanks only its own exact
 * `snippet`, so a DIFFERENT, unrelated `lock` landing anywhere else in the same file (a real
 * offender) still reddens; widening an entry to the whole file would recreate the exact hole
 * `flags.ts`'s old blanket exclusion left.
 */
const ALLOWED_HITS: ReadonlyArray<{ readonly file: string; readonly pattern: (typeof ACCOUNT_ACTION_PATTERNS)[number]; readonly snippet: string; readonly because: string }> = [
  {
    file: "src/integrity-service/audit-logger.ts",
    pattern: "lock",
    snippet: "vanished between insert and lock",
    because: 'the impossible-state guard\'s own error message ("Audit chain … vanished between insert and lock.") — a database row lock, never an account lock.',
  },
];

/** `code` with every `ALLOWED_HITS` entry for `file` blanked out, one exact snippet at a time —
 *  the narrow allowlist F2 asks for instead of stripping every string. */
function withAllowedHitsRemoved(file: string, code: string): string {
  return ALLOWED_HITS.filter((entry) => entry.file === file).reduce((text, entry) => text.replaceAll(entry.snippet, ""), code);
}

/**
 * Whether comment-stripped `code` contains `pattern` as a real offense — extracted from the
 * offender loop below so the mutation-style tests can drive it directly with a synthetic
 * snippet, rather than only ever being exercised indirectly by whatever this repo's source
 * happens to contain today. `lock` is word-boundaried (see `codeOnly`'s own docblock for why);
 * every other pattern is a plain substring, which is exactly what still catches a QUOTED object
 * key (fix round 1, F2) — `codeOnly` no longer blanks string contents, so `'"isAdmin":'` reads
 * the same as `isAdmin:` to this check.
 */
function hasAccountActionOffense(code: string, pattern: (typeof ACCOUNT_ACTION_PATTERNS)[number]): boolean {
  return pattern === "lock" ? new RegExp(`\\b${pattern}\\b`).test(code) : code.includes(pattern);
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
 * Every name AND every module reachable by following `entryFile`'s own imports, transitively,
 * through this repo's OWN modules only (never into `node_modules`) — an import-graph fact, not a
 * grep.
 *
 * FIX ROUND 1 (F1c): `modules` is the claim that actually matters now that `grantAdmin` lives in
 * its own file. The original version of this function returned only imported NAMES, and the test
 * checked `.not.toContain("grantAdmin")` — a name-based check that a namespace import
 * (`import * as ga from "./grant-admin"`) or a same-named re-export elsewhere could dodge without
 * ever importing the STRING `"grantAdmin"` as a specifier. `modules` is `visited`, the set of
 * repo-root-relative file paths the walk actually opened — checking whether
 * `src/integrity-service/grant-admin.ts` is IN THAT SET is a claim about the file being reachable
 * at all, true regardless of what name(s) its exports are imported under. `names` is kept
 * alongside it (still used by nothing today, but a strictly weaker claim `modules` now subsumes
 * for this file's purposes) rather than removed, since a future guard over a DIFFERENT identifier
 * with no dedicated module might still want it.
 */
function importClosureOf(entryFile: string): { readonly names: readonly string[]; readonly modules: readonly string[] } {
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
  return { names: [...names], modules: [...visited] };
}

describe("the detector is flags-only", () => {
  it("has files to check, so the guard is never vacuous", () => {
    expect(sourceFiles(INTEGRITY_DIRS).length).toBeGreaterThan(15);
  });

  it("contains no code path that takes an action against an account", () => {
    // Collect every offender rather than failing on the first, so the failure names the file AND
    // the pattern instead of sending the next reader hunting. NO file-level carve-out remains —
    // `grantAdmin`'s own module is excluded by NAME (`AUTHORITY_GRANTING_MODULE`), and everything
    // else, `flags.ts` included, is scanned exactly like every other file (fix round 1, F1a).
    const offenders: string[] = [];
    for (const file of sourceFiles(INTEGRITY_DIRS)) {
      if (file === AUTHORITY_GRANTING_MODULE) continue;
      const code = withAllowedHitsRemoved(file, codeOnly(read(file)));
      for (const pattern of ACCOUNT_ACTION_PATTERNS) {
        if (hasAccountActionOffense(code, pattern)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the one account-touching function unreachable from the detector", () => {
    // `grantAdmin` is the single exception and it is an exception in the opposite direction: it
    // GIVES authority and only the operator script calls it. The claim that matters is that
    // nothing in the detection path can reach it — checked at the MODULE level (fix round 1,
    // F1c): is `grant-admin.ts` itself ever a file this walk opens, not merely whether the
    // string "grantAdmin" appears as an import specifier somewhere in it.
    expect(importClosureOf("src/integrity-service/multi-account.ts").modules).not.toContain(AUTHORITY_GRANTING_MODULE);
  });

  /**
   * Task 6 fix round 1 (review LOW 3). The manual read in the task report claimed
   * `trade-fairness.ts` only reaches `assembleAdvisorContext`/`valuePlayers` (`ReadonlyDb`-typed
   * by construction), `assetPlayerIds`, the pure `trades/fairness` functions, `getAuditLogger`
   * and `raiseFlag` — never a trade WRITE. This is that claim, checked structurally rather than
   * trusted from a read, the same MODULE-PATH discipline (fix round 1, F1c) the `grantAdmin`
   * proof above uses: is the mutating module ITSELF ever a file this walk opens, not merely
   * whether an import specifier string happens to match.
   *
   * `applyTradeInTx` (the whole-slot-map roster transfer) lives in `trade-transfer.ts`;
   * `acceptTrade` (the execution transaction that calls it) lives in `trades.ts`; `reverseTradeInTx`
   * (Task 7's compensating transfer, the reversal's own module) lives in `trade-reversal.ts` and is
   * named here now that it exists — the carry `trade-fairness.ts`'s own review (fix round 1, LOW 3)
   * placed on whoever landed it. All three are named by path, not by export, for the identical
   * reason `AUTHORITY_GRANTING_MODULE` is: a namespace import or a re-export under a different
   * name cannot dodge a check on the file itself.
   */
  it("keeps every trade-mutating module unreachable from the fairness detector", () => {
    const TRADE_MUTATION_MODULES = ["src/league-service/trade-transfer.ts", "src/league-service/trades.ts", "src/league-service/trade-reversal.ts"] as const;
    const closure = importClosureOf("src/integrity-service/trade-fairness.ts").modules;
    for (const mutationModule of TRADE_MUTATION_MODULES) {
      expect(closure).not.toContain(mutationModule);
    }
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

describe("the offense check itself, mutation-style — proof the mechanism catches what it claims to", () => {
  it("reddens on an ordinary unquoted write", () => {
    expect(hasAccountActionOffense('db.update(users).set({ isAdmin: true })', "isAdmin")).toBe(true);
  });

  it("reddens on a QUOTED object key too (fix round 1, F2)", () => {
    // The exact case the review's MEDIUM finding named: `codeOnly`'s first version blanked
    // string/template CONTENTS along with comments, so `{ "isAdmin": true }` read as `{ "" }` by
    // the time the pattern match ran and passed silently. `codeOnly` now strips comments only —
    // this is the test that would have caught that hole, and does now.
    expect(hasAccountActionOffense('db.update(users).set({ "isAdmin": true })', "isAdmin")).toBe(true);
  });

  it("does not false-positive on Clock/systemClock/a 'clock' icon name — word-boundaried, not stripped", () => {
    expect(hasAccountActionOffense("const clock = deps.clock ?? systemClock;", "lock")).toBe(false);
    expect(hasAccountActionOffense('icon: "clock",', "lock")).toBe(false);
  });

  it("still reddens on a real bare 'lock' word, e.g. a call like `.lock(`", () => {
    expect(hasAccountActionOffense("await accountService.lock(userId);", "lock")).toBe(true);
  });

  it("does NOT catch 'lock' fused into a camelCase identifier (lockAccount) — a known, accepted gap", () => {
    // Word-boundary matching trades this away on purpose: it is what makes `Clock`/`systemClock`
    // stop false-positiving. `isAdmin`/`suspend`/`ban`/`restrict`/`disable`/`deactivate` stay
    // plain substrings specifically so a camelCase offender in THOSE names (`suspendAccount`,
    // `banUser`) still reddens — `lock` is the one pattern this codebase's own vocabulary made
    // too noisy to leave as a substring, and this is the trade recorded, not hidden.
    expect(hasAccountActionOffense("await lockAccount(userId);", "lock")).toBe(false);
  });
});
