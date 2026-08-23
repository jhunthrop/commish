import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE ROUTE-TREE CONTRACT. `withAdmin` (`src/app/api/admin/_shared.ts`) is the one gate, and
 * this is the tripwire that keeps it true as routes are added — the same "enumerate the tree,
 * fail if anything is ungated" discipline `advisory-only.test.ts`'s `sourceFiles` and
 * `seed-operator.test.ts`'s `grepSourceTree` use, adapted to two directories and two patterns.
 */

/** Every `.ts`/`.tsx` source file under one of `dirs`, recursively, `.test.ts(x)` excluded — the
 *  same shape `advisory-only.test.ts`'s own `sourceFiles` uses, generalized to more than one
 *  root and to `.tsx` (this tree has `page.tsx` files, not just `.ts`). Paths are returned
 *  relative to the repo root, so they double as `read()`'s own input. */
function sourceFiles(dirs: readonly string[]): readonly string[] {
  function walk(dir: string): readonly string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
      return [relative(process.cwd(), full)];
    });
  }
  return dirs.flatMap((dir) => walk(join(process.cwd(), dir))).sort();
}

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

interface GrepOptions {
  readonly dirs: readonly string[];
  readonly exclude: RegExp;
}

/**
 * Every production file under `dirs` whose text matches `pattern` — `seed-operator.test.ts`'s
 * own `grepSourceTree`, reproduced here rather than imported: it is a private helper in a test
 * file, not a shared module, the same "found by grep rather than by memory" idiom applied fresh
 * at each site that needs it.
 */
function grepSourceTree(pattern: RegExp, { dirs, exclude }: GrepOptions): readonly string[] {
  function walk(dir: string): readonly string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!/\.tsx?$/.test(entry.name) || exclude.test(entry.name)) return [];
      return [full];
    });
  }
  return dirs
    .flatMap((dir) => walk(join(process.cwd(), dir)))
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(process.cwd(), path))
    .sort();
}

describe("the admin route tree is gated", () => {
  it("routes every file under the admin tree through the one gate", () => {
    // Recursive, .test excluded and nothing else — advisory-only.test.ts's shape, whose own
    // history is that both of its earlier holes were name-based carve-outs. The first root moved
    // under the `(shell)` route group in Task 2 Step 5 — a route group changes no URL, so this is
    // a path-glob update ONLY, in the same commit that moves the files (the addendum's A3
    // promise: Task 19 does not edit this tripwire).
    const files = sourceFiles(["src/app/app/(shell)/admin", "src/app/api/admin"]);
    expect(files.length).toBeGreaterThan(3); // never vacuous
    const ungated = files.filter((f) => !f.endsWith("_shared.ts") && !/requireAdmin\(|withAdmin\(/.test(read(f)));
    expect(ungated).toEqual([]);
  });

  it("keeps the operator gate out of every non-admin route", () => {
    // The inverse claim, and the one a future author is likelier to break: `requireAdmin`
    // appearing on an ordinary member route would be an authorization change nobody reviewed.
    // Exactly two files call it: the declaration's own module, and its one caller (`withAdmin`).
    // Every OTHER admin route — the two pages and the resolve route — goes through `withAdmin`
    // instead (proved by the test above), which is what keeps this list from growing every time
    // a new admin surface lands.
    expect(grepSourceTree(/requireAdmin\(/, { dirs: ["src"], exclude: /\.test\.tsx?$/ })).toEqual([
      "src/app/api/admin/_shared.ts",
      "src/lib/auth/current-user.ts",
    ]);
  });
});
