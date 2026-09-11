import type { ChatMessageView } from "@/chat/contract";

/** The shortest first name the mention check will match on its own ("Al" is a word, "J" is not). */
const MIN_FIRST_NAME_CHARS = 3;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * DID SOMEBODY SAY YOUR NAME (founder ruling 2: the rail's amber mention pill). The chat carries
 * no mention markup, so this reads the words: a message from somebody else that contains your
 * display name, or your first name as a whole word, is a mention. Case-blind. Your own messages
 * never mention you.
 */
export function mentionsMe(message: ChatMessageView, meUserId: string, myName: string | null): boolean {
  if (myName === null || message.authorUserId === meUserId || message.removal !== null) return false;
  const body = message.body.toLowerCase();
  const full = myName.trim().toLowerCase();
  if (full === "") return false;
  if (body.includes(full)) return true;
  const first = full.split(/\s+/)[0] ?? "";
  if (first.length < MIN_FIRST_NAME_CHARS) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(first)}([^a-z0-9]|$)`).test(body);
}

/** "Rey said your name": the first name of the latest person who mentioned you, or null. */
export function latestMentionBy(messages: readonly ChatMessageView[], meUserId: string, myName: string | null): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (mentionsMe(message, meUserId, myName)) return message.authorName.trim().split(/\s+/)[0] ?? message.authorName;
  }
  return null;
}
