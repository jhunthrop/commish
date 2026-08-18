import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { ChatMessageView, ChatReactionView } from "@/chat/contract";
import { CHAT_CONFIG } from "@/chat/config";
import type { Db } from "@/db/client";
import { chatMessages, chatReactions, users } from "@/db/schema";
import type { PublishFn } from "@/lib/realtime/publish";

interface MessageRow {
  readonly id: number;
  readonly authorUserId: string;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly body: string;
  readonly createdAt: Date;
}

function toView(row: MessageRow, reactions: readonly ChatReactionView[]): ChatMessageView {
  return {
    id: String(row.id),
    authorUserId: row.authorUserId,
    authorName: row.authorName,
    authorAvatarUrl: row.authorAvatarUrl,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    reactions,
  };
}

/**
 * Publishing is best-effort BY CONTRACT: the row is already committed and Postgres is
 * authoritative, so a Redis outage must never make an accepted message look rejected. The
 * publisher itself already swallows its own failures; this guard covers an injected publisher
 * that doesn't.
 */
async function publishQuietly(publish: PublishFn, input: Parameters<PublishFn>[0]): Promise<void> {
  try {
    await publish(input);
  } catch (error: unknown) {
    console.error("[chat] publish failed", { type: input.type, leagueId: input.leagueId, error });
  }
}

async function reactionsFor(db: Db, messageIds: readonly number[]): Promise<ReadonlyMap<number, readonly ChatReactionView[]>> {
  const grouped = new Map<number, ChatReactionView[]>();
  if (messageIds.length === 0) return grouped;
  const rows = await db
    .select({ messageId: chatReactions.messageId, emoji: chatReactions.emoji, userId: chatReactions.userId })
    .from(chatReactions)
    .where(inArray(chatReactions.messageId, [...messageIds]));
  for (const row of rows) {
    const held = grouped.get(row.messageId) ?? [];
    held.push({ emoji: row.emoji, userId: row.userId });
    grouped.set(row.messageId, held);
  }
  return grouped;
}

export interface PostMessageInput {
  readonly leagueId: string;
  readonly userId: string;
  readonly body: string;
  readonly publish: PublishFn;
}

/** Persist first, publish second — the order every write in this codebase uses. */
export async function postMessage(db: Db, input: PostMessageInput): Promise<ChatMessageView> {
  const [author] = await db
    .select({ displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, input.userId));

  const [row] = await db
    .insert(chatMessages)
    .values({ leagueId: input.leagueId, authorUserId: input.userId, body: input.body })
    .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });

  const message = toView(
    {
      id: row!.id,
      authorUserId: input.userId,
      authorName: author?.displayName ?? "A manager",
      authorAvatarUrl: author?.avatarUrl ?? null,
      body: input.body,
      createdAt: row!.createdAt,
    },
    [],
  );

  await publishQuietly(input.publish, { leagueId: input.leagueId, type: "chat.message", payload: { message } });
  return message;
}

export interface ListMessagesInput {
  readonly leagueId: string;
  /** A message id; the page returned is the newest `pageSize` messages strictly older than it. */
  readonly before?: string;
}

export interface ChatPage {
  readonly messages: readonly ChatMessageView[];
  readonly hasMore: boolean;
}

/**
 * One page, newest-first from the database and reversed to oldest-first for rendering. There
 * is deliberately no unpaginated read: chat is the one table in this product that grows
 * without bound, so an "all messages" query would be a slow query waiting for its first busy
 * league. `pageSize + 1` is fetched so `hasMore` costs no second round trip.
 */
export async function listMessages(db: Db, input: ListMessagesInput): Promise<ChatPage> {
  const scope =
    input.before === undefined
      ? eq(chatMessages.leagueId, input.leagueId)
      : and(eq(chatMessages.leagueId, input.leagueId), lt(chatMessages.id, Number(input.before)));

  const rows = await db
    .select({
      id: chatMessages.id,
      authorUserId: chatMessages.authorUserId,
      authorName: users.displayName,
      authorAvatarUrl: users.avatarUrl,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.authorUserId))
    .where(scope)
    .orderBy(desc(chatMessages.id))
    .limit(CHAT_CONFIG.pageSize + 1);

  const hasMore = rows.length > CHAT_CONFIG.pageSize;
  const page = hasMore ? rows.slice(0, CHAT_CONFIG.pageSize) : rows;
  const grouped = await reactionsFor(db, page.map((row) => row.id));

  return {
    messages: [...page].reverse().map((row) => toView(row, grouped.get(row.id) ?? [])),
    hasMore,
  };
}

export type ToggleReactionResult =
  | { readonly ok: true; readonly action: "added" | "removed"; readonly reactions: readonly ChatReactionView[] }
  | { readonly ok: false; readonly status: number; readonly reason: string };

export interface ToggleReactionInput {
  readonly leagueId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly emoji: string;
  readonly publish: PublishFn;
}

/**
 * A reaction is a toggle, resolved by the delete: whoever's DELETE returns a row was removing,
 * everybody else is adding. That is one round trip rather than a read-then-decide race, and it
 * cannot produce a half-state.
 *
 * The message is re-read scoped to the LEAGUE first: a member of league A must not be able to
 * react onto a message in league B by guessing its id — the route's membership gate proves who
 * you are, this proves the message is one you were allowed to see.
 */
export async function toggleReaction(db: Db, input: ToggleReactionInput): Promise<ToggleReactionResult> {
  const messageId = Number(input.messageId);
  const [message] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.leagueId, input.leagueId)));
  if (message === undefined) return { ok: false, status: 404, reason: "That message is no longer here." };

  const removed = await db
    .delete(chatReactions)
    .where(and(eq(chatReactions.messageId, messageId), eq(chatReactions.userId, input.userId), eq(chatReactions.emoji, input.emoji)))
    .returning({ emoji: chatReactions.emoji });

  const action = removed.length > 0 ? "removed" : "added";
  if (action === "added") {
    await db
      .insert(chatReactions)
      .values({ messageId, userId: input.userId, emoji: input.emoji })
      .onConflictDoNothing();
  }

  const grouped = await reactionsFor(db, [messageId]);
  const reactions = grouped.get(messageId) ?? [];

  await publishQuietly(input.publish, {
    leagueId: input.leagueId,
    type: "chat.reaction",
    payload: { messageId: input.messageId, emoji: input.emoji, userId: input.userId, action },
  });

  return { ok: true, action, reactions };
}
