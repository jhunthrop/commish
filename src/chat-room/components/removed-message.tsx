import type { ChatMessageRemoval } from "@/chat/contract";
import { Avatar } from "@/components/ui";

export interface RemovedMessageProps {
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  /**
   * `{ at }` and nothing else — the room-bound removal type carries no reason (final review,
   * HIGH 1). Still a required prop rather than a boolean so a caller cannot render a tombstone
   * for a message that was never removed.
   */
  readonly removal: ChatMessageRemoval;
}

/**
 * The IN-PLACE tombstone (ruling 18): a removed review vanishes from its feed, but a removed
 * chat message renders where it stood. A conversation with a hole in it is a conversation
 * everybody misreads, and the members who saw the message before it went already know it
 * existed — so the row's SHAPE stays evidence even once its words are gone.
 *
 * The author's name and avatar stay: attribution is not the thing being removed, and hiding WHO
 * posted it would only invite guessing. The words themselves never render — `body` is not on the
 * wire for a removed message at all (`ChatMessageView.removal`'s own docblock).
 *
 * The room reads ONE neutral sentence and never the reason. Final review, HIGH 1: the reason no
 * longer travels to the room at all — `ChatMessageRemoval` is `{ at }`, so there is nothing here
 * to leak even by accident. Reviews' own precedent is the same shape: a removed review's reason
 * reaches only its author, through `quoteFor`'s private notice blockquote
 * (`chat_message_removed`'s own template does the identical thing for chat). A reason broadcast
 * to the whole room, permanently, in a real-money league is a public accusation this codebase's
 * own minimal-disclosure norm (ruling 6: `no_action` tells nobody, on purpose) argues against —
 * the fact that a message went is what preserves the conversation's shape (ruling 18's whole
 * purpose); the reason does not need to ride along to do that.
 *
 * The sentence names the platform as the actor (final review, MEDIUM 5). The sentence that
 * shipped first was passive and is literally on `INTEGRITY_CONFIG.notices.passiveConstructions` —
 * the house copy rulebook (`@/integrity/copy-rules`) bans it, and this surface is written in the
 * same voice as the notices that rulebook was built for. It is swept there rather than here,
 * because a client room may not import a server module even in a test (`eslint.config.mjs`'s
 * client-boundary rule): `src/integrity/copy-rules.source.test.ts` reads this file's own string
 * literals off disk. Active voice, same disclosure, same length class.
 */
export function RemovedMessage({ authorName, authorAvatarUrl }: RemovedMessageProps) {
  return (
    <div className="flex gap-2">
      <Avatar name={authorName} avatar={authorAvatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-display font-semibold text-text-primary">{authorName}</p>
        <p className="italic text-text-muted">We removed this message.</p>
      </div>
    </div>
  );
}
