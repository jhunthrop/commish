import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { ChatMessageView, ChatReactionView } from "@/chat/contract";
import { CHAT_CONFIG } from "@/chat/config";
import type { Db } from "@/db/client";
import { chatMessages, chatReactions, teams, users } from "@/db/schema";
import type { RealtimeEventType } from "@/lib/realtime/events";
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

/** Where a swallowed publish failure goes. Mirrors `DraftStoreDeps.onPublishError` in shape. */
export type PublishErrorSink = (
  error: unknown,
  event: { readonly type: RealtimeEventType; readonly leagueId: string },
) => void;

const defaultOnPublishError: PublishErrorSink = (error, event) => {
  console.error("[chat] publish failed", { type: event.type, leagueId: event.leagueId, error });
};

/**
 * Publishing is best-effort BY CONTRACT: the row is already committed and Postgres is
 * authoritative, so a Redis outage must never make an accepted message look rejected. The
 * publisher itself already swallows its own failures; this guard covers an injected publisher
 * that doesn't.
 *
 * The error sink defaults to `console.error` (today's only production behavior) but is
 * injectable, mirroring the draft store's `onPublishError` — so a caller (or a test) can
 * observe the swallow without spying on the global console.
 */
async function publishQuietly(
  publish: PublishFn,
  input: Parameters<PublishFn>[0],
  onPublishError: PublishErrorSink = defaultOnPublishError,
): Promise<void> {
  try {
    await publish(input);
  } catch (error: unknown) {
    onPublishError(error, { type: input.type, leagueId: input.leagueId });
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
  /** Defaults to logging via `console.error`. Override in tests to assert the swallow. */
  readonly onPublishError?: PublishErrorSink;
}

/** Persist first, publish second — the order every write in this codebase uses. */
export async function postMessage(db: Db, input: PostMessageInput): Promise<ChatMessageView> {
  const [author] = await db
    .select({ displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, input.userId));
  // You talk as your TEAM in a league's chat, not as your legal name (persona review: real
  // names kill the trash-talk energy and leak identity in a money league). Display name is
  // only the fallback for a teamless commissioner.
  const [team] = await db
    .select({ name: teams.name })
    .from(teams)
    .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));

  const [row] = await db
    .insert(chatMessages)
    .values({ leagueId: input.leagueId, authorUserId: input.userId, body: input.body })
    .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });

  const message = toView(
    {
      id: row!.id,
      authorUserId: input.userId,
      authorName: team?.name ?? author?.displayName ?? "A manager",
      authorAvatarUrl: author?.avatarUrl ?? null,
      body: input.body,
      createdAt: row!.createdAt,
    },
    [],
  );

  await publishQuietly(input.publish, { leagueId: input.leagueId, type: "chat.message", payload: { message } }, input.onPublishError);
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
      authorName: teams.name,
      authorFallbackName: users.displayName,
      authorAvatarUrl: users.avatarUrl,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.authorUserId))
    // Team identity, same rule as postMessage: you speak as your team in this league.
    .leftJoin(teams, and(eq(teams.leagueId, chatMessages.leagueId), eq(teams.userId, chatMessages.authorUserId)))
    .where(scope)
    .orderBy(desc(chatMessages.id))
    .limit(CHAT_CONFIG.pageSize + 1);

  const hasMore = rows.length > CHAT_CONFIG.pageSize;
  const page = hasMore ? rows.slice(0, CHAT_CONFIG.pageSize) : rows;
  const grouped = await reactionsFor(db, page.map((row) => row.id));

  return {
    messages: [...page]
      .reverse()
      .map((row) => toView({ ...row, authorName: row.authorName ?? row.authorFallbackName }, grouped.get(row.id) ?? [])),
    hasMore,
  };
}

export type ToggleReactionResult =
  | { readonly ok: true; readonly action: "added" | "removed" }
  | { readonly ok: false; readonly status: number; readonly reason: string };

export interface ToggleReactionInput {
  readonly leagueId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly emoji: string;
  readonly publish: PublishFn;
  /** Defaults to logging via `console.error`. Override in tests to assert the swallow. */
  readonly onPublishError?: PublishErrorSink;
}

/**
 * A reaction is a toggle, resolved by which write THIS call actually landed — never by a prior
 * read, which is what let two concurrent double-taps both conclude "nothing here yet, I must be
 * adding" and both publish "added" for a single physical row.
 *
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING` is one atomic statement: under any concurrent
 * double-tap, the unique index on `(message_id, user_id, emoji)` guarantees at most one caller's
 * insert ever returns a row. That caller — and only that caller — reports "added". Every other
 * caller sees the conflict (which Postgres cannot report until the winning insert has actually
 * committed) and falls through to the DELETE, so a caller can never mistake a just-committed
 * insert for an empty table.
 *
 * The DELETE is judged the same way: by its own returned rows, not assumed. If two callers both
 * fall through to it for the same row, Postgres serializes the two DELETEs and only the first to
 * acquire the row lock actually removes anything; the second's DELETE affects zero rows because
 * there is nothing left to delete. That second caller did not cause a transition — the first
 * caller already published "removed" — so it reports the true resulting state ("removed", since
 * the row is in fact gone) but skips the publish. Publishing there would be a phantom duplicate
 * of a change this call never made.
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

  const inserted = await db
    .insert(chatReactions)
    .values({ messageId, userId: input.userId, emoji: input.emoji })
    .onConflictDoNothing()
    .returning({ emoji: chatReactions.emoji });

  const didAdd = inserted.length > 0;
  const didRemove = didAdd
    ? false
    : (
        await db
          .delete(chatReactions)
          .where(and(eq(chatReactions.messageId, messageId), eq(chatReactions.userId, input.userId), eq(chatReactions.emoji, input.emoji)))
          .returning({ emoji: chatReactions.emoji })
      ).length > 0;

  // "removed" whenever this call didn't add it — whether this call's own DELETE removed it or
  // a concurrent caller's did. Both are honestly reported as "removed": it is the true
  // resulting state either way. The route's only consumer is this action, not a snapshot of the
  // reaction set — the client already holds its own copy and folds the transition into it
  // (`applyReaction`), so there is no second read of `reactionsFor` to build one here.
  const action: "added" | "removed" = didAdd ? "added" : "removed";

  // Only a write THIS call actually made gets published — never the phantom no-op where a
  // concurrent caller's DELETE already won and already published the same transition.
  if (didAdd || didRemove) {
    await publishQuietly(
      input.publish,
      { leagueId: input.leagueId, type: "chat.reaction", payload: { messageId: input.messageId, emoji: input.emoji, userId: input.userId, action } },
      input.onPublishError,
    );
  }

  return { ok: true, action };
}
