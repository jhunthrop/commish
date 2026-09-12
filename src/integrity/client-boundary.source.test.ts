import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * A SERVER MODULE NEVER IMPORTS A NON-COMPONENT VALUE FROM A `"use client"` MODULE.
 *
 * TWO PRODUCTION BREAKS IN ONE WEEK, ONE CAUSE. Next turns EVERY export of a `"use client"`
 * module into a client-reference proxy. A component survives the crossing because the server
 * only ever hands it to the renderer. Anything else does not: calling it throws, and reading a
 * property off it yields garbage or throws. Both times the value looked utterly harmless.
 *
 *   1. `chipClassName` (fix 39c12062, merged 28134973). Fix round 3 exported the chip's class
 *      helper from `segment-group.tsx`, a client module because `SegmentGroup` takes an
 *      `onChange`. `BrowseFilters` is a SERVER component on purpose — the URL is the whole filter
 *      state, so `/browse` filters with no JavaScript at all — and calling the helper during a
 *      server render threw *"Attempted to call chipClassName() from the server but chipClassName
 *      is on the client"*. Every render of `/browse` lost its entire filter nav. The helper moved
 *      to `chip.tsx`, which carries no directive.
 *   2. `BOARD_FORMAT_QUERY_KEY` (fix 58649c21). The board's URL key was exported from
 *      `scoring-format-picker.tsx`, also a client module, and the server component doing
 *      `searchParams[BOARD_FORMAT_QUERY_KEY]` indexed by a proxy rather than by the string
 *      `"format"`. `params[<function>]` is `undefined`, so every `?format=` was dropped on the
 *      floor and the board answered PPR whichever pill a reader pressed. The constant moved to
 *      `board-formats.ts`, which carries no directive.
 *
 * VITEST CANNOT SEE EITHER ONE. jsdom has no server/client boundary: under test both modules are
 * just modules, the import resolves to the real value, and the suite passes green while the
 * surface is broken in production. The browser caught both, days late and by accident. So the
 * check has to be structural, and this is it.
 *
 * HOW IT DECIDES. Every non-test module under `src/` is parsed for its directive, its exports and
 * its value imports (a `import type` / `{ type X }` import is erased before it ever runs and is
 * always fine).
 *
 *   - A module's exports are classified. A PascalCase `function`/`class`, a PascalCase `const`
 *     assigned something function-shaped (an arrow, `memo(`, `forwardRef(`), and anything named
 *     `use[A-Z]` are components and hooks: allowed to cross. EVERY OTHER VALUE EXPORT is a
 *     non-component export — a constant, a class-name helper, a plain function, a lookup table.
 *   - The SERVER GRAPH is what a server render can reach: a module is in it unless it carries the
 *     directive itself or every one of its importers is already in the client graph (a fixpoint,
 *     so a directive-free helper used only by client components is correctly exempt). A
 *     `page.tsx`, `layout.tsx` or `route.ts` under `src/app` is a server module by definition and
 *     never absorbed into the client graph, whoever imports it. A module nobody imports counts as
 *     a server module, which is the fail-safe direction.
 *   - An import is resolved THROUGH RE-EXPORT CHAINS, because `@/components/ui` is a barrel: a
 *     name that reaches a server module through `index.ts` still crossed the boundary at whatever
 *     client module re-exported it, and that module is what the failure names.
 *
 * VALIDATED AGAINST THE SCARS. Run over the trees at `39c12062^` and `58649c21^` this reports
 * `browse-filters.tsx: chipClassName from segment-group.tsx` and `context.ts:
 * BOARD_FORMAT_QUERY_KEY from scoring-format-picker.tsx`, and both are gone at their fix commits.
 * `AVATAR_TONE_CLASS` was a third live instance of the same shape, found by this sweep and fixed
 * alongside it (`avatar-tone.tsx`). The fixture below re-proves the catch from a temp tree on
 * every run, so the sweep can never quietly degrade into one that sees nothing.
 *
 * NO ALLOWLIST. There is no shape of this that is safe on purpose. A value that both sides need
 * belongs in a module with no directive on it, which is what all three fixes did.
 */

// ---------------------------------------------------------------------------------------------
// Module records. Pure input, so the fixture tree and the real tree run identical code.
// ---------------------------------------------------------------------------------------------

export interface ModuleSource {
  /** Root-relative, POSIX-separated: `src/components/ui/chip.tsx`. */
  readonly file: string;
  readonly source: string;
}

export interface BoundaryViolation {
  readonly file: string;
  readonly importName: string;
  readonly sourceModule: string;
}

/** Every non-test `.ts`/`.tsx` under `root/dir`, root-relative and POSIX-separated. */
export function readModuleSources(root: string, dir: string): readonly ModuleSource[] {
  function walk(relative: string): readonly string[] {
    const full = join(root, relative);
    if (!statSync(full).isDirectory()) return [];
    return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const path = posix.join(relative, entry.name);
      if (entry.isDirectory()) return walk(path);
      const sweepable = (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !entry.name.includes(".test.") && !entry.name.startsWith("test-");
      return sweepable ? [path] : [];
    });
  }
  return walk(dir).map((file) => ({ file, source: readFileSync(join(root, file), "utf8") }));
}

// ---------------------------------------------------------------------------------------------
// Parsing.
// ---------------------------------------------------------------------------------------------

/** Comments blanked, line structure kept, so a docblock retelling one of these incidents is
 *  prose and never an import — the carve-out every source sweep in this directory makes. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
}

/** True when `"use client"` is the module's FIRST statement, which is the only place it counts. */
export function isClientModule(source: string): boolean {
  return /^["']use client["']/.test(stripComments(source).trimStart());
}

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const HOOK_NAME = /^use[A-Z]/;
/** An arrow, a function expression, or a React wrapper — the shapes a component `const` takes. */
const FUNCTION_SHAPED = /^\s*(?:[:=][^=]*?)?=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>|(?:React\.)?(?:memo|forwardRef)\(|dynamic\()/;

interface ReExport {
  readonly specifier: string;
  readonly imported: string;
}

interface ParsedModule {
  readonly file: string;
  readonly client: boolean;
  /** Locally defined exports, by name, `true` when the value may cross the boundary. */
  readonly local: ReadonlyMap<string, boolean>;
  readonly reExports: ReadonlyMap<string, ReExport>;
  readonly starReExports: readonly string[];
  readonly imports: readonly ParsedImport[];
}

interface ParsedImport {
  readonly specifier: string;
  /** `{ imported, local }` pairs; `imported` is `default` or `*` for those forms. */
  readonly names: readonly string[];
}

/** Every top-level binding in the file, by name, classified as component-ish or not. */
function declarations(code: string): Map<string, boolean> {
  const found = new Map<string, boolean>();
  for (const match of code.matchAll(/^\s*(?:export\s+)?(?:declare\s+)?(?:async\s+)?(const|let|var|function|function\*|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    const [kind, name] = [match[1]!, match[2]!];
    if (HOOK_NAME.test(name)) {
      found.set(name, true);
      continue;
    }
    if (kind === "function" || kind === "function*" || kind === "class") {
      found.set(name, PASCAL_CASE.test(name));
      continue;
    }
    const rest = code.slice(match.index + match[0].length);
    found.set(name, PASCAL_CASE.test(name) && FUNCTION_SHAPED.test(rest));
  }
  return found;
}

function parseModule(file: string, source: string): ParsedModule {
  const code = stripComments(source);
  const declared = declarations(code);
  const local = new Map<string, boolean>();
  const reExports = new Map<string, ReExport>();
  const starReExports: string[] = [];

  for (const match of code.matchAll(/^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    const name = match[1]!;
    local.set(name, declared.get(name) ?? PASCAL_CASE.test(name));
  }
  // `export type X` / `export interface X` are erased at compile time and never cross anything.
  for (const match of code.matchAll(/^\s*export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm)) local.delete(match[1]!);

  for (const match of code.matchAll(/^\s*export\s*\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/gm)) {
    const specifier = match[2];
    for (const name of namedBindings(match[1]!)) {
      if (specifier === undefined) local.set(name.local, declared.get(name.imported) ?? PASCAL_CASE.test(name.local));
      else reExports.set(name.local, { specifier, imported: name.imported });
    }
  }
  for (const match of code.matchAll(/^\s*export\s*\*\s*from\s*["']([^"']+)["']/gm)) starReExports.push(match[1]!);
  // A default export is a component in every case this codebase has: pages, layouts, and the
  // occasional lazily loaded panel. Classified as crossable so the sweep stays quiet about them.
  if (/^\s*export\s+default\b/m.test(code)) local.set("default", true);

  return { file, client: isClientModule(source), local, reExports, starReExports, imports: parseImports(code) };
}

/** `{ a, b as c, type D }` to its value bindings; `type` specifiers are dropped. */
function namedBindings(clause: string): readonly { readonly imported: string; readonly local: string }[] {
  return clause
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !/^type\s/.test(part))
    .flatMap((part) => {
      const match = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      return match === null ? [] : [{ imported: match[1]!, local: match[2] ?? match[1]! }];
    });
}

function parseImports(code: string): readonly ParsedImport[] {
  const imports: ParsedImport[] = [];
  for (const match of code.matchAll(/^\s*import\s+([\s\S]*?)\s*from\s*["']([^"']+)["']/gm)) {
    const clause = match[1]!;
    if (/^type\b/.test(clause.trimStart())) continue; // `import type { X } from …` — erased.
    const braceAt = clause.indexOf("{");
    const head = braceAt === -1 ? clause : clause.slice(0, braceAt);
    const names: string[] = [];
    if (/^\s*[A-Za-z_$][\w$]*/.test(head)) names.push("default");
    if (/\*\s*as\s+/.test(head)) names.push("*");
    if (braceAt !== -1) names.push(...namedBindings(clause.slice(braceAt + 1, clause.lastIndexOf("}"))).map((name) => name.imported));
    imports.push({ specifier: match[2]!, names });
  }
  return imports;
}

// ---------------------------------------------------------------------------------------------
// The sweep.
// ---------------------------------------------------------------------------------------------

/** Route entries are server modules by definition, whatever imports them. */
const ROUTE_ENTRY = /(?:^|\/)(?:page|layout|route|template|default|not-found|loading|sitemap|robots)\.tsx?$/;

function isRouteEntry(file: string): boolean {
  return (file.startsWith("src/app/") && ROUTE_ENTRY.test(file)) || file === "src/middleware.ts" || file === "src/instrumentation.ts";
}

export function clientBoundaryViolations(modules: readonly ModuleSource[]): readonly BoundaryViolation[] {
  const parsed = new Map(modules.map((entry) => [entry.file, parseModule(entry.file, entry.source)]));

  function resolveSpecifier(fromFile: string, specifier: string): string | null {
    const base = specifier.startsWith("@/")
      ? posix.join("src", specifier.slice(2))
      : specifier.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(fromFile), specifier))
        : null;
    if (base === null) return null; // a package, never ours
    return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => parsed.has(candidate)) ?? null;
  }

  // The client graph: the directive's modules, plus every module all of whose importers are
  // already in it. A directive-free helper reached only from client components is not a hazard.
  const importers = new Map<string, Set<string>>(modules.map((entry) => [entry.file, new Set<string>()]));
  for (const owner of parsed.values()) {
    for (const record of owner.imports) {
      const target = resolveSpecifier(owner.file, record.specifier);
      if (target !== null) importers.get(target)?.add(owner.file);
    }
  }
  const clientGraph = new Set([...parsed.values()].filter((owner) => owner.client).map((owner) => owner.file));
  for (let growing = true; growing; ) {
    growing = false;
    for (const owner of parsed.values()) {
      if (clientGraph.has(owner.file) || isRouteEntry(owner.file)) continue;
      const from = importers.get(owner.file)!;
      if (from.size > 0 && [...from].every((importer) => clientGraph.has(importer))) {
        clientGraph.add(owner.file);
        growing = true;
      }
    }
  }

  /** Follows `name` through re-export chains, remembering the first client module it crossed. */
  function trace(file: string, name: string, seen: Set<string>): { readonly crossable: boolean; readonly clientHop: string | null } | null {
    const key = `${file}|${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const owner = parsed.get(file);
    if (owner === undefined) return null;
    const hop = owner.client ? file : null;
    const carry = (found: { readonly crossable: boolean; readonly clientHop: string | null } | null) =>
      found === null ? null : { crossable: found.crossable, clientHop: hop ?? found.clientHop };

    const declared = owner.local.get(name);
    if (declared !== undefined) return { crossable: declared, clientHop: hop };
    const reExport = owner.reExports.get(name);
    if (reExport !== undefined) {
      const target = resolveSpecifier(file, reExport.specifier);
      // A re-export of a package's name still crosses THIS module's boundary if it is a client one.
      if (target === null) return hop === null ? null : { crossable: PASCAL_CASE.test(name) || HOOK_NAME.test(name), clientHop: hop };
      return carry(trace(target, reExport.imported, seen));
    }
    for (const specifier of owner.starReExports) {
      const target = resolveSpecifier(file, specifier);
      const found = target === null ? null : trace(target, name, seen);
      if (found !== null) return carry(found);
    }
    return null;
  }

  const violations: BoundaryViolation[] = [];
  for (const owner of parsed.values()) {
    if (clientGraph.has(owner.file)) continue; // not reachable from a server render
    for (const record of owner.imports) {
      const target = resolveSpecifier(owner.file, record.specifier);
      if (target === null) continue;
      for (const name of record.names) {
        if (name === "*") {
          // A namespace import hands the server every export the module has, so it is a
          // violation exactly when one of them could not have crossed on its own.
          const hazard = parsed.get(target)!;
          if (hazard.client && [...hazard.local.values()].some((crossable) => !crossable)) {
            violations.push({ file: owner.file, importName: "* (namespace)", sourceModule: target });
          }
          continue;
        }
        const found = trace(target, name, new Set());
        if (found !== null && found.clientHop !== null && !found.crossable) {
          violations.push({ file: owner.file, importName: name, sourceModule: found.clientHop });
        }
      }
    }
  }
  return violations;
}

function format(violations: readonly BoundaryViolation[]): string {
  return violations.map((violation) => `${violation.file}: imports ${violation.importName} from ${violation.sourceModule} ("use client")`).join("\n");
}

// ---------------------------------------------------------------------------------------------
// The fixture tree: the two incidents, rebuilt small, caught on every run.
// ---------------------------------------------------------------------------------------------

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "client-boundary-"));

function fixture(file: string, source: string): void {
  const full = join(FIXTURE_ROOT, file);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, source);
}

fixture("src/picker.tsx", ['"use client";', "", 'export const FORMAT_QUERY_KEY = "format";', "export function FormatPicker() { return null; }", "export const useFormat = () => FORMAT_QUERY_KEY;", 'export type Format = "ppr";'].join("\n"));
fixture("src/barrel.ts", ['export { FORMAT_QUERY_KEY, FormatPicker } from "./picker";'].join("\n"));
fixture("src/app/board/page.tsx", ['import { FORMAT_QUERY_KEY } from "@/picker";', "export default function Page() { return FORMAT_QUERY_KEY; }"].join("\n"));
fixture("src/board-context.ts", ['import { FORMAT_QUERY_KEY } from "./barrel";', "export const key = FORMAT_QUERY_KEY;"].join("\n"));
fixture("src/safe-server.tsx", ['import type { Format } from "@/picker";', 'import { FormatPicker, useFormat } from "@/picker";', "export function Panel(props: { f: Format }) { return [FormatPicker, useFormat, props]; }"].join("\n"));

afterAll(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

describe("the fixture tree proves the sweep catches the class it exists for", () => {
  const found = clientBoundaryViolations(readModuleSources(FIXTURE_ROOT, "src"));

  it("catches a constant a server page imports straight out of a client module", () => {
    expect(found).toContainEqual({ file: "src/app/board/page.tsx", importName: "FORMAT_QUERY_KEY", sourceModule: "src/picker.tsx" });
  });

  it("catches the same constant reaching a server module through a barrel's re-export", () => {
    expect(found).toContainEqual({ file: "src/board-context.ts", importName: "FORMAT_QUERY_KEY", sourceModule: "src/picker.tsx" });
  });

  it("lets a component, a hook and a type-only import cross untouched", () => {
    expect(found.filter((violation) => violation.file === "src/safe-server.tsx"), format(found)).toEqual([]);
  });

  it("reports nothing else at all, so the rule is the narrow one it claims to be", () => {
    expect(found.length, format(found)).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// The real tree.
// ---------------------------------------------------------------------------------------------

const SWEPT = readModuleSources(process.cwd(), "src");

describe("no server module imports a non-component value from a \"use client\" module", () => {
  it("sweeps a real tree, so an empty scan can never pass silently", () => {
    expect(SWEPT.length).toBeGreaterThan(800);
    expect(SWEPT.filter((entry) => isClientModule(entry.source)).length).toBeGreaterThan(100);
  });

  it("finds no crossing anywhere under src/", () => {
    const found = clientBoundaryViolations(SWEPT);
    expect(found, format(found)).toEqual([]);
  });
});
