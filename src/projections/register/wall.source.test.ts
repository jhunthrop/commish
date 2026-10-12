import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  REGISTER_DIR,
  WALL_EXEMPT_FILES,
  registerReferencesIn,
  resolveSpecifier,
  resolvesIntoRegister,
  sweptSourceFiles,
  wallOffenders,
} from "./test-support";

/**
 * THE WALL — the quarantine the 2026 data year rests on, asserted structurally rather than
 * promised in prose.
 *
 * THE REGISTER IS A ONE-WAY VALVE. It READS the engine: the served board through the product's own
 * read path, the published benchmark rankings, the props archive, the weekly stat lines, the
 * schedule's kickoffs. Nothing reads it BACK. The moment a fitting module, a law measurement or a
 * pricing blend could see a register row, this season's own prospective record would become an
 * input to the thing it exists to judge, and every number the register later reports would be a
 * measurement of a model that had already been shown the answer. That is not a risk this engine has
 * been theoretical about — two silent leakage defects have been found here by audit, and neither had
 * a failing test.
 *
 * DEFENCE IN DEPTH, in three layers, after fix round 1 found the first version had two ways past it:
 *
 *   1. THIS SWEEP, widened from a six-directory allowlist to EVERY source file under `src/` and
 *      `scripts/`, and from a `from "..."` regex to a resolve-every-string-literal scan. The
 *      allowlist missed a re-export proxy parked in any unlisted directory; the `from` regex missed
 *      a dynamic `import()` and a `require()`. Neither evasion survives a scan that does not care
 *      what syntax a path was written in.
 *   2. THE PLANTED EVASIONS BELOW. A structural test that only ever runs over compliant source
 *      proves nothing about what it would catch, so both of the review's evasions — and four more —
 *      are planted and asserted caught, once against the pure detector and once against a real
 *      temporary tree walked by the real walker.
 *   3. THE ESLINT BACKSTOP (`no-restricted-syntax` in `eslint.config.mjs`), which catches the same
 *      four syntaxes in the editor and in CI rather than only in this suite. Its presence is
 *      asserted here too, so the rule cannot silently disappear in a config refactor and leave this
 *      file claiming a depth it no longer has.
 */

const REPO_ROOT = process.cwd();

const swept = sweptSourceFiles();

describe("THE WALL: the sweep covers everything", () => {
  it("sweeps the whole of src/ and scripts/, so an empty or narrowed scan can never pass silently", () => {
    // The tree carries roughly 1,500 source files; a threshold well under that fails loudly if the
    // walker ever stops descending, without breaking every time a file is added or removed.
    expect(swept.length).toBeGreaterThanOrEqual(1_000);
  });

  it("covers every directory the register reads from, by literal name", () => {
    for (const dir of [
      "src/projections/market/",
      "src/projections/laws/",
      "src/projections/model/",
      "src/projections/preseason/",
      "src/projections/nflverse/",
      "src/projections/odds/",
    ]) {
      expect(swept.some((file) => file.startsWith(dir))).toBe(true);
    }
  });

  it("covers directories NO allowlist would have thought to name — the re-export proxy's hiding place", () => {
    // The first version of this wall swept six directories. A one-line proxy in any of these would
    // have been invisible to it, which is precisely the evasion this widening closes.
    for (const dir of ["src/lib/", "src/app/", "src/league-service/", "src/draft-service/", "src/db/", "src/domain/"]) {
      expect(swept.some((file) => file.startsWith(dir))).toBe(true);
    }
  });

  it("sweeps test files too, not only shipping modules", () => {
    expect(swept.some((file) => file.startsWith("src/projections/") && file.endsWith(".test.ts"))).toBe(true);
  });

  it("sweeps the fit and measurement scripts by literal name", () => {
    for (const script of ["scripts/blend-fit.ts", "scripts/measure-laws.ts", "scripts/preseason-persist.ts"]) {
      expect(swept).toContain(script);
    }
  });

  it("exempts the register itself and its own four scripts, and nothing else", () => {
    expect(swept.some((file) => file.startsWith(`${REGISTER_DIR}/`))).toBe(false);
    for (const script of WALL_EXEMPT_FILES) expect(swept).not.toContain(script);
    expect(WALL_EXEMPT_FILES).toEqual([
      "scripts/register-freeze.ts",
      "scripts/register-grade.ts",
      "src/projections/season-week/steps.ts",
      "src/projections/season-week/steps.test.ts",
    ]);
  });
});

describe("THE WALL: nothing in the tree reaches the register", () => {
  it("finds no reference to src/projections/register anywhere it sweeps", () => {
    expect(wallOffenders()).toEqual([]);
  });
});

/** Each planted evasion: a file that could plausibly exist, and the syntax it would hide in. */
const PLANTED_EVASIONS: readonly { readonly name: string; readonly file: string; readonly source: string }[] = [
  {
    name: "a plain static import",
    file: "src/projections/market/blend.ts",
    source: 'import { takeFreeze } from "@/projections/register/freeze";\n',
  },
  {
    name: "a DYNAMIC import(), which carries no from clause",
    file: "src/projections/market/blend.ts",
    source: 'const mod = await import("@/projections/register/store");\n',
  },
  {
    name: "a require(), which carries no from clause either",
    file: "src/projections/laws/measure.ts",
    source: 'const store = require("../register/store");\n',
  },
  {
    name: "a RE-EXPORT PROXY in a directory no allowlist would name",
    file: "src/lib/board-helpers.ts",
    source: 'export { takeFreeze } from "@/projections/register/freeze";\n',
  },
  {
    name: "a wildcard re-export proxy",
    file: "src/lib/board-helpers.ts",
    source: 'export * from "@/projections/register/store";\n',
  },
  {
    name: "a relative import from inside src/projections itself",
    file: "src/projections/backtest.ts",
    source: 'import { gradeWeek } from "./register/grade";\n',
  },
  {
    name: "a relative import climbing out of a sibling engine directory",
    file: "src/projections/preseason/board.ts",
    source: 'import type { RegisterFreezeRow } from "../register/store";\n',
  },
  {
    name: "a backtick specifier, which a quote-only regex would miss",
    file: "scripts/blend-fit.ts",
    source: "const mod = await import(`@/projections/register/store`);\n",
  },
  {
    name: "a repo-relative path spelled without the alias",
    file: "scripts/measure-laws.ts",
    source: 'const rows = readFileSync("src/projections/register/store.ts");\n',
  },
  {
    name: "an import hidden behind a trailing comment",
    file: "src/projections/model/efficiency.ts",
    source: 'import { x } from "@/projections/register/store"; // harmless helper\n',
  },
];

/** Things that name something register-ish and are NOT breaches. A sweep that flagged these would
 *  be turned off within a week, which is its own kind of failure. */
const PLANTED_INNOCENTS: readonly { readonly name: string; readonly file: string; readonly source: string }[] = [
  {
    name: "the laws registry, whose name merely contains the word",
    file: "src/projections/laws/pricing.ts",
    source: 'import { registry } from "@/projections/laws/registry";\n',
  },
  {
    name: "a relative registry import",
    file: "src/projections/laws/pricing.ts",
    source: 'import { registry } from "./registry";\n',
  },
  {
    name: "an unrelated module whose filename starts with the word",
    file: "src/lib/forms.ts",
    source: 'import { register } from "@/lib/register-helper";\n',
  },
  {
    name: "prose naming the directory in a full-line comment",
    file: "src/db/schema.ts",
    source: '// There is no UPDATE anywhere in "src/projections/register".\n',
  },
  {
    name: "prose naming the directory in a block comment",
    file: "src/db/schema.ts",
    source: '/**\n * See "@/projections/register/store" for the discipline this table enforces.\n */\n',
  },
];

describe("THE WALL: planted evasions are caught", () => {
  it.each(PLANTED_EVASIONS)("catches $name", ({ file, source, name }) => {
    const found = registerReferencesIn(file, source);
    expect(found, `the wall failed to catch ${name}`).toHaveLength(1);
    expect(found[0]!.file).toBe(file);
    expect(found[0]!.lineNumber).toBeGreaterThanOrEqual(1);
  });

  it.each(PLANTED_INNOCENTS)("does not fire on $name", ({ file, source, name }) => {
    expect(registerReferencesIn(file, source), `the wall wrongly flagged ${name}`).toEqual([]);
  });

  it("resolves the three specifier forms the tree uses, and refuses a bare package name", () => {
    expect(resolveSpecifier("src/projections/market", "@/projections/register/store")).toBe("src/projections/register/store");
    expect(resolveSpecifier("src/projections/market", "../register/store")).toBe("src/projections/register/store");
    expect(resolveSpecifier("scripts", "src/projections/register")).toBe("src/projections/register");
    expect(resolveSpecifier("src/projections/market", "drizzle-orm")).toBeNull();
    expect(resolvesIntoRegister("src/projections/registers/other")).toBe(false);
    expect(resolvesIntoRegister(null)).toBe(false);
  });
});

/**
 * THE SAME EVASIONS, ON DISK. The block above proves the DETECTOR sees them; this proves the WALK
 * reaches them — that a proxy in `src/lib/` is actually opened and read, and that the exemption for
 * the register's own scripts is narrow enough not to cover a fit script beside them.
 */
describe("THE WALL: planted evasions are caught by the real walk over a real tree", () => {
  let planted: string;

  beforeAll(() => {
    planted = mkdtempSync(join(tmpdir(), "wall-plant-"));
    const write = (file: string, source: string): void => {
      mkdirSync(dirname(join(planted, file)), { recursive: true });
      writeFileSync(join(planted, file), source, "utf8");
    };
    // Two evasions the first version of this wall would both have missed.
    write("src/projections/market/blend.ts", 'const mod = await import("@/projections/register/store");\n');
    write("src/lib/board-helpers.ts", 'export { takeFreeze } from "@/projections/register/freeze";\n');
    // A fit script, which is swept, beside the register's own scripts, which are not.
    write("scripts/blend-fit.ts", 'import { gradeWeek } from "@/projections/register/grade";\n');
    write("scripts/register-freeze.ts", 'import { takeFreeze } from "@/projections/register/freeze";\n');
    write("scripts/register-grade.ts", 'import { gradeWeek } from "@/projections/register/grade";\n');
    // The register's own files, which must not report themselves.
    write("src/projections/register/store.ts", 'export const REGISTER_DIR = "src/projections/register";\n');
    // An innocent bystander, so the walk is proven to read files it does not flag.
    write("src/projections/laws/pricing.ts", 'import { registry } from "./registry";\n');
  });

  afterAll(() => {
    rmSync(planted, { recursive: true, force: true });
  });

  it("walks into every directory, including ones no allowlist named", () => {
    expect([...sweptSourceFiles(planted)].sort()).toEqual([
      "scripts/blend-fit.ts",
      "src/lib/board-helpers.ts",
      "src/projections/laws/pricing.ts",
      "src/projections/market/blend.ts",
    ]);
  });

  it("catches the dynamic import, the re-export proxy and the fit script, and exempts only the register's own", () => {
    const offenders = wallOffenders(planted);
    expect([...offenders.map((offender) => offender.file)].sort()).toEqual([
      "scripts/blend-fit.ts",
      "src/lib/board-helpers.ts",
      "src/projections/market/blend.ts",
    ]);
  });
});

/**
 * LAYER THREE, asserted so it cannot vanish. The eslint rule is the backstop that catches a breach
 * at the moment somebody types it rather than when this suite next runs, and a config refactor that
 * dropped it would leave every docblock in this module overstating the protection.
 */
describe("THE WALL: the eslint backstop exists", () => {
  const config = readFileSync(join(REPO_ROOT, "eslint.config.mjs"), "utf8");

  it("restricts the register path through no-restricted-syntax", () => {
    expect(config).toContain("no-restricted-syntax");
    expect(config).toContain("REGISTER_QUARANTINE_SELECTORS");
  });

  it("covers all four syntaxes the sweep covers, so the two guards agree about what a breach is", () => {
    for (const node of ["ImportDeclaration", "ImportExpression", "ExportNamedDeclaration", "ExportAllDeclaration", "CallExpression"]) {
      expect(config).toContain(node);
    }
  });

  it("exempts the register's own files and nothing else", () => {
    expect(config).toContain(`${REGISTER_DIR}/**`);
    for (const script of WALL_EXEMPT_FILES) expect(config).toContain(script);
  });
});
