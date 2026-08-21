import { MODERATION_CONFIG } from "./config";

/**
 * Every string that would identify WHY something was removed, derived from the one closed
 * vocabulary rather than retyped: the stored token (`spam`), the reporter's label ("Spam or
 * fake"), and both rendered phrases (reviews' and chat's).
 *
 * The privacy guards this feeds are inverted assertions — they prove a fragment is ABSENT from a
 * wire payload, an SSE frame, or a rendered room. An inverted assertion is only as good as its
 * list, and a hand-written list in each test file would go stale the first time a fourth reason
 * lands. Deriving it here means a new reason is swept by every one of those guards on the commit
 * that adds it.
 *
 * Test support, not production: nothing in `src/**` outside a `*.test.*` file imports this.
 */
export const REASON_FRAGMENTS: readonly string[] = MODERATION_CONFIG.reasons.flatMap((reason) => [
  reason.value,
  reason.label,
  reason.removalPhrase,
  reason.chatRemovalPhrase,
]);
