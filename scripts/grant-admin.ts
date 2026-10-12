// The ONLY door `users.isAdmin` opens through (ruling 15): there is deliberately no in-product
// grant path, so this script IS the operator surface's own bootstrap. It runs against the
// database host, never through a session — a privilege escalation bug therefore has to be a bug
// in Postgres access control rather than a bug in this codebase.
//
// Run: npm run admin:grant -- --user <userId> --by <granterUserIdOrBootstrap> [--revoke]
//
// `--by bootstrap` is legal exactly once per database: `grantAdmin` refuses it the moment any
// admin already exists (a real check inside the transaction, not a convention this script trusts).
// Every grant after the first names an existing operator's own `users.id`, so the grant chain is
// walkable in the audit log from the first admin forward.
//
// `--revoke` takes no value — its presence alone flips the toggle the other way, through the
// SAME writer (`grantAdmin`'s own `WHERE`-guarded UPDATE), never a second function.
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { getDb } from "@research/db/client";
import { users } from "@/db/schema";
import { renderNotice } from "@/integrity/notices";
import { grantAdmin } from "@/integrity-service/grant-admin";

interface Args {
  readonly user: string;
  readonly by: string;
  readonly revoke: boolean;
}

const USAGE = "Usage: npm run admin:grant -- --user <userId> --by <granterUserIdOrBootstrap> [--revoke]";

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  let revoke = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "revoke") {
      revoke = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value.\n${USAGE}`);
    flags.set(key, value);
    i += 1;
  }
  const user = flags.get("user");
  const by = flags.get("by");
  if (user === undefined || by === undefined) throw new Error(`--user and --by are both required.\n${USAGE}`);
  return { user, by, revoke };
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${prompt} [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  // The projection reads `users.isAdmin` under the alias `currentlyAdmin` rather than its own
  // column name — a read aliased to that same name would be textually indistinguishable, to a
  // grep, from the one UPDATE that actually writes it, and
  // `src/data/seed/seed-operator.test.ts`'s "no in-product way to grant it" proof holds this file
  // to that distinction by name.
  const [row] = await db.select({ id: users.id, displayName: users.displayName, currentlyAdmin: users.isAdmin }).from(users).where(eq(users.id, args.user));
  if (row === undefined) {
    console.error(`No user with id "${args.user}".`);
    process.exit(1);
  }

  const action = args.revoke ? "Revoke" : "Grant";
  console.log(`About to ${action.toLowerCase()} operator access:`);
  console.log(`  user:    ${row.id} (${row.displayName})`);
  console.log(`  current: isAdmin=${row.currentlyAdmin}`);
  console.log(`  by:      ${args.by}`);
  if (!args.revoke) {
    // EXACTLY what the new operator will read, composed through the same renderer the write
    // itself calls (`grantAdmin` -> `notifyAffectedMember` -> `renderNotice`) — never a hand
    // copied string that could drift from what actually lands in their inbox.
    const notice = renderNotice("admin_granted", { grantedByUserId: args.by });
    console.log("  and in their notice inbox:");
    console.log(`    ${notice.title}`);
    console.log(`    ${notice.body}`);
  }

  const proceed = await confirm(`${action} operator access?`);
  if (!proceed) {
    console.log("Cancelled. Nothing was written.");
    process.exit(0);
  }

  // The service's own guarded `WHERE` is what actually enforces the no-duplicate-write
  // invariant (a concurrent second grant/revoke between the preview above and this call is the
  // one case the earlier read here cannot catch); this branch just turns that refusal into a
  // readable message instead of a silently-thrown one.
  const result = await grantAdmin(db, { userId: args.user, grant: !args.revoke, grantedBy: args.by });
  if (!result.ok) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log(JSON.stringify(result));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
