import { join } from "node:path";

/**
 * A path inside this package, from its root, whatever directory the process was started in: the
 * root `npm run` scripts start at the repository root, `npm run -w @commish/research-ts` and a
 * script run by hand start here, and a cwd-relative "research-ts/..." resolves to the wrong place
 * from one of them. Read at call time, never at module load, so a bundler that does not provide
 * `import.meta.dirname` (the league app's Next.js build imports modules beside this one) never
 * evaluates it.
 */
export function packagePath(relativeToPackageRoot: string): string {
  return join(import.meta.dirname, "..", "..", relativeToPackageRoot);
}
