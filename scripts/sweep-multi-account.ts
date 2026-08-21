// The manual re-run for the multi-account detector (ruling 11): `joinLeagueInTx`'s own trigger
// (`@/league-service/join`'s `triggerMultiAccountSweep`) fires the sweep once, right after a
// seat is filled — this script is for the two cases that trigger cannot cover: a league whose
// members' signals moved AFTER it filled up (a later sign-in from a new device, more draft
// picks), or a trigger that ran and logged a failure instead of raising what it found.
//
// Run: npm run integrity:sweep -- --league <leagueId>
//
// FLAGS ONLY, same as the detector it calls: this script raises `PENDING_REVIEW` flags into the
// operator queue and does nothing else — see `src/integrity/flag-only.test.ts` for the proof
// that no code path reachable from here can suspend, ban or restrict an account.
import { getDb } from "@/db/client";
import { defaultSweepDeps, sweepLeagueForMultiAccounts } from "@/integrity-service/multi-account";

const USAGE = "Usage: npm run integrity:sweep -- --league <leagueId>";

interface Args {
  readonly league: string;
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
  const league = flags.get("league");
  if (league === undefined) throw new Error(`--league is required.\n${USAGE}`);
  return { league };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const result = await sweepLeagueForMultiAccounts(db, args.league, defaultSweepDeps());
  console.log(`league ${result.leagueId}: compared ${result.pairsCompared} pair(s), raised ${result.flagsRaised} flag(s).`);
  console.log(JSON.stringify(result));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
