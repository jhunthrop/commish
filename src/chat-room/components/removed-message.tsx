import type { ChatMessageRemoval } from "@/chat/contract";
import { Avatar } from "@/components/ui";

export interface RemovedMessageProps {
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
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
 * Fix round 1 (review adjudication): the room sees ONLY the neutral fact — "A message was
 * removed." — never the reason. `removal.phrase` still travels on the wire (the sticky-removal
 * fold in `@/chat/messages` needs it present to detect a stale, pre-removal frame), and this
 * component still takes it as a required prop so a future caller cannot pass a bare boolean by
 * mistake, but it is deliberately NOT rendered here. Reviews' own precedent is the same shape: a
 * removed review's reason reaches only its author, through `quoteFor`'s private notice
 * blockquote (`chat_message_removed`'s own template does the identical thing for chat). A reason
 * broadcast to the whole room, permanently, in a real-money league is a public accusation this
 * codebase's own minimal-disclosure norm (ruling 6: `no_action` tells nobody, on purpose) argues
 * against — the fact that a message went is what preserves the conversation's shape (ruling 18's
 * whole purpose); the reason does not need to ride along to do that.
 */
export function RemovedMessage({ authorName, authorAvatarUrl }: RemovedMessageProps) {
  return (
    <div className="flex gap-2">
      <Avatar name={authorName} avatar={authorAvatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-display font-semibold text-text-primary">{authorName}</p>
        <p className="italic text-text-muted">A message was removed.</p>
      </div>
    </div>
  );
}
