import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { stripCommentsPreservingLines } from "@research/lib/source-text";

/**
 * THE WALL'S DETECTOR — the machinery `wall.source.test.ts` sweeps the tree with, extracted so it
 * can be tested against PLANTED evasions rather than only against a tree that happens to be clean.
 *
 * A structural test that only ever runs over compliant source proves nothing about what it would
 * catch. Everything here is therefore either pure (`registerReferencesIn`, which takes a file path
 * and its text and never touches disk) or root-parameterised (`sweptSourceFiles`, `wallOffenders`),
 * so the same code that guards the real tree can be pointed at a temporary directory containing a
 * dynamic `import()` and a re-export proxy and asked to find them.
 *
 * WHY A STRING-LITERAL SCAN RATHER THAN CLAUSE PARSING (fix round 1, HIGH). The first version of
 * this wall matched a `from "..."` regex over a directory ALLOWLIST, and had two evasion paths a
 * review found: a dynamic `import()` or a `require()` carries no `from` clause and slipped the
 * regex entirely, and a one-line re-export proxy in any directory the allowlist did not name was
 * never swept at all. Both are fixed by refusing to be clever: every quoted or backticked literal in
 * every source file under `src/` and `scripts/` is extracted, RESOLVED as if it were a module
 * specifier, and flagged if it lands inside the register. Resolution is what keeps this precise
 * rather than merely broad — a bare mention of the word "register" is not a hit, and `./register` in
 * some unrelated directory does not resolve into `src/projections/register`, so it is not one either.
 *
 * TEST FILES ARE SWEPT TOO, unlike the design sweeps this walker's sibling serves. A `.test.ts`
 * under `preseason/` that imported the register would not ship, but it would be a working example
 * of the import somebody later copies, and excluding tests would leave exactly the kind of
 * unswept corner the re-export evasion above lived in.
 *
 * COMMENTS ARE STRIPPED FIRST. `src/db/schema.ts`'s own table docblock names this directory in
 * prose, and prose is not an import. Only FULL-LINE `//` comments and `/* * /` blocks are blanked
 * (`stripCommentsPreservingLines`' own behaviour), so a trailing comment cannot be used to hide the
 * live half of an import line, and code inside a block comment does not execute in the first place.
 */

/** The one directory nothing outside itself may reach into, repo-root-relative and POSIX-spelled. */
export const REGISTER_DIR = "research/src/projections/register";

/** The register's own operator scripts, which necessarily import it. Everything else under
 *  `scripts/` is swept, because a fit script that read a frozen row would leak this season's
 *  prospective record into next season's constants just as surely as a module would.
 *  `src/projections/season-week/steps.ts` (Task 2's weekly cadence, moved out of `scripts/` in the
 *  job-system round so the Vercel tick route could reach it — `src/**` may not import
 *  `scripts/**`) is the third: it orchestrates `takeFreeze` and `gradeWeek` on a schedule and has
 *  to read `latestFreezeFor` to decide skip-vs-supersede, which is exactly the same "necessarily
 *  imports it" shape the first two scripts already have. Its test file is the fourth, for the same
 *  reason `register/*.test.ts` never needed a separate exemption: it seeds and asserts against the
 *  register directly, the way `freeze.test.ts` and `grade.test.ts` do — it just cannot inherit the
 *  directory-wide exemption those two get, because it lives beside its module under `src/jobs/`,
 *  a swept location, rather than inside `src/projections/register/` itself. */
export const WALL_EXEMPT_FILES: readonly string[] = [
  "scripts/register-freeze.ts",
  "scripts/register-grade.ts",
  "research/src/projections/season-week/steps.ts",
  "research/src/projections/season-week/steps.test.ts",
];

/** Everything that ships or runs. Not `e2e/` — it is the browser harness, cannot reach a database,
 *  and is already forbidden from being imported by `src/**` by its own eslint boundary. */
export const SWEPT_ROOTS: readonly string[] = ["src", "scripts", "research/src", "research/scripts"];

/** Every extension a module specifier can hide in. Wider than the tree currently uses, on purpose:
 *  a `.mjs` helper added next year is swept the day it exists rather than the day somebody
 *  remembers this list. */
export const SWEPT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

const REPO_ROOT = process.cwd();

/** One place a swept file names the register. */
export interface RegisterReference {
  readonly file: string;
  readonly lineNumber: number;
  readonly line: string;
  /** The literal as written, before resolution — so a failure names what to delete. */
  readonly specifier: string;
}

/**
 * Every source file under `roots`, recursively, repo-root-relative and POSIX-spelled, minus the
 * register itself and its own two scripts.
 *
 * `root` is a parameter rather than a constant so the plant-and-detect tests can run this exact
 * function over a temporary tree. Defaulting it to the repo root means the real sweep reads
 * identically to the planted one.
 */
export function sweptSourceFiles(root: string = REPO_ROOT, roots: readonly string[] = SWEPT_ROOTS): readonly string[] {
  function walk(dir: string): readonly string[] {
    const full = join(root, dir);
    if (!existsSync(full)) return [];
    return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const path = posix.join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      if (!SWEPT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) return [];
      return [path];
    });
  }
  return roots
    .flatMap(walk)
    .filter((file) => file !== REGISTER_DIR && !file.startsWith(`${REGISTER_DIR}/`))
    .filter((file) => !WALL_EXEMPT_FILES.includes(file));
}

/**
 * A module specifier resolved to a repo-root-relative path, or `null` where it does not name one.
 *
 * The forms this tree actually uses: the `@/` alias (which `tsconfig.json` maps to `src/`), the
 * `@research/` alias (`research/src/`, the prep site carve-out), a relative path, and — for the odd tool that spells a path rather than an import — a repo-relative
 * one. A bare package specifier (`drizzle-orm`) resolves to nothing local and is not a wall concern.
 */
export function resolveSpecifier(fromDir: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return posix.normalize(`src/${specifier.slice(2)}`);
  if (specifier.startsWith("@research/")) return posix.normalize(`research/src/${specifier.slice("@research/".length)}`);
  if (specifier.startsWith("./") || specifier.startsWith("../")) return posix.normalize(posix.join(fromDir, specifier));
  if (SWEPT_ROOTS.some((rootDir) => specifier === rootDir || specifier.startsWith(`${rootDir}/`))) {
    return posix.normalize(specifier);
  }
  return null;
}

/** Whether a resolved path is the register or lives inside it. */
export function resolvesIntoRegister(resolved: string | null): boolean {
  return resolved !== null && (resolved === REGISTER_DIR || resolved.startsWith(`${REGISTER_DIR}/`));
}

/**
 * Every quoted or backticked literal on a line. Deliberately blunt: the three quote characters are
 * excluded from the body, so this matches path-shaped literals cleanly and gives up on prose
 * containing an apostrophe, which is exactly the trade a module-specifier scan wants.
 */
const QUOTED_LITERAL = /(['"`])([^'"`\r\n]*)\1/g;

/**
 * Every place `source` names the register, whatever syntax it used to do it.
 *
 * PURE — takes the file's path only to resolve relative specifiers against, and never reads disk.
 * That is what makes the planted-evasion tests possible: a synthetic `src/projections/market/x.ts`
 * carrying a dynamic import is handed straight to this function.
 */
export function registerReferencesIn(file: string, source: string): readonly RegisterReference[] {
  const fromDir = posix.dirname(file);
  const found: RegisterReference[] = [];
  stripCommentsPreservingLines(source)
    .split("\n")
    .forEach((line, index) => {
      for (const match of line.matchAll(QUOTED_LITERAL)) {
        const specifier = match[2] ?? "";
        // Cheap pre-filter: nothing that does not spell the directory's own name can resolve into
        // it, and this keeps the resolver off every string in the repository.
        if (!specifier.includes("register")) continue;
        if (!resolvesIntoRegister(resolveSpecifier(fromDir, specifier))) continue;
        found.push({ file, lineNumber: index + 1, line: line.trim(), specifier });
      }
    });
  return found;
}

/** The whole sweep: every swept file under `root`, read and checked. */
export function wallOffenders(root: string = REPO_ROOT, roots: readonly string[] = SWEPT_ROOTS): readonly RegisterReference[] {
  return sweptSourceFiles(root, roots).flatMap((file) => registerReferencesIn(file, readFileSync(join(root, file), "utf8")));
}
