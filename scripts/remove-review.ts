// Operator-only removal for a review — ruling 18: no admin role and no admin UI exist in this
// phase, so this script IS the removal path. It stamps `removed_at`/`removed_by_user_id`/
// `removal_reason`; the review row and its text are never deleted or altered, only marked (see
// `reviews`' own docblock in `@/db/schema`). Phase 3 owns real moderation and audit.
//
// Run: npm run reviews:remove -- --id <reviewId> --reason "<reason>" --by <operatorUserId>
//
// `--by` is an existing `users.id` — `removed_by_user_id` is a real foreign key, so a name that
// isn't a signed-up user's own id fails fast with a Postgres constraint violation rather than
// being silently accepted as free text.
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { reviews, users } from "@/db/schema";
import { removeReview } from "@/review-service/reviews";

interface Args {
  readonly id: string;
  readonly reason: string;
  readonly by: string;
}

const USAGE = 'Usage: npm run reviews:remove -- --id <reviewId> --reason "<reason>" --by <operatorUserId>';

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
  const id = flags.get("id");
  const reason = flags.get("reason");
  const by = flags.get("by");
  if (id === undefined || reason === undefined || by === undefined) {
    throw new Error(`--id, --reason and --by are all required.\n${USAGE}`);
  }
  return { id, reason, by };
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

  const [row] = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      body: reviews.body,
      authorName: users.displayName,
      removedAt: reviews.removedAt,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.userId))
    .where(eq(reviews.id, args.id));

  if (row === undefined) {
    console.error(`No review with id "${args.id}".`);
    process.exit(1);
  }
  if (row.removedAt !== null) {
    console.error(`Review "${args.id}" is already removed (at ${row.removedAt.toISOString()}). Nothing to do.`);
    process.exit(1);
  }

  console.log("About to remove this review:");
  console.log(`  id:     ${row.id}`);
  console.log(`  author: ${row.authorName}`);
  console.log(`  rating: ${row.rating}`);
  console.log(`  body:   ${row.body}`);
  console.log(`  reason: ${args.reason}`);
  console.log(`  by:     ${args.by}`);

  const proceed = await confirm("Remove this review?");
  if (!proceed) {
    console.log("Cancelled. Nothing was written.");
    process.exit(0);
  }

  const result = await removeReview(db, { reviewId: args.id, removedByUserId: args.by, reason: args.reason });
  if (result === null) {
    console.error(`Removal failed for review "${args.id}".`);
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
