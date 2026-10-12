// THE NIGHTLY RUN'S ENTRY POINT. Arguments and environment only; the run is `runNightly` (`run.ts`).
//
//   npm run nightly -w @commish/research                      every step, to ./runs
//   npm run nightly -w @commish/research -- --out=/tmp/runs   another output directory
//   npm run nightly -w @commish/research -- --skip=ingest,capsules
//   npm run nightly -w @commish/research -- --persist-board   retake the product season's board
//
// Exit code 0 when every step ran and every gate passed, 1 otherwise. Never point DATABASE_URL at
// production for a measurement run (`prod-db-is-for-backfills-only`).
import { createDb } from "@research/db/client";
import { unwrapCauseChain } from "@research/db/errors";
import type { Clock } from "@research/domain/timing";
import { envOr, requireEnv } from "@research/lib/env";
import { NIGHTLY_CONFIG } from "./config";
import { NIGHTLY_STEPS, runNightly, type NightlyOptions, type NightlyStepName } from "./run";
import { LocalRunStore } from "./run-store";

function isStepName(value: string): value is NightlyStepName {
  return (NIGHTLY_STEPS as readonly string[]).includes(value);
}

function parseArgs(argv: readonly string[]): NightlyOptions & { readonly out: string } {
  const known = new Set(["--persist-board"]);
  const unknown = argv.filter((arg) => !known.has(arg) && !arg.startsWith("--skip=") && !arg.startsWith("--out="));
  if (unknown.length > 0) throw new Error(`nightly: unknown argument ${unknown.join(" ")}. Known: --out=<dir>, --skip=${NIGHTLY_STEPS.join(",")}, --persist-board.`);
  const skipArg = argv.find((arg) => arg.startsWith("--skip="))?.slice("--skip=".length);
  const skip = (skipArg === undefined ? [] : skipArg.split(",")).map((step) => {
    if (!isStepName(step)) throw new Error(`nightly: --skip takes ${NIGHTLY_STEPS.join(", ")}, got "${step}".`);
    return step;
  });
  const out = argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) ?? envOr(NIGHTLY_CONFIG.outputDirEnv, NIGHTLY_CONFIG.defaultOutputDir);
  return { skip: new Set(skip), persistBoard: argv.includes("--persist-board"), out };
}

/** Seconds the pool is given to close. A pool whose connection never opened can leave `end()`
 *  pending forever, and Node would then exit on an empty loop with code 0 (seen against a missing
 *  database), so the exit code is also set to failure up front and cleared only on success. */
const POOL_CLOSE_TIMEOUT_SECONDS = 5;

async function main(): Promise<number> {
  process.exitCode = 1;
  const options = parseArgs(process.argv.slice(2));
  const db = createDb(requireEnv("DATABASE_URL"));
  const clock: Clock = { now: () => new Date().toISOString() };
  const log = (line: string): void => {
    process.stdout.write(`${new Date().toISOString()} ${line}\n`);
  };
  try {
    const manifest = await runNightly({ db, store: new LocalRunStore(options.out), clock, log }, options);
    return manifest.status === "passed" ? 0 : 1;
  } finally {
    await db.$client.end({ timeout: POOL_CLOSE_TIMEOUT_SECONDS });
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // The driver's own reason (a refused role, a missing table) sits under drizzle's wrapper.
    const causes = unwrapCauseChain(error).map((cause) => (cause instanceof Error ? cause.message : String(cause)));
    process.stderr.write(`nightly: FAILED\n${causes.map((cause) => `  ${cause.split("\n")[0]}`).join("\n")}\n`);
    process.exit(1);
  },
);
