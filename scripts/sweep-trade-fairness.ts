// The manual re-run for the trade-fairness detector's after-commit flag write (Task 6, ruling
// 22). `raiseTradeFairnessFlag` (`@/integrity-service/trade-fairness`) runs in its OWN
// transaction, strictly AFTER `acceptTrade`'s own commit — `trade_accepted` is league-scoped and
// `flag_raised` is platform-scoped, so the two can never share one transaction (Plan A ruling 3).
// A process that dies in that window leaves a lopsided trade correct and complete, with only the
// QUESTION missing: the trade stands, the audit trail is whole, and nobody asked whether it was
// fair. This script asks.
//
// Run: npm run trades:sweep [-- --league <leagueId>]
//
// `--league` is OPTIONAL, unlike `sweep-multi-account.ts`'s own required `--league`: the
// multi-account detector has two live triggers that fire per-league on their own, so its script
// is only ever a targeted re-run. This detector has ONE after-commit call and no other trigger,
// so the ordinary re-run is "every league's unflagged accepted trades", bounded at
// `INTEGRITY_CONFIG.trade.sweepBatchSize` per invocation — `--league` narrows that to one league
// when an operator already knows which trade they're chasing.
//
// NOT CONFIRMED-DESTRUCTIVE, and that is the honest difference from `remove-review.ts`'s own
// `confirm()` prompt: this only ever RAISES a question into the operator queue, it never answers
// one, and `raiseFlag`'s open-subject unique index makes a re-run idempotent by construction — a
// trade already flagged is silently skipped by the sweep's own query, not re-flagged. There is
// nothing here a confirmation step would be protecting anyone from.
//
// FLAGS ONLY, same as the detector it calls: this script raises `trade_fairness` flags into the
// operator queue and does nothing else — see `src/integrity/flag-only.test.ts` for the proof that
// no code path reachable from here can reverse a trade, suspend an account, or touch either
// manager's roster.
import { getDb } from "@/db/client";
import { sweepUnflaggedTrades } from "@/integrity-service/trade-fairness";

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

  const result = await sweepUnflaggedTrades(db, { leagueId: args.league });
  const scope = args.league === undefined ? "all leagues" : `league ${args.league}`;
  // Printed LAST, and ALWAYS — even a zero-candidate run says so explicitly, rather than exiting
  // quietly in a way that could be mistaken for "nothing to check yet".
  console.log(`${scope}: checked ${result.tradesChecked} unflagged accepted trade(s), raised ${result.flagsRaised} flag(s) over the threshold.`);
  console.log(JSON.stringify(result));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
