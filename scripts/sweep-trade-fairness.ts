// The manual re-run for the trade-fairness detector's after-commit flag write (Task 6, ruling
// 22), AND (Plan D, Task 5, fix round 1) the identical after-commit re-run for a held trade's own
// flag CLOSURE once the world supersedes it. `raiseTradeFairnessFlag` and
// `closeSupersededHoldFlag` (both `@/integrity-service/trade-fairness`) each run in their OWN
// transaction, strictly AFTER the trade transaction that made them relevant commits —
// `trade_accepted`/`trade_superseded` are league-scoped and `flag_raised`/`flag_resolved` are
// platform-scoped, so neither can ever share a transaction with the trade write that triggered it
// (Plan A ruling 3). A process that dies in either window leaves the trade itself correct and
// complete, with only the QUESTION (missing flag) or its ANSWER (an open flag over an already-
// superseded trade) out of sync. This script asks the first and closes the second — ONE command,
// because both are re-runs of the identical class of after-commit gap on the identical trade-flag
// machinery, and an operator asking "did every trade-flag write that should have landed actually
// land" wants one answer, not two commands to remember.
//
// Run: npm run trades:sweep [-- --league <leagueId>]
//
// `--league` is OPTIONAL, unlike `sweep-multi-account.ts`'s own required `--league`: the
// multi-account detector has two live triggers that fire per-league on their own, so its script
// is only ever a targeted re-run. These two detectors have no other trigger, so the ordinary
// re-run is "every league's own candidates", each bounded at `INTEGRITY_CONFIG.trade
// .sweepBatchSize` per invocation — `--league` narrows both to one league when an operator already
// knows which trade they're chasing.
//
// NOT CONFIRMED-DESTRUCTIVE, and that is the honest difference from `remove-review.ts`'s own
// `confirm()` prompt: this only ever RAISES a question into the operator queue or CLOSES one that
// the world already answered — it never itself decides a held trade's fate — and both
// `raiseFlag`'s open-subject unique index and `closeSupersededHoldFlag`'s own guarded UPDATE make
// a re-run idempotent by construction. There is nothing here a confirmation step would be
// protecting anyone from.
//
// FLAGS ONLY, same as the detectors it calls: this script raises `trade_fairness` flags and
// resolves `trade_hold` flags the world already answered, and does nothing else — see
// `src/integrity/flag-only.test.ts` for the proof that no code path reachable from here can
// reverse a trade, suspend an account, or touch either manager's roster.
import { getDb } from "@/db/client";
import { sweepSupersededHoldFlags, sweepUnflaggedTrades } from "@/integrity-service/trade-fairness";

const USAGE = "Usage: npm run trades:sweep -- [--league <leagueId>]";

interface Args {
  readonly league: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value.\n${USAGE}`);
    flags.set(key, value);
    i += 1;
  }
  return { league: flags.get("league") };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const scope = args.league === undefined ? "all leagues" : `league ${args.league}`;

  const raiseResult = await sweepUnflaggedTrades(db, { leagueId: args.league });
  // Printed LAST, and ALWAYS — even a zero-candidate run says so explicitly, rather than exiting
  // quietly in a way that could be mistaken for "nothing to check yet".
  console.log(`${scope}: checked ${raiseResult.tradesChecked} unflagged accepted trade(s), raised ${raiseResult.flagsRaised} flag(s) over the threshold.`);

  const closeResult = await sweepSupersededHoldFlags(db, { leagueId: args.league });
  console.log(
    `${scope}: checked ${closeResult.flagsChecked} open trade_hold flag(s) over an already-superseded trade, closed ${closeResult.flagsClosed} of them honestly.`,
  );

  console.log(JSON.stringify({ raise: raiseResult, close: closeResult }));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
