// THE PACKAGE BOUNDARY, as a sub-second source guard (spec §7: the lanes gate on source guards, not
// suite runs). Every module specifier in every TypeScript file under research/ (static imports,
// re-exports, `import()` and `require()`, as TypeScript's own pre-processor reads them) must be one
// of: a relative path that stays inside research/, the package's own `@research/` alias, a `node:`
// builtin, or a package research/package.json declares. Named and refused outright: `next`, `react`
// and anything under them, and the league app's `@/` alias, which is how a reach into `src/` (and
// so `src/app`) would be spelled. Exits non-zero with one line per offender.
//
// Run: npm run guard -w @commish/research   (or `npx tsx scripts/guard-imports.ts` in research/)
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED_DIRS = ["src", "scripts"];
const SKIPPED_DIRS = new Set(["node_modules"]);
const SOURCE_FILE = /\.(ts|mts|cts|tsx)$/;
const OWN_ALIAS = "@research/";
const FORBIDDEN_PACKAGES = ["next", "react", "react-dom"];

interface Offence {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

function declaredPackages(): ReadonlySet<string> {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
  };
  return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
}

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

/** `@scope/name/deep` -> `@scope/name`, `name/deep` -> `name`. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || builtinModules.includes(specifier);
}

function offenceFor(file: string, specifier: string, packages: ReadonlySet<string>): string | null {
  if (specifier.startsWith(".")) {
    const target = resolve(dirname(file), specifier);
    return target === PACKAGE_ROOT || target.startsWith(PACKAGE_ROOT + sep) ? null : "relative path leaves research/";
  }
  if (specifier.startsWith(OWN_ALIAS)) return null;
  if (specifier === "@" || specifier.startsWith("@/")) return "the league app's @/ alias reaches into src/";
  if (isBuiltin(specifier)) return null;
  const name = packageNameOf(specifier);
  if (FORBIDDEN_PACKAGES.includes(name)) return `${name} is a web framework package`;
  return packages.has(name) ? null : `${name} is not declared in research/package.json`;
}

function offencesIn(file: string, packages: ReadonlySet<string>): readonly Offence[] {
  const info = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
  return info.importedFiles.flatMap(({ fileName: specifier }) => {
    const reason = offenceFor(file, specifier, packages);
    return reason === null ? [] : [{ file: relative(PACKAGE_ROOT, file), specifier, reason }];
  });
}

function main(): void {
  const packages = declaredPackages();
  const files = SCANNED_DIRS.flatMap((dir) => sourceFiles(join(PACKAGE_ROOT, dir)));
  const offences = files.flatMap((file) => offencesIn(file, packages));
  for (const offence of offences) console.error(`${offence.file}: "${offence.specifier}" (${offence.reason})`);
  console.log(`guard-imports: ${files.length} files scanned, ${offences.length} offence${offences.length === 1 ? "" : "s"}.`);
  if (offences.length > 0) process.exitCode = 1;
}

main();
