// THE TYPESCRIPT SIDE OF A PARITY CASE — runs the oracle's own ingest, from `src/` on main, against
// a scratch database migrated by drizzle, with `fetch` answered from the case's recordings.
//
//   DATABASE_URL=... PARITY_NOW=<iso> npx tsx research/parity/ts/run.ts <case> <fixtureDir>...
//
// Every case here calls the SAME TypeScript function the job system or the operator script calls
// in production, with the same arguments, so what is compared is the real ingest and not a
// re-assembly of its parts. The last line of stdout is `{"requested": [...]}`: which recordings
// were served, for the harness to check both sides asked for exactly the same inputs.
import { createDb, type Db } from "@/db/client";
import { installReplay } from "./replay";
import { TS_CASES } from "./cases";

export interface TsCaseContext {
  readonly db: Db;
  /** The fixed instant both sides read as now. */
  readonly now: Date;
}

export type TsCase = (ctx: TsCaseContext) => Promise<void>;

/**
 * THE WALL CLOCK, FROZEN AT THE PARITY INSTANT. Several production paths read `new Date()` where
 * no clock is injected (a publisher's fetched-at stamp, the week-one roster's default clock), and
 * the Python side is handed the same instant explicitly. Only the no-argument forms are frozen;
 * `new Date(x)` and `Date.UTC` behave exactly as before.
 */
function freezeWallClock(nowMs: number): void {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      if (args.length === 0) super(nowMs);
      else super(...(args as ConstructorParameters<typeof Date>));
    }
    static override now(): number {
      return nowMs;
    }
  }
  globalThis.Date = FrozenDate as DateConstructor;
}

async function main(): Promise<void> {
  const [name, ...fixtureDirs] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  const nowIso = process.env.PARITY_NOW;
  if (name === undefined || url === undefined || nowIso === undefined) {
    throw new Error("usage: DATABASE_URL=... PARITY_NOW=... tsx run.ts <case> <fixtureDir>...");
  }
  const run = TS_CASES[name];
  if (run === undefined) throw new Error(`no TypeScript case named ${name}`);
  freezeWallClock(Date.parse(nowIso));
  const requested = installReplay(fixtureDirs);
  const db = createDb(url, { max: 1 });
  try {
    await run({ db, now: new Date(nowIso) });
  } finally {
    await db.$client.end();
  }
  process.stdout.write(`\n${JSON.stringify({ requested })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
