// Operator-only removal for a review — Phase 2 ruling 18's own removal path, retained rather than
// replaced now that Phase 3 Plan B's dispute queue (`resolveFlag`'s `content_removed` decision,
// `docs/decisions/operators-and-moderation.md` §3-4) offers a second door onto the same
// `removeReview` writer. This script stamps `removed_at`/`removed_by_user_id`/`removal_reason`;
// the review row and its text are never deleted or altered, only marked (see `reviews`' own
// docblock in `@/db/schema`).
//
// Run: npm run reviews:remove -- --id <reviewId> --reason "<reason>" --by <operatorUserId>
//
// `--by` is an existing `users.id` — `removed_by_user_id` is a real foreign key, so a name that
// isn't a signed-up user's own id fails fast with a Postgres constraint violation rather than
// being silently accepted as free text.
//
// `--reason` IS SHOWN TO THE AUTHOR: `myReview` reports the removed state and `ReviewComposer`
// renders "Your review was removed for <phrase>. It can't be edited." It is therefore NOT free
// text — it must be one of `REVIEW_CONFIG.reportReasons`' values, the same closed vocabulary a
// reporter picks from, and the author reads that value's `removalPhrase`. An operator cannot
// type an internal note into a sentence a user reads.
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { reviews, users } from "@/db/schema";
import { renderNotice } from "@/integrity/notices";
import { REVIEW_CONFIG, REMOVAL_REASON_VALUES, removalPhraseFor, removalSentenceFor } from "@/reviews/config";
import { removeReview } from "@/review-service/reviews";

interface Args {
  readonly id: string;
  readonly reason: string;
  readonly by: string;
}

const USAGE = `Usage: npm run reviews:remove -- --id <reviewId> --reason <${REMOVAL_REASON_VALUES.join("|")}> --by <operatorUserId>`;

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
  if (!REMOVAL_REASON_VALUES.includes(reason)) {
    throw new Error(`--reason must be one of: ${REMOVAL_REASON_VALUES.join(", ")}. The author reads it.\n${USAGE}`);
  }
  // Unreachable through the enum check above today — every `REMOVAL_REASON_VALUES` entry is
  // well under this cap — but `removeReview` enforces the SAME limit as its own boundary
  // (`REVIEW_CONFIG.removalReason.maxLength`'s own docblock explains why), so the script checks
  // it too rather than letting a future looser `--reason` surface only as a service rejection.
  if (reason.length > REVIEW_CONFIG.removalReason.maxLength) {
    throw new Error(`--reason must be ${REVIEW_CONFIG.removalReason.maxLength} characters or fewer.\n${USAGE}`);
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
  // EXACTLY what the author will read, composed through the same functions that write it. Both
  // surfaces are shown because there are two: the profile sentence `ReviewComposer` renders, and
  // the inbox notice `removeReview` stores. Every line below comes from a shared function
  // (`removalSentenceFor`, `renderNotice`, `removalPhraseFor` — the last being what `quoteFor`
  // returns for the stored row), so this preview cannot drift from the delivery the way a hand
  // written copy of the sentence did. `notify.test.ts` holds the two to each other.
  console.log("  the author will read, on their profile:");
  console.log(`    ${removalSentenceFor(args.reason)}`);
  const notice = renderNotice("review_removed", { reason: args.reason });
  console.log("  and in their notice inbox:");
  console.log(`    ${notice.title}`);
  console.log(`    ${notice.body}`);
  console.log(`    "${removalPhraseFor(args.reason)}"`);

  const proceed = await confirm("Remove this review?");
  if (!proceed) {
    console.log("Cancelled. Nothing was written.");
    process.exit(0);
  }

  // The service's own `WHERE ... AND removed_at IS NULL` is what actually enforces the
  // no-re-stamp invariant (a concurrent second removal between the print above and this call is
  // the one case the earlier read here cannot catch); this branch is what turns that refusal
  // into a readable message instead of a silently-empty JSON line.
  const result = await removeReview(db, { reviewId: args.id, removedByUserId: args.by, reason: args.reason });
  if (!result.ok) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log(JSON.stringify(result.record));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
