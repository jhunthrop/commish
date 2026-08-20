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
 * wire for a removed message at all (`ChatMessageView.removal`'s own docblock) — and the closed
 * vocabulary's own phrase says why, the same mapped phrase (never a raw token) every other
 * removal surface in this product renders.
 */
export function RemovedMessage({ authorName, authorAvatarUrl, removal }: RemovedMessageProps) {
  return (
    <div className="flex gap-2">
      <Avatar name={authorName} avatar={authorAvatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-display font-semibold text-text-primary">{authorName}</p>
        <p className="italic text-text-muted">
          A message was removed. Flagged for {removal.phrase}.
        </p>
      </div>
    </div>
  );
}
