import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFilesIn } from "./test-support";

/**
 * NOTHING UNDER `src/` READS DATA FROM A REPOSITORY FILE (file-sourced data round, 2026-09-09).
 *
 * The coaches CSV was read from disk at request time and threw ENOENT in production: a serverless
 * bundle carries traced modules, not data files. The fix was a table, an ingest and a repository
 * read, and this sweep is what keeps the next file from creeping back in. It reads every non-test
 * source file under `src/` and refuses three shapes:
 *
 *   1. `node:fs` reached by any syntax: a static import, a dynamic `import()`, a `require()`.
 *   2. A static import of a data file (`.json`, `.csv`, `.txt`, `.md`), which compiles the data
 *      into the bundle and turns a re-fit or a curation into a deploy.
 *   3. A string literal naming a `data/` path, the repository's data directory.
 *
 * Scripts and tests are excluded because the file read belongs there: an ingest reads the file
 * once and writes the table (`scripts/lib/*-csv.ts`, `scripts/lib/model-artifact-records.ts`), and
 * a test may read whatever it likes. `test-support.ts` helpers are excluded by `sourceFilesIn`'s
 * own rule.
 *
 * THE ALLOWLIST IS NAMED, REASONED, AND KEPT HONEST: an entry must still offend under exactly the
 * rule it names, so a file that stops reading a file falls off the list on the commit that fixes
 * it, and an allowlisted file may not pick up a second shape under cover of the first.
 */

type Rule = "node-fs" | "static-data-import" | "data-path";

interface Exception {
  readonly file: string;
  readonly rule: Rule;
  readonly reason: string;
}

const ALLOWLIST: readonly Exception[] = [
  {
    file: "src/stats/tank01/fixtures.ts",
    rule: "node-fs",
    reason: "recorded-fixture loader; imported by tests and scripts/record-tank01-fixtures.ts, never by the request path",
  },
  { file: "src/gifs/giphy/fixtures.ts", rule: "node-fs", reason: "recorded-fixture loader; imported by tests only" },
  { file: "src/projections/nflverse/fixtures.ts", rule: "node-fs", reason: "recorded-fixture loader; imported by tests only" },
  {
    file: "src/stats/mock/mock-stats-provider.ts",
    rule: "static-data-import",
    reason: "the e2e mock dataset, selected only under STATS_PROVIDER=mock; inventory 2026-09-09 lists it for a lazy import behind the provider switch",
  },
  {
    file: "src/projections/laws/registry.ts",
    rule: "static-data-import",
    reason: "measured.json and discovered.json, the laws artifact family; blocked this round by blend.ts's registry() default (inventory M13-M15), next round moves it to model_artifacts",
  },
];

const REPO_ROOT = process.cwd();

const FS_SPECIFIER = String.raw`["'](?:node:)?fs(?:/promises)?["']`;

const PATTERNS: Readonly<Record<Rule, readonly RegExp[]>> = {
  "node-fs": [
    new RegExp(String.raw`\bfrom\s*${FS_SPECIFIER}`),
    new RegExp(String.raw`\brequire\(\s*${FS_SPECIFIER}\s*\)`),
    new RegExp(String.raw`\bimport\(\s*${FS_SPECIFIER}\s*\)`),
  ],
  "static-data-import": [/^\s*import\s[^;]*?\bfrom\s*["'][^"']+\.(?:json|csv|txt|md)["']/, /^\s*import\s*["'][^"']+\.(?:json|csv|txt|md)["']/],
  "data-path": [/["'`]data\/[^"'`]*["'`]/],
};

export interface Offence {
  readonly rule: Rule;
  readonly line: number;
  readonly text: string;
}

/** Comments blanked, line structure kept, so an offence reports its real line and prose never counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
}

/** Every rule a source breaks, by line. Pure, so the planted cases below prove what the sweep catches. */
export function fileSourcedOffences(source: string): readonly Offence[] {
  return stripComments(source)
    .split("\n")
    .flatMap((text, index) =>
      (Object.keys(PATTERNS) as Rule[])
        .filter((rule) => PATTERNS[rule].some((pattern) => pattern.test(text)))
        .map((rule) => ({ rule, line: index + 1, text: text.trim() })),
    );
}

function read(file: string): string {
  return readFileSync(join(REPO_ROOT, file), "utf8");
}

const SWEPT = [...sourceFilesIn(["src"], ".ts"), ...sourceFilesIn(["src"], ".tsx")];

function exceptionFor(file: string): Exception | undefined {
  return ALLOWLIST.find((entry) => entry.file === file);
}

describe("the detector catches every shape it claims to", () => {
  it("node:fs by static import, dynamic import and require, with or without the node: prefix or /promises", () => {
    for (const snippet of [
      'import { readFileSync } from "node:fs";',
      "import { readFile } from 'fs/promises';",
      'const fs = require("fs");',
      'const { readFileSync } = await import("node:fs");',
    ]) {
      expect(fileSourcedOffences(snippet).map((offence) => offence.rule)).toEqual(["node-fs"]);
    }
  });

  it("a static import of a data file, with or without an import attribute", () => {
    expect(fileSourcedOffences('import measured from "./measured.json";')).toMatchObject([{ rule: "static-data-import", line: 1 }]);
    expect(fileSourcedOffences('import committed from "./dataset.json" with { type: "json" };')).toMatchObject([{ rule: "static-data-import" }]);
    expect(fileSourcedOffences('import "./banned-words.txt";')).toMatchObject([{ rule: "static-data-import" }]);
  });

  it("a data/ path in any quote style, and not a path that merely contains the word", () => {
    expect(fileSourcedOffences('const p = "data/win-totals/win-totals.csv";')).toMatchObject([{ rule: "data-path" }]);
    expect(fileSourcedOffences("const p = `data/${name}/v1.json`;")).toMatchObject([{ rule: "data-path" }]);
    expect(fileSourcedOffences('import { guard } from "@/data/seed/guard";')).toEqual([]);
    expect(fileSourcedOffences('const url = "/api/metadata/x";')).toEqual([]);
  });

  it("never counts prose: a comment naming the file is documentation, not a read", () => {
    const source = ["/**", ' * `data/play-callers/play-callers.csv` is the reviewed source; readFileSync of it threw.', " */", '// import x from "./a.json"', "export const n = 1;"].join("\n");
    expect(fileSourcedOffences(source)).toEqual([]);
  });

  it("reports the real line number through a blanked block comment", () => {
    const source = ["/* one", "two */", 'import fs from "node:fs";'].join("\n");
    expect(fileSourcedOffences(source)).toMatchObject([{ rule: "node-fs", line: 3 }]);
  });
});

describe("nothing under src/ reads data from a repository file", () => {
  it("sweeps a real tree, so an empty scan can never pass silently", () => {
    expect(SWEPT.length).toBeGreaterThan(500);
  });

  it("finds no offence outside the allowlist", () => {
    const offenders = SWEPT.flatMap((file) => {
      const allowed = exceptionFor(file);
      return fileSourcedOffences(read(file))
        .filter((offence) => offence.rule !== allowed?.rule)
        .map((offence) => `${file}:${offence.line} [${offence.rule}] ${offence.text}`);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest: every entry exists, is swept, and still offends under exactly the rule it names", () => {
    for (const entry of ALLOWLIST) {
      expect(SWEPT, `${entry.file} is not swept; drop it from the allowlist`).toContain(entry.file);
      const rules = new Set(fileSourcedOffences(read(entry.file)).map((offence) => offence.rule));
      expect(rules.has(entry.rule), `${entry.file} no longer offends under ${entry.rule}: ${entry.reason}. Remove the entry.`).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });
});
