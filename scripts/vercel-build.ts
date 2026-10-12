// THE VERCEL BUILD (`npm run build:vercel`, named in vercel.json): migrate, then build — but
// migrate ONLY on a Production deployment (Neon cost audit 2026-09-07, finding 5). A preview
// build used to apply its branch's migrations to whatever database its `DATABASE_URL` named,
// which was production. The rule itself is `shouldMigrateOnBuild` (`@research-ts/db/deployment`), pure and
// tested; this file is the wire that runs the two commands with the build's own stdio.
import { spawnSync } from "node:child_process";
import { shouldMigrateOnBuild } from "@research-ts/db/deployment";

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? "a signal"}.`);
  }
}

function main(): void {
  if (shouldMigrateOnBuild(process.env)) {
    console.log("[build] production deployment: running migrations before next build.");
    run("npx", ["drizzle-kit", "migrate"]);
  } else {
    console.log(`[build] VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}: skipping migrations (production only).`);
  }
  run("npx", ["next", "build"]);
}

try {
  main();
} catch (error: unknown) {
  console.error(`[build] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
